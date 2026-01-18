import { NextRequest, NextResponse } from 'next/server';

// GET endpoint to get workflow status by runId
// Example: http://localhost:3000/api/studio/workflow/status?runId=wrun_xxx

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const runId = searchParams.get('runId');

  if (!runId) {
    return NextResponse.json(
      { error: 'runId query parameter is required' },
      { status: 400 }
    );
  }

  try {
    // Import workflow API
    const workflowApi = await import('workflow/api');
    const { getRun } = workflowApi;

    if (!getRun) {
      throw new Error(
        '[workflow] `workflow/api` does not export `getRun`. ' +
          'Check that you are using a compatible version of the workflow runtime.',
      );
    }

    // Get the run object
    const run = getRun(runId);
    if (!run) {
      return NextResponse.json(
        { error: `Workflow run ${runId} not found` },
        { status: 404 }
      );
    }

    // Get the current status
    let status: string;
    let workflowError: any;
    try {
      status = await run.status;
      try {
        const errorValue = await (run as any).error;
        if (errorValue) {
          workflowError = errorValue;
          if (status === 'running' || status === 'pending') {
            status = 'failed';
          }
        }
      } catch {
        // run.error might not be available or might throw - that's okay
      }
    } catch (err: any) {
      status = 'error';
      workflowError = err;
    }

    // Get result if completed
    let result: any;
    let error: any;

    if (status === 'completed') {
      try {
        result = await run.returnValue;
      } catch (err: any) {
        error = err;
      }
    } else if (status === 'failed' || status === 'error') {
      error = workflowError;
    }

    // Build response
    const response: any = {
      runId,
      status,
    };

    if (result !== undefined) {
      response.result = result;
    }

    if (error) {
      response.error = error?.message || String(error);
    }

    // If paused, include hook information
    if (status === 'paused') {
      response.hook = {
        token: '', // Token must be provided by caller - construct it using workflow input and runId
        type: 'hook',
      };
    }

    return NextResponse.json(response, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
