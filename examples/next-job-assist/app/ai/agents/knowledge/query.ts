import { AiRouter } from '@microfox/ai-router';

const aiRouter = new AiRouter();

/**
 * This agent is resposible for fetching documents that would be of help based on the query.
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
