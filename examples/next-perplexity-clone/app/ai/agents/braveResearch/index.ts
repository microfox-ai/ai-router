import { AiRouter } from '@microfox/ai-router';
import { z } from 'zod';
import { deepResearchAgent } from './deep';
import { fastResearchAgent } from './fast';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';

const aiRouter = new AiRouter();

export const braveResearchAgent = aiRouter
  .agent('/deep', deepResearchAgent)
  .agent('/fast', fastResearchAgent)
  .agent('/', async (ctx) => {
    //return deepResearch(ctx);
    ctx.response.writeMessageMetadata({
      loader: 'Researching...',
    });
    const { query, count } = ctx.request.params;
    const queryObject = await generateObject({
      model: google('gemini-2.5-flash'),
      schema: z.object({
        deep: z
          .boolean()
          .describe('Whether to use deep search which will take more time'),
        count: z.number().describe('The number of results to return'),
        freshness: z.enum(['pd', 'pw', 'pm', 'py']),
      }),
      prompt: 'Generate a query for the brave research',
    });
    console.log('RESEARCH PARAM USAGE', queryObject.usage);
    const result = await ctx.next.callAgent(
      queryObject.object.deep ? '/fast' : '/fast',
      {
        query,
        type: 'web',
        count: queryObject.object.count,
        freshness: queryObject.object.freshness,
      },
      {
        streamToUI: true,
      },
    );
    if (result.ok) {
      // append the result to the research data
      ctx.state.researchData = ctx.state.researchData
        ? [...ctx.state.researchData, result.data]
        : [result.data];

      // ONLY Output the status to save token usage on the orchestration.
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
