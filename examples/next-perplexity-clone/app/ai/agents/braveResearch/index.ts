import { AiRouter } from '@microfox/ai-router';
import { z } from 'zod';
import { deepResearchAgent } from './deep';
import { fastResearchAgent } from './fast';

const aiRouter = new AiRouter();

export const braveResearchAgent = aiRouter
  .agent('/deep', deepResearchAgent)
  .agent('/fast', fastResearchAgent)
  .agent('/', async (ctx) => {
    //return deepResearch(ctx);
    const { query, deep, count } = ctx.request.params;
    const result = await ctx.next.callAgent(
      deep ? '/deep' : '/fast',
      {
        query,
        type: 'web',
        count,
      },
      {
        streamToUI: true,
      },
    );
    if (result.ok) {
      ctx.state.braveResearch = {
        data: result.data,
      };
      return {
        status: 'Research Completed!',
      };
    } else {
      throw result.error;
    }
  })
  .actAsTool('/', {
    id: 'braveResearch',
    name: 'Brave Research',
    description: 'Research the web for information with brave search',
    inputSchema: z.object({
      query: z.string().describe('The query to search for'),
      deep: z
        .boolean()
        .optional()
        .describe('Whether to use deep search which will take more time'),
      count: z.number().optional().describe('The number of results to return'),
    }),
    outputSchema: z.object({
      status: z.string().describe('The status of the research'),
    }),
    metadata: {
      icon: 'https://raw.githubusercontent.com/microfox-ai/microfox/refs/heads/main/logos/brave.svg',
      title: 'Brave Research',
      hideUI: true,
    },
  });
