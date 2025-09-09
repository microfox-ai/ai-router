import { aiMainRouter } from '@/app/ai';
import { UIMessage } from 'ai';
import { NextRequest } from 'next/server';

export const maxDuration = 300_1000;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { messages, ...restOfBody } = body;
  const lastMessage = body.messages?.[body.messages.length - 1] as UIMessage<{
    revalidatePath?: string;
  }>;
  const revalidatePath = lastMessage?.metadata?.revalidatePath;

  return aiMainRouter.handle(revalidatePath ? revalidatePath : '/', {
    request: {
      ...body,
      loadedRevalidatePath: revalidatePath,
    },
  });
}
