import { NextRequest, NextResponse } from 'next/server';
import { workflowStatusStore } from '../../../stores/workflowStatusStore';

/**
 * GET /api/workflows/orchestrate/run-id/:executionId - Get runId from executionId
 * 
 * Used by the workflow to look up its runId using the executionId provided in the request.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    const { executionId } = await params;

    if (!executionId) {
      return NextResponse.json(
        { error: 'executionId is required' },
        { status: 400 }
      );
    }

    const runId = await workflowStatusStore.getRunIdByExecutionId(executionId);

    if (!runId) {
      return NextResponse.json(
        { error: `No runId found for executionId: ${executionId}` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      runId,
      executionId,
    });
  } catch (error: any) {
    console.error('[Orchestrate] Error getting runId:', {
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
