const aiRouter = new aiRouter();

/**
 * This agent is resposible for generating a job application based on the request.
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
