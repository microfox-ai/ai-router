import { google } from '@ai-sdk/google';
import { AiRouter } from '@microfox/ai-router';
import { z } from 'zod';
import { streamText, convertToModelMessages } from 'ai';

const aiRouter = new AiRouter();

export const systemAgent = aiRouter
  .agent('/current_date', async () => {
    return { result: new Date().toLocaleDateString() };
  })
  .actAsTool('/current_date', {
    id: 'systemCurrentDate',
    name: 'Get Current Date',
    description: 'Get the current date.',
    inputSchema: z.object({}),
    execute: async () => ({ result: new Date().toLocaleDateString() }),
    metadata: {
      hideUI: true,
    },
  })
  .agent('/current_time', async (ctx) => {
    const { format } = ctx.request.params;
    return {
      result: new Date().toLocaleTimeString('en-US', {
        hour12: format === '12h',
      }),
    };
  })
  .actAsTool('/current_time', {
    id: 'systemCurrentTime',
    name: 'Get Current Time',
    description: 'Get the current time in 12-hour or 24-hour format.',
    inputSchema: z.object({
      format: z.enum(['12h', '24h']).describe('The desired time format.'),
    }),
    execute: async ({ format }) => ({
      result: new Date().toLocaleTimeString('en-US', {
        hour12: format === '12h',
      }),
    }),
    metadata: {
      hideUI: true,
    },
  });
