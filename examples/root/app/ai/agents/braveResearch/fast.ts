import { AiRouter } from '@microfox/ai-router';
import { InferUITool, InferUITools } from 'ai';
import z from 'zod';
import { createBraveSDK, WebSearchParamsSchema } from '@microfox/brave';

type WebSearchParams = z.infer<typeof WebSearchParamsSchema>;
const aiRouter = new AiRouter<any, any>();

export const fastResearchAgent = aiRouter
  .agent('/', async (ctx) => {
    const { query, queries, type, country, count, freshness } =
      ctx.request.params;

    const braveSDK = createBraveSDK({
      apiKey: process.env.BRAVE_API_KEY,
    });

    if (queries && queries.length > 0) {
      let results: any;
      let params = queries.map((_query: string[]) => ({
        q: _query,
        count,
        freshness,
      }));
      switch (type) {
        case 'web':
          results = await braveSDK.batchWebSearch(params);
          break;
        case 'image':
          results = await braveSDK.batchImageSearch(params);
          break;
        case 'video':
          results = await braveSDK.batchVideoSearch(params);
          break;
        case 'news':
          results = await braveSDK.batchNewsSearch(params);
          break;
      }
      return {
        response: results,
        searchInput: { type, ...params },
      };
    } else if (query) {
      let params: any = {
        q: query,
        count,
        freshness,
      };
      let results: any;
      switch (type) {
        case 'web':
          results = await braveSDK.webSearch(params);
          break;
        case 'image':
          results = await braveSDK.imageSearch(params);
          break;
        case 'news':
          results = await braveSDK.newsSearch(params);
          break;
        case 'video':
          results = await braveSDK.videoSearch(params);
          break;
      }
      return { response: results, searchInput: { type, ...params } };
    } else {
      throw new Error('No query or queries provided');
    }
  })
  .actAsTool('/', {
    id: 'braveResearchFast',
    name: 'Fast Search',
    description: 'Deep Search the web for information',
    inputSchema: z
      .object({
        query: z.string().optional(),
        queries: z.array(z.string()).optional(),
        type: z.enum(['web', 'image', 'video', 'news']),
      })
      .extend(
        WebSearchParamsSchema.pick({
          country: true,
          count: true,
          freshness: true,
        }).shape,
      )
      .refine((data) => !!data.query || !!data.queries?.length, {
        message: 'Either a single query or a list of queries must be provided.',
        path: ['query'],
      }),
    outputSchema: z.object({
      searchInput: z.object({
        type: z.enum(['web', 'image', 'video', 'news']),
        country: z.string().optional(),
        count: z.number().optional(),
        freshness: z.string().optional(),
      }),
      response: z.any().or(z.array(z.any())),
    }),
    metadata: {
      icon: 'https://raw.githubusercontent.com/microfox-ai/microfox/refs/heads/main/logos/brave.svg',
      title: 'Fast Researcher',
      parentTitle: 'Brave',
    },
  });
