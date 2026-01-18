import { NextRequest, NextResponse } from 'next/server';
import { orchestrateWorkflowFn } from './orchestrateWorkflow';
import type { OrchestrationConfig } from '@microfox/ai-router/workflow/orchestrate';

// POST endpoint to start an orchestration workflow
// Example: curl -X POST http://localhost:3000/api/studio/workflow/orchestrate \
//   -H "Content-Type: application/json" \
//   -d '{"config": {"steps": [...], "input": {...}}, "messages": []}'

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

    // Merge input into config if provided
    const orchestrationConfig: OrchestrationConfig = {
      ...config,
      input: input || config.input,
      messages: messages || config.messages || [],
    };

    // Construct base URL for agent calls
    const baseUrl = req.nextUrl.origin;

    // Import workflow API
    const workflowApi = await import('workflow/api');
    const { start } = workflowApi;

    if (!start) {
      throw new Error(
        '[orchestrate] `workflow/api` does not export `start`. ' +
          'Check that you are using a compatible version of the workflow runtime.',
      );
    }

    // Start the orchestration workflow
    const run = await start(orchestrateWorkflowFn, [{
      config: orchestrationConfig,
      baseUrl: `${baseUrl}/api/studio/chat/agent`,
    }]);
    
    // Get runId after starting (needed for token generation in context)
    const runId = run.runId;

    // Get the current status
    const status: string = await run.status;

    return NextResponse.json({
      runId: run.runId,
      status,
    }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
