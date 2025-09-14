const aiRouter = new aiRouter();

/**
 * This agent is resposible for saving user profile and experience in to the rag.
 * requires hitl confirmation from the user if the information is being saved to the correct space.
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
