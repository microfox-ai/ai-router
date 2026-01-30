import { NextRequest, NextResponse } from 'next/server';
import { getRun } from 'workflow/api';
import { workflowStatusStore } from '../../stores/workflowStatusStore';

/**
 * GET /api/workflows/orchestrate/:runId - Get orchestration workflow status
 * 
 * Returns workflow status from database (source of truth, updated by workflow itself)
 * Falls back to runtime status if database doesn't have it yet
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;

    if (!runId) {
      return NextResponse.json(
        { error: 'Run ID is required' },
        { status: 400 }
      );
    }

    console.log('[Orchestrate] Getting workflow status:', {
      runId,
    });

    // Get status from database first (source of truth)
    // The workflow updates the database directly when it reaches hooks/sleep/completion
    const dbStatus = await workflowStatusStore.getStatus(runId);

    // If database has status, use it (workflow updates it directly)
    if (dbStatus) {
      const hook: { token?: string } | undefined = 
        dbStatus.status === 'paused' && dbStatus.hookToken
          ? { token: dbStatus.hookToken }
          : undefined;

      console.log('[Orchestrate] Workflow status retrieved from DB:', {
        runId,
        status: dbStatus.status,
        hasResult: !!dbStatus.result,
        hasHook: !!hook,
        hookToken: dbStatus.hookToken || '(not set)',
      });

      return NextResponse.json(
        {
          runId,
          status: dbStatus.status,
          result: dbStatus.result,
          error: dbStatus.error ? {
            message: dbStatus.error.message || String(dbStatus.error),
            stack: process.env.NODE_ENV === 'development' ? dbStatus.error.stack : undefined,
          } : undefined,
          hook,
        },
        { status: 200 }
      );
    }

    // Fallback: Get status from workflow runtime if database doesn't have it
    // This can happen if the workflow just started and hasn't updated the database yet
    // Note: getRun() always returns a Run object - it doesn't throw
    const run = getRun(runId);

    // Get status from Run object
    // run.status is a getter that returns Promise<string>
    let runtimeStatus: string;
    let workflowError: any;
    let result: any;

    try {
      // Get status (this is a Promise that resolves to the current status)
      runtimeStatus = await run.status;

      // Only try to get returnValue if status is 'completed'
      // returnValue polls until completed, so calling it on non-completed workflows
      // will either poll indefinitely or throw WorkflowRunNotCompletedError
      if (runtimeStatus === 'completed') {
        try {
          result = await run.returnValue;
        } catch (returnValueError: any) {
          // This shouldn't happen if status is 'completed', but handle it anyway
          workflowError = {
            message: returnValueError?.message || String(returnValueError),
            stack: returnValueError?.stack,
          };
        }
      } else if (runtimeStatus === 'failed' || runtimeStatus === 'cancelled') {
        // For failed/cancelled workflows, try to get error details from returnValue
        // returnValue will throw WorkflowRunFailedError or WorkflowRunCancelledError
        try {
          await run.returnValue;
        } catch (errorDetails: any) {
          workflowError = {
            message: errorDetails?.message || String(errorDetails),
            stack: errorDetails?.stack,
          };
        }
      }
    } catch (statusError: any) {
      // Error getting status from run object
      console.error('[Orchestrate] Error getting workflow status:', {
        runId,
        error: statusError?.message || String(statusError),
      });
      runtimeStatus = 'error';
      workflowError = {
        message: statusError?.message || String(statusError),
        stack: process.env.NODE_ENV === 'development' ? statusError?.stack : undefined,
      };
    }

    console.log('[Orchestrate] Workflow status retrieved from runtime:', {
      runId,
      status: runtimeStatus,
      hasResult: !!result,
      hasError: !!workflowError,
    });

    return NextResponse.json(
      {
        runId,
        status: runtimeStatus,
        result,
        error: workflowError ? {
          message: workflowError.message || String(workflowError),
          stack: process.env.NODE_ENV === 'development' ? workflowError.stack : undefined,
        } : undefined,
        hook: undefined, // No hook token available from runtime
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[Orchestrate] Error in GET handler:', {
      runId: 'unknown',
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
