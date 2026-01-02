import { aiMainRouter } from '@/app/ai';
import { UIMessage } from 'ai';
import { NextRequest } from 'next/server';

//get example: http://localhost:3000/api/studio/chat/agent/thinker/questions?userIntent=

export async function GET(req: NextRequest) {
  const agentFullPath = req.nextUrl.href.split('/api/studio/chat/agent')[1];
  const agentPath = agentFullPath.includes('?')
    ? agentFullPath.split('?')[0]
    : agentFullPath;

  const searchParams = req.nextUrl.searchParams;
  const params: any = {};
  searchParams.entries().forEach(([key, value]) => {
    params[key] = value;
  });
  const response = await aiMainRouter.toAwaitResponse(agentPath, {
    request: {
      messages: [],
      params,
    },
  });

  return response;
}

//post example:
// curl -X POST http://localhost:3000/api/studio/chat/agent/thinker/questions
//      -H "Content-Type: application/json"
//      -d '{"messages": [{"role": "user", "content": "What is the capital of France?"}]}'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const agentFullPath = req.nextUrl.href.split('/api/studio/chat/agent')[1];
    const agentPath = agentFullPath.includes('?')
      ? agentFullPath.split('?')[0]
      : agentFullPath;

    const searchParams = req.nextUrl.searchParams;
    const params: any = {};
    searchParams.entries().forEach(([key, value]) => {
      params[key] = value;
    });

    // Merge body params with query params, body params take precedence
    const mergedParams = { ...params, ...body };

    return await aiMainRouter.toAwaitResponse(agentPath, {
      request: {
        messages: [], // Messages are not used in this example, but kept for compatibility
        params: mergedParams,
      },
    });
  } catch (error: any) {
    console.error('agent error', error);
    return Response.json(
      {
        ok: false,
        error: error.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
