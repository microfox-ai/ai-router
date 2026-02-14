import { createWorker } from '@microfox/ai-worker';
import { z } from 'zod';

/**
 * Demo Worker – multi-feature worker for testing and demos.
 *
 * Modes:
 * - echo: quick echo (worker-demo, child for dispatch-demo).
 * - process: batch processing with progress (queue step 1, orchestration).
 * - dispatch-demo: proves ctx.dispatchWorker with await: true and await: false.
 *   Requires a configured job store (e.g. WORKER_UPSTASH_REDIS_REST_* in Lambda env)
 *   so the runtime can poll the child job and return its output when await: true.
 */
const echoInput = z.object({
  mode: z.literal('echo'),
  message: z.string(),
});
const processInput = z.object({
  mode: z.literal('process'),
  data: z.array(z.any()).optional(),
  content: z.string().optional(),
  operation: z.enum(['analyze', 'transform', 'validate']),
  batchSize: z.number().optional().default(10),
});
const dispatchDemoInput = z.object({
  mode: z.literal('dispatch-demo'),
});

// Orchestration/queue may send process payload without mode
const processInputLegacy = z.object({
  data: z.array(z.any()).optional(),
  content: z.string().optional(),
  operation: z.enum(['analyze', 'transform', 'validate']),
  batchSize: z.number().optional(),
});

// Queue/schedule may send empty {} for first step; treat as process with defaults
const processInputMinimal = z.object({
  data: z.array(z.any()).optional(),
  content: z.string().optional(),
  operation: z.enum(['analyze', 'transform', 'validate']).optional(),
  batchSize: z.number().optional(),
});

const inputSchema = z.union([
  z.discriminatedUnion('mode', [echoInput, processInput, dispatchDemoInput]),
  processInputLegacy,
  processInputMinimal,
]);

const echoOutput = z.object({
  echoed: z.string(),
  at: z.string(),
});
const processOutput = z.object({
  operation: z.enum(['analyze', 'transform', 'validate']),
  totalItems: z.number(),
  processed: z.number(),
  results: z.array(z.any()),
  summary: z.object({
    success: z.number(),
    failed: z.number(),
    duration: z.string(),
  }),
});
const dispatchDemoOutput = z.object({
  // Optional when job store is not configured in Lambda (dispatch with await: true then returns no output).
  awaited: z.object({ echoed: z.string(), at: z.string() }).optional(),
  fireJobId: z.string(),
});

const outputSchema = z.union([echoOutput, processOutput, dispatchDemoOutput]);

/** Config for Lambda (timeout, memory). Extracted by ai-worker-cli when bundling. */
export const workerConfig = {
  timeout: 300,
  memorySize: 512,
};

export default createWorker({
  id: 'demo',
  inputSchema,
  outputSchema: outputSchema as any,
  handler: async ({ input, ctx }) => {
    const raw = input as any;
    // Queue/schedule often sends {} or { __workerQueue }; treat as process with defaults
    const mode =
      raw.mode ??
      (raw.operation != null ? 'process' : undefined) ??
      (raw.__workerQueue ? 'process' : undefined);
    if (mode === 'echo') {
      await ctx.jobStore?.update({ status: 'running' });
      const echoed = String(raw.message ?? '');
      const at = new Date().toISOString();
      await ctx.jobStore?.update({ status: 'completed', output: { echoed, at } });
      return { echoed, at };
    }

    if (mode === 'dispatch-demo') {
      await ctx.jobStore?.update({ status: 'running' });
      // Prove dispatchWorker with await: true (block until child completes).
      // Requires job store in Lambda so the runtime can poll and return child.output.
      const awaited = await ctx.dispatchWorker(
        'demo',
        { mode: 'echo', message: 'child-await' },
        { await: true }
      );
      // Prove dispatchWorker with await: false (fire-and-forget, return jobId)
      const { jobId: fireJobId } = await ctx.dispatchWorker(
        'demo',
        { mode: 'echo', message: 'child-fire' },
        { await: false }
      );
      const result = {
        awaited: awaited?.output as { echoed: string; at: string } | undefined,
        fireJobId,
      };
      await ctx.jobStore?.update({ status: 'completed', output: result });
      return result;
    }

    // process (mode === 'process' or legacy payload with operation or minimal/queue input)
    const data = raw.data ?? (raw.content != null ? [raw.content] : []);
    const operation = raw.operation ?? 'transform';
    const batchSize = raw.batchSize ?? 10;
    const totalItems = data.length;
    let processed = 0;
    const results: any[] = [];

    await ctx.jobStore?.update({ status: 'running' });

    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      const processingTime = 1000 + Math.random() * 2000;
      await new Promise((r) => setTimeout(r, processingTime));

      let batchResults: any[];
      switch (operation) {
        case 'analyze':
          batchResults = batch.map((item: unknown, idx: number) => ({
            index: i + idx,
            value: item,
            analysis: {
              type: typeof item,
              length: typeof item === 'string' ? item.length : undefined,
              keys: typeof item === 'object' && item !== null ? Object.keys(item as object) : undefined,
            },
          }));
          break;
        case 'transform':
          batchResults = batch.map((item: unknown, idx: number) => ({
            index: i + idx,
            original: item,
            transformed:
              typeof item === 'string'
                ? item.toUpperCase()
                : typeof item === 'number'
                  ? item * 2
                  : { ...(typeof item === 'object' && item !== null ? (item as object) : {}), processed: true, timestamp: new Date().toISOString() },
          }));
          break;
        default:
          batchResults = batch.map((item: unknown, idx: number) => ({
            index: i + idx,
            value: item,
            valid: item != null,
            errors: item == null ? ['Value is null or undefined'] : [],
          }));
      }

      results.push(...batchResults);
      processed += batch.length;
      const progress = Math.round((processed / totalItems) * 100);
      await ctx.jobStore?.update({
        progress,
        progressMessage: `Processed ${processed}/${totalItems} items (${operation})`,
        metadata: {
          processed,
          total: totalItems,
          currentBatch: Math.floor(i / batchSize) + 1,
          totalBatches: Math.ceil(totalItems / batchSize),
        },
      });
    }

    const output = {
      operation,
      totalItems,
      processed,
      results,
      summary: {
        success: results.length,
        failed: 0,
        duration: `${Math.round(processed * 1.5)}ms (simulated)`,
      },
    };
    await ctx.jobStore?.update({ status: 'completed', output });
    return output;
  },
});
