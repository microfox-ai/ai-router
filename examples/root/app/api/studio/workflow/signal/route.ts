import { NextRequest, NextResponse } from 'next/server';

// POST endpoint to signal/resume a workflow hook
// Example: curl -X POST http://localhost:3000/api/studio/workflow/signal \
//   -H "Content-Type: application/json" \
//   -d '{"token": "research-approval:topic:email", "payload": {"decision": "approve"}}'

export async function POST(req: NextRequest) {
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

    // Import workflow API
    const workflowApi = await import('workflow/api');
    const { resumeHook } = workflowApi;

    if (!resumeHook) {
      throw new Error(
        '[workflow] `workflow/api` does not export `resumeHook`. ' +
          'Check that you are using a compatible version of the workflow runtime.',
      );
    }

    // Resume the hook with token and payload
    try {
      await resumeHook(token, payload);

      // Return success response
      return NextResponse.json(
        {
          status: 'resumed',
          message: 'Hook resumed successfully',
        },
        { status: 200 }
      );
    } catch (error: any) {
      // If hook resume fails, try webhook resume as fallback
      try {
        const { resumeWebhook } = workflowApi;
        if (resumeWebhook) {
          await resumeWebhook(token, payload);
          return NextResponse.json(
            {
              status: 'resumed',
              message: 'Webhook resumed successfully',
            },
            { status: 200 }
          );
        }
      } catch (webhookError: any) {
        // If both fail, return the original hook error
        return NextResponse.json(
          {
            error: `Failed to resume workflow hook/webhook: ${error?.message || String(error)}. ` +
              `Make sure the token is correct and the workflow is waiting for a signal.`,
          },
          { status: 400 }
        );
      }

      // If webhook resume also failed or doesn't exist, return hook error
      return NextResponse.json(
        {
          error: `Failed to resume workflow hook: ${error?.message || String(error)}. ` +
            `Make sure the token is correct and the workflow is waiting for a signal.`,
        },
        { status: 400 }
      );
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
