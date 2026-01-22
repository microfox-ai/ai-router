import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdapter } from '../adapters';
import { agentWorkflowFn } from '../workflows/agentWorkflow';
import { createVercelWorkflow } from '../adapters/helpers';
import { getWorkflowConfig } from '@microfox/ai-router';

/**
 * Unified workflow router - Agents by path only.
 * 
 * Handles:
 * - POST /api/workflows/:agentPath - Start an agent workflow
 * - GET /api/workflows/:agentPath/:runId - Get agent workflow status
 * - POST /api/workflows/:agentPath/signal - Send signal/hook to workflow
 * 
 * Agents are called directly by their router path (e.g., /system/current_date).
 * No workflow registry needed - agents are discovered by their API endpoints.
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  try {
    const { slug: slugParam } = await params;
    const slug = slugParam || [];
    
    // Check if the last element is 'signal' (for signal endpoint)
    // Example: /api/workflows/system/current_date/signal
    // slug = ['system', 'current_date', 'signal']
    // agentPath = '/system/current_date', action = 'signal'
    if (slug.length > 0 && slug[slug.length - 1] === 'signal') {
      const agentPathParts = slug.slice(0, -1);
      const agentPath = `/${agentPathParts.join('/')}`;
      return handleSignal(req, agentPath);
    }

    // Otherwise, the entire slug is the agent path
    // Example: /api/workflows/system/current_date
    // slug = ['system', 'current_date']
    // agentPath = '/system/current_date'
    if (slug.length === 0) {
      return NextResponse.json(
        { error: 'Agent path is required' },
        { status: 400 }
      );
    }
    
    const agentPath = `/${slug.join('/')}`;

    const body = await req.json();
    const { input, messages } = body;

    // Helper to check if URL is localhost/loopback
    function isLocalhost(url: string): boolean {
      try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase();
        return (
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname === '::1' ||
          hostname === '[::1]' ||
          hostname.startsWith('127.') ||
          hostname.startsWith('192.168.') ||
          hostname.startsWith('10.') ||
          (hostname.startsWith('172.') && 
           parseInt(hostname.split('.')[1] || '0') >= 16 && 
           parseInt(hostname.split('.')[1] || '0') <= 31)
        );
      } catch {
        return false;
      }
    }

    // Helper to get public URL for Upstash (use tunnel if localhost)
    function getPublicUrl(origin: string): string {
      if (isLocalhost(origin)) {
        const tunnelUrl = process.env.UPSTASH_WEBHOOK_URL || process.env.TUNNEL_URL || process.env.NEXT_PUBLIC_TUNNEL_URL;
        if (!tunnelUrl) {
          throw new Error(
            'Upstash workflows require a publicly accessible URL. ' +
            'In local development, please set UPSTASH_WEBHOOK_URL, TUNNEL_URL, or NEXT_PUBLIC_TUNNEL_URL ' +
            'environment variable to your tunnel URL (e.g., from ngrok: https://xxxx.ngrok.io). ' +
            'Example: ngrok http 3000'
          );
        }
        return tunnelUrl;
      }
      return origin;
    }

    const adapter = getAdapter();
    const config = getWorkflowConfig();
    let baseUrl = req.nextUrl.origin;

    // Agent path already starts with / from the join above
    const fullAgentPath = agentPath;
    
    if (config.provider === 'upstash') {
      // For Upstash, we need a publicly accessible URL
      try {
        baseUrl = getPublicUrl(baseUrl);
      } catch (error: any) {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        );
      }

      // For Upstash, create a minimal orchestration with single agent step
      const { createOrchestration } = await import('@microfox/ai-router');
      const agentWorkflowConfig = createOrchestration()
        .agent(fullAgentPath, input || {}, { await: true })
        .build();
      
      // Use orchestration endpoint to start the workflow
      const orchestrationResponse = await fetch(`${baseUrl}/api/workflows/orchestrate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config: agentWorkflowConfig,
          input: input || {},
          messages: messages || [],
        }),
      });
      
      if (!orchestrationResponse.ok) {
        const errorText = await orchestrationResponse.text();
        return NextResponse.json(
          { error: `Failed to start agent workflow: ${errorText}` },
          { status: orchestrationResponse.status }
        );
      }
      
      const orchestrationResult = await orchestrationResponse.json();
      return NextResponse.json(
        {
          runId: orchestrationResult.runId,
          status: orchestrationResult.status,
          result: orchestrationResult.result,
        },
        { status: 200 }
      );
    }

    // Vercel: Use agentWorkflowFn directly (same as old system)
    const agentWorkflow = createVercelWorkflow({
      id: 'agent-workflow',
      input: z.object({
        agentPath: z.string(),
        input: z.any(),
        baseUrl: z.string(),
        messages: z.array(z.any()),
      }),
      workflowFn: agentWorkflowFn as any,
    });

    const startResult = await adapter.startWorkflow(
      agentWorkflow.definition,
      {
        agentPath: fullAgentPath,
        input: input || {},
        baseUrl: `${baseUrl}/api/studio/chat/agent`,
        messages: messages || [],
      },
    );

    return NextResponse.json(
      {
        runId: startResult.runId,
        status: startResult.status,
        result: startResult.result,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[workflows/[...slug]] Error starting workflow:', error);
    return NextResponse.json(
      { 
        error: error?.message || String(error),
        stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
      },
      { status: 500 }
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  try {
    const { slug: slugParam } = await params;
    const slug = slugParam || [];
    
    // The last element is the runId, everything before is the agent path
    // Example: /api/workflows/system/current_date/wrun_xxx
    // slug = ['system', 'current_date', 'wrun_xxx']
    // agentPath = 'system/current_date', runId = 'wrun_xxx'
    if (slug.length < 2) {
      return NextResponse.json(
        { error: 'Agent path and run ID are required' },
        { status: 400 }
      );
    }
    
    const runId = slug[slug.length - 1];
    const agentPathParts = slug.slice(0, -1);
    const agentPath = `/${agentPathParts.join('/')}`;

    const adapter = getAdapter();
    
    // Construct agent workflow definition on-the-fly (same as POST)
    const fullAgentPath = agentPath.startsWith('/') ? agentPath : `/${agentPath}`;
    const agentWorkflow = createVercelWorkflow({
      id: 'agent-workflow',
      input: z.object({
        agentPath: z.string(),
        input: z.any(),
        baseUrl: z.string(),
        messages: z.array(z.any()),
      }),
      workflowFn: agentWorkflowFn as any,
    });
    
    // Get workflow status
    const statusResult = await adapter.getWorkflowStatus(
      agentWorkflow.definition,
      runId
    );
    
    return NextResponse.json(
      {
        runId,
        status: statusResult.status,
        result: statusResult.result,
        error: statusResult.error,
        hook: statusResult.hook,
        webhook: statusResult.webhook,
      },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}

async function handleSignal(req: NextRequest, workflowId: string) {
  try {
    const body = await req.json();
    const { token, payload } = body;

    if (!token) {
      return NextResponse.json(
        { error: 'token is required in request body' },
        { status: 400 }
      );
    }

    if (payload === undefined || payload === null) {
      return NextResponse.json(
        { error: 'payload is required in request body' },
        { status: 400 }
      );
    }

    const adapter = getAdapter();

    // Try hook first, then webhook
    try {
      const result = await adapter.resumeHook(token, payload);
      return NextResponse.json(
        {
          status: result.status || 'resumed',
          message: 'Hook resumed successfully',
        },
        { status: 200 }
      );
    } catch (hookError: any) {
      try {
        const result = await adapter.resumeWebhook(token, payload);
        return NextResponse.json(
          {
            status: result.status || 'resumed',
            message: 'Webhook resumed successfully',
          },
          { status: 200 }
        );
      } catch (webhookError: any) {
        return NextResponse.json(
          {
            error: `Failed to resume workflow hook/webhook: ${hookError?.message || String(hookError)}. ` +
              `Make sure the token is correct and the workflow is waiting for a signal.`,
          },
          { status: 400 }
        );
      }
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
