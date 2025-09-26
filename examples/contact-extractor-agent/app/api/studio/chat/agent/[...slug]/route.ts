import { aiMainRouter } from '@/app/ai';
import { UIMessage } from 'ai';
import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  //const body = req.body;
  const agentFullPath = req.nextUrl.href.split('/api/studio/chat/agent')[1];
  const agentPath = agentFullPath.includes('?')
    ? agentFullPath.split('?')[0]
    : agentFullPath;

  const searchParams = req.nextUrl.searchParams;
  const params: any = {};
  searchParams.entries().forEach(([key, value]) => {
    params[key] = value;
  });

  //const revalidatePath = lastMessage?.metadata?.revalidatePath;

  const response = await aiMainRouter.toAwaitResponse(agentPath, {
    request: {
      messages: [],
      params,
      //loadedRevalidatePath: agentPath,
    },
  });

  return response;
}

export async function POST(req: NextRequest) {
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

  const { messages, ...restOfBody } = body;
  const lastMessage = body.messages?.[body.messages.length - 1] as UIMessage<{
    revalidatePath?: string;
  }>;
  //const revalidatePath = lastMessage?.metadata?.revalidatePath;

  return await aiMainRouter.toAwaitResponse(agentPath, {
    request: {
      ...body,
      params,
      //loadedRevalidatePath: agentPath,
    },
  });
}
