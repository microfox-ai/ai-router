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
  try{
  const body = await req.json();

  const agentFullPath = req.nextUrl.href.split('/api/studio/chat/agent')[1];
  const agentPath = agentFullPath.includes('?')
    ? agentFullPath.split('?')[0]
    : agentFullPath;

  const searchParams = req.nextUrl.searchParams;
  const params: any = {};
  
  // Merge query params first
  searchParams.entries().forEach(([key, value]) => {
    params[key] = value;
  });
  
  // Then merge body params (body params override query params)
  const { messages, ...restOfBody } = body;
  Object.assign(params, restOfBody);

  const lastMessage = body.messages?.[body.messages.length - 1] as UIMessage<{
    revalidatePath?: string;
  }>;

  return await aiMainRouter.toAwaitResponse(agentPath, {
    request: {
      messages: [],
      params,
    },
  });
  } catch (error: any) {
    console.error('agent error', error);
    return {
      ok: false,
      error: error.message || 'Unknown error',
    };
  }
}
