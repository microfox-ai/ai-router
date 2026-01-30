import { createWorker } from '@microfox/ai-worker';
import { z } from 'zod';

/**
 * Timed Sleep Worker
 *
 * Purpose: provide a clear, timestamped proof of execution ordering.
 * - Records startedAt/finishedAt in ISO time.
 * - Sleeps for `sleepMs` to make parallel vs sequential behavior visible.
 */
export default createWorker({
  id: 'timed-sleep',
  inputSchema: z.object({
    label: z.string().describe('Label to identify this invocation'),
    sleepMs: z.number().int().min(0).max(60_000).describe('Sleep duration in milliseconds'),
  }),
  outputSchema: z.object({
    label: z.string(),
    sleepMs: z.number(),
    startedAt: z.string(),
    finishedAt: z.string(),
    durationMs: z.number(),
  }),
  handler: async ({ input, ctx }) => {
    const startedAt = new Date().toISOString();
    await ctx.jobStore?.update({
      status: 'running',
      metadata: { label: input.label, startedAt, sleepMs: input.sleepMs },
    });

    const start = Date.now();
    await new Promise((resolve) => setTimeout(resolve, input.sleepMs));
    const durationMs = Date.now() - start;
    const finishedAt = new Date().toISOString();

    const output = {
      label: input.label,
      sleepMs: input.sleepMs,
      startedAt,
      finishedAt,
      durationMs,
    };

    await ctx.jobStore?.update({ status: 'completed', output });
    return output;
  },
});

