import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { start, getRun, resumeHook } from 'workflow/api';
import { agentWorkflowFn } from '../workflows/agentWorkflow';

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
  let slug: string[] = [];
  try {
    const { slug: slugParam } = await params;
    slug = slugParam || [];
    
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

    let body;
    try {
      body = await req.json();
    } catch (parseError: any) {
      console.error('[Workflows] Failed to parse request body:', {
        agentPath,
        error: parseError?.message || String(parseError),
      });
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { input, messages } = body;
    const baseUrl = req.nextUrl.origin;
    const fullAgentPath = agentPath;

    console.log('[Workflows] Starting agent workflow:', {
      agentPath: fullAgentPath,
      hasInput: !!input,
      messageCount: messages?.length || 0,
    });

    // Start Vercel workflow directly
    let run;
    try {
      run = await start(agentWorkflowFn, [{
        agentPath: fullAgentPath,
        input: input || {},
        baseUrl: `${baseUrl}/api/studio/chat/agent`,
        messages: messages || [],
      }]);
    } catch (startError: any) {
      console.error('[Workflows] Failed to start workflow:', {
        agentPath: fullAgentPath,
        error: startError?.message || String(startError),
        stack: process.env.NODE_ENV === 'development' ? startError?.stack : undefined,
      });
      throw new Error(`Failed to start agent workflow: ${startError?.message || String(startError)}`);
    }

    // Get the current status
    let status: string;
    try {
      status = await run.status;
    } catch (statusError: any) {
      console.error('[Workflows] Failed to get workflow status:', {
        runId: run.runId,
        agentPath: fullAgentPath,
        error: statusError?.message || String(statusError),
      });
      // Continue with default status
      status = 'pending';
    }

    let result: any;
    // Only try to get the result if the workflow completed synchronously
    if (status === 'completed') {
      try {
        result = await run.returnValue;
        console.log('[Workflows] Workflow completed synchronously:', {
          runId: run.runId,
          agentPath: fullAgentPath,
        });
      } catch {
        // If returnValue isn't available yet, that's fine – status polling will handle it
      }
    }

    console.log('[Workflows] Agent workflow started successfully:', {
      runId: run.runId,
      agentPath: fullAgentPath,
      status,
    });

    return NextResponse.json(
      {
        runId: run.runId,
        status,
        result,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[Workflows] Error starting workflow:', {
      agentPath: slug.join('/'),
      error: error?.message || String(error),
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
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
  let slug: string[] = [];
  try {
    const { slug: slugParam } = await params;
    slug = slugParam || [];
    
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

    console.log('[Workflows] Getting workflow status:', {
      runId,
      agentPath,
    });

    // Get workflow status using Vercel workflow API
    let run;
    try {
      run = getRun(runId);
    } catch (getRunError: any) {
      console.error('[Workflows] Error getting workflow run:', {
        runId,
        agentPath,
        error: getRunError?.message || String(getRunError),
      });
      return NextResponse.json(
        { error: `Failed to get workflow run: ${getRunError?.message || String(getRunError)}` },
        { status: 500 }
      );
    }

    if (!run) {
      console.warn('[Workflows] Workflow run not found:', {
        runId,
        agentPath,
      });
      return NextResponse.json(
        { error: `Workflow run "${runId}" not found` },
        { status: 404 }
      );
    }

    // Get the current status
    let status: string;
    let workflowError: any;
    try {
      status = await run.status;

      // Check for errors
      try {
        const runAny = run as any;
        const errorValue = await runAny.error;
        if (errorValue) {
          workflowError = errorValue;
          if (status === 'running' || status === 'pending') {
            status = 'failed';
          }
          console.warn('[Workflows] Workflow has error:', {
            runId,
            agentPath,
            status,
            error: workflowError?.message || String(workflowError),
          });
        }
      } catch {
        // run.error might not be available
      }
    } catch (err: any) {
      console.error('[Workflows] Error getting workflow status:', {
        runId,
        agentPath,
        error: err?.message || String(err),
        stack: process.env.NODE_ENV === 'development' ? err?.stack : undefined,
      });
      status = 'error';
      workflowError = err;
    }

    let result: any;
    let error: any;
    let hook: any;

    if (status === 'completed') {
      try {
        result = await run.returnValue;
        console.log('[Workflows] Workflow completed:', {
          runId,
          agentPath,
        });
      } catch (err: any) {
        console.error('[Workflows] Error getting workflow result:', {
          runId,
          agentPath,
          error: err?.message || String(err),
        });
        error = err;
      }
    } else if (status === 'failed' || status === 'error') {
      error = workflowError;
      console.log('[Workflows] Workflow failed:', {
        runId,
        agentPath,
        error: error?.message || String(error),
      });
    } else if (status === 'paused') {
      // Extract hook token if available
      const runAny = run as any;
      const hookToken = runAny.hookToken 
        || runAny.waitingForToken
        || runAny.metadata?.hookToken
        || '';
      
      if (hookToken) {
        hook = {
          token: hookToken,
          type: 'hook',
        };
        console.log('[Workflows] Workflow paused waiting for hook:', {
          runId,
          agentPath,
          hasToken: !!hookToken,
        });
      }
    }
    
    return NextResponse.json(
      {
        runId,
        status,
        result,
        error: error?.message || (error ? String(error) : undefined),
        hook,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[Workflows] Error getting workflow status:', {
      runId: slug.length > 0 ? slug[slug.length - 1] : 'unknown',
      agentPath: slug.length > 1 ? slug.slice(0, -1).join('/') : 'unknown',
      error: error?.message || String(error),
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
    return NextResponse.json(
      { 
        error: error?.message || String(error),
        stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
      },
      { status: 500 }
    );
  }
}

async function handleSignal(req: NextRequest, workflowId: string) {
  try {
    let body;
    try {
      body = await req.json();
    } catch (parseError: any) {
      console.error('[Workflows] Failed to parse signal request body:', {
        workflowId,
        error: parseError?.message || String(parseError),
      });
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { token, payload } = body;

    if (!token) {
      console.error('[Workflows] Missing token in signal request:', {
        workflowId,
      });
      return NextResponse.json(
        { error: 'token is required in request body' },
        { status: 400 }
      );
    }

    if (payload === undefined || payload === null) {
      console.error('[Workflows] Missing payload in signal request:', {
        workflowId,
        token,
      });
      return NextResponse.json(
        { error: 'payload is required in request body' },
        { status: 400 }
      );
    }

    console.log('[Workflows] Resuming hook:', {
      workflowId,
      token,
      hasPayload: !!payload,
    });

    // Resume hook with token and payload
    try {
      await resumeHook(token, payload);
      console.log('[Workflows] Hook resumed successfully:', {
        workflowId,
        token,
      });
      return NextResponse.json(
        {
          status: 'resumed',
          message: 'Hook resumed successfully',
        },
        { status: 200 }
      );
    } catch (hookError: any) {
      console.error('[Workflows] Failed to resume hook:', {
        workflowId,
        token,
        error: hookError?.message || String(hookError),
        stack: process.env.NODE_ENV === 'development' ? hookError?.stack : undefined,
      });
      return NextResponse.json(
        {
          error: `Failed to resume workflow hook: ${hookError?.message || String(hookError)}. ` +
            `Make sure the token is correct and the workflow is waiting for a signal.`,
        },
        { status: 400 }
      );
    }
  } catch (error: any) {
    console.error('[Workflows] Error handling signal:', {
      workflowId,
      error: error?.message || String(error),
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
    return NextResponse.json(
      { 
        error: error?.message || String(error),
        stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
      },
      { status: 500 }
    );
  }
}
