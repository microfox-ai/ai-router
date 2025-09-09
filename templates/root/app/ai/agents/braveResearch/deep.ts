import { AiRouter } from '@microfox/ai-router';
import z from 'zod';

const aiRouter = new AiRouter<any, any>();

export const deepResearchAgent = aiRouter
  .agent('/', async (ctx) => {
    const { query } = ctx.request.params;
    console.log('query', query);
  })
  .actAsTool('/', {
    id: 'braveResearchDeep',
    name: 'Deep Search',
    description: 'Deep Search the web for information',
    inputSchema: z.object({
      query: z.string(),
    }),
    outputSchema: z.object({
      searchType: z.enum(['web', 'image', 'video', 'news']),
      response: z.any(),
    }),
    metadata: {
      icon: 'https://raw.githubusercontent.com/microfox-ai/microfox/refs/heads/main/logos/brave.svg',
      title: 'Deep Search',
      parent: 'research_brave',
    },
  });
