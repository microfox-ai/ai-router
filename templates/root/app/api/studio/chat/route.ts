import { aiMainRouter } from '@/app/ai';
import { UIMessage } from 'ai';

export const maxDuration = 5 * 60 * 1000;

export async function POST(req: Request) {
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
