import { NextRequest, NextResponse } from 'next/server';
import { agentWorkflowFn } from '../agentWorkflow';

// GET example: http://localhost:3000/api/studio/workflow/agent/thinker/questions?userIntent=

export async function GET(req: NextRequest) {
  const agentFullPath = req.nextUrl.href.split('/api/studio/workflow/agent')[1];
  const agentPath = agentFullPath.includes('?')
    ? agentFullPath.split('?')[0]
    : agentFullPath;

  const searchParams = req.nextUrl.searchParams;
  const params: any = {};
  searchParams.entries().forEach(([key, value]) => {
    params[key] = value;
  });

  // Construct base URL for the agent endpoint
  const baseUrl = req.nextUrl.origin;

  try {
    // Import workflow API
    const workflowApi = await import('workflow/api');
    const { start } = workflowApi;

    // Start the workflow
    const run = await start(agentWorkflowFn, [{
      agentPath,
      input: params,
      baseUrl: `${baseUrl}/api/studio/chat/agent`,
      messages: [],
    }]);

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

// POST example:
// curl -X POST http://localhost:3000/api/studio/workflow/agent/thinker/questions
//      -H "Content-Type: application/json"
//      -d '{"messages": [{"role": "user", "content": "What is the capital of France?"}], "input": {...}}'

export async function POST(req: NextRequest) {
  const body = await req.json();

  const agentFullPath = req.nextUrl.href.split('/api/studio/workflow/agent')[1];
  const agentPath = agentFullPath.includes('?')
    ? agentFullPath.split('?')[0]
    : agentFullPath;

  const searchParams = req.nextUrl.searchParams;
  const params: any = {};
  searchParams.entries().forEach(([key, value]) => {
    params[key] = value;
  });

  // Extract input and messages from body
  const { messages, input, ...restOfBody } = body;
  const agentInput = input || restOfBody;

  // Construct base URL for the agent endpoint
  const baseUrl = req.nextUrl.origin;

  try {
    // Import workflow API
    const workflowApi = await import('workflow/api');
    const { start } = workflowApi;

    // Start the workflow
    const run = await start(agentWorkflowFn, [{
      agentPath,
      input: agentInput,
      baseUrl: `${baseUrl}/api/studio/chat/agent`,
      messages: messages || [],
    }]);

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
