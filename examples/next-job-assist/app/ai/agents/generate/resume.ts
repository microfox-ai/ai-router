import { AiRouter } from '@microfox/ai-router';

const aiRouter = new AiRouter();

/**
 * This agent is resposible for generating a pdf fine-tuned resume based on the request.
 */
export const ragProfileAgent = aiRouter
  .agent('/', async (ctx) => {
    return {
      message: 'Hello, world!',
    };
  })
  .actAsTool('/', {
    description: 'A tool to get the profile of the user',
    inputSchema: z.object({
      name: z.string(),
    }),
  });
