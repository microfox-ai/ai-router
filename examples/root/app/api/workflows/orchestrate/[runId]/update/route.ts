import { NextRequest, NextResponse } from 'next/server';
import { workflowStatusStore } from '../../../stores/workflowStatusStore';

/**
 * POST /api/workflows/orchestrate/:runId/update - Update workflow status in database
 * 
 * Called by the workflow itself via status update step function to update its status
 * when reaching hooks/sleep/completion.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const body = await req.json();
    
    const { status, hookToken, error, result } = body;

    if (!runId) {
      return NextResponse.json(
        { error: 'Run ID is required' },
        { status: 400 }
      );
    }

    if (!status) {
      return NextResponse.json(
        { error: 'Status is required' },
        { status: 400 }
      );
    }

    console.log('[Orchestrate] Updating workflow status:', {
      runId,
      status,
      hasHookToken: hookToken !== undefined,
      hookToken: hookToken || '(not set)',
    });

    // Update status in database
    // hookToken can be undefined (to clear), a string (to set), or not provided (to preserve)
    await workflowStatusStore.updateStatus(runId, {
      status,
      ...(hookToken !== undefined && { hookToken: hookToken || undefined }), // Only include if explicitly provided
      ...(error !== undefined && { error }),
      ...(result !== undefined && { result }),
    });

    return NextResponse.json(
      { success: true, runId, status },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[Orchestrate] Error updating workflow status:', {
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
