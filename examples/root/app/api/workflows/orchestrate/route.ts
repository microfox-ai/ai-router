import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { orchestrateWorkflowFn } from '../workflows/orchestrateWorkflow';
import type { OrchestrationConfig } from '@microfox/ai-router';
import { createVercelWorkflow, createUpstashWorkflow } from '../adapters/helpers';
import { getAdapter } from '../adapters';
import { getWorkflowConfig } from '@microfox/ai-router';

/**
 * Orchestration workflow endpoint.
 * 
 * POST /api/workflows/orchestrate
 * 
 * Starts an orchestration workflow using the configured provider.
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { config, messages, input } = body;

    if (!config || !config.steps || !Array.isArray(config.steps)) {
      return NextResponse.json(
        { error: 'config with steps array is required' },
        { status: 400 }
      );
    }

    // Validate orchestration config
    const { validateOrchestrationConfig } = await import('./validation');
    const validationErrors = validateOrchestrationConfig(config);
    
    if (validationErrors.length > 0) {
      console.error('[orchestrate] Validation errors:', validationErrors);
      return NextResponse.json(
        {
          error: 'Invalid orchestration config',
          details: validationErrors,
        },
        { status: 400 }
      );
    }
    
    // Merge input into config if provided
    // Note: For Vercel workflows, we can't pass runId through input easily
    // as it's only available after starting the workflow. This is a limitation
    // of the Vercel workflow runtime API. For Upstash workflows, runId is available
    // via context.workflowRunId
    const orchestrationConfig: OrchestrationConfig = {
      ...config,
      input: input || config.input,
      messages: messages || config.messages || [],
    };

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

    // Construct base URL for agent calls
    let baseUrl = req.nextUrl.origin;
    const adapter = getAdapter();
    const config_provider = getWorkflowConfig();

    let startResult;
    if (config_provider.provider === 'upstash') {
      // For Upstash, we need a publicly accessible URL
      // Check if baseUrl is localhost and use tunnel URL if available
      try {
        baseUrl = getPublicUrl(baseUrl);
      } catch (error: any) {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        );
      }

      // Use Upstash Workflow
      const orchestrationWorkflow = createUpstashWorkflow({
        id: 'orchestrate',
        input: z.object({
          config: z.any(),
          baseUrl: z.string(),
        }),
        endpointUrl: `${baseUrl}/api/workflows/orchestrate/upstash`,
      });

      startResult = await adapter.startWorkflow(
        orchestrationWorkflow.definition,
        {
          config: orchestrationConfig,
          baseUrl: `${baseUrl}/api/studio/chat/agent`,
        },
      );
    } else {
      // Default to Vercel workflow
      const orchestrationWorkflow = createVercelWorkflow({
        id: 'orchestrate',
        input: z.object({
          config: z.any(),
          baseUrl: z.string(),
        }),
        workflowFn: orchestrateWorkflowFn as any,
      });

      startResult = await adapter.startWorkflow(
        orchestrationWorkflow.definition,
        {
          config: orchestrationConfig,
          baseUrl: `${baseUrl}/api/studio/chat/agent`,
        },
      );
    }

    return NextResponse.json(
      {
        runId: startResult.runId,
        status: startResult.status,
        result: startResult.result,
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error('[orchestrate] Error starting orchestration:', error);
    return NextResponse.json(
      { 
        error: error?.message || String(error),
        stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
      },
      { status: 500 }
    );
  }
}
