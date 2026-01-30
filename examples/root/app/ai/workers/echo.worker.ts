import { createWorker } from '@microfox/ai-worker';
import { z } from 'zod';

/**
 * Echo Worker
 * Fast, deterministic worker for orchestration-test workflows.
 * Returns { echoed, at } for await + polling tests.
 */
export default createWorker({
  id: 'echo',
  inputSchema: z.object({
    message: z.string().describe('Message to echo back'),
  }),
  outputSchema: z.object({
    echoed: z.string(),
    at: z.string(),
  }),
  handler: async ({ input, ctx }) => {
    await ctx.jobStore?.update({ status: 'running' });
    const echoed = String(input.message ?? '');
    const at = new Date().toISOString();
    await ctx.jobStore?.update({
      status: 'completed',
      output: { echoed, at },
    });
    return { echoed, at };
  },
});
