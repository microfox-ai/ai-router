import { createWorker } from '@microfox/ai-worker';
import { z } from 'zod';

/**
 * Data Processor Worker
 * Simulates a long-running data processing task with progress updates.
 */
export default createWorker({
  id: 'data-processor',
  inputSchema: z.object({
    data: z.array(z.any()).describe('Array of data items to process'),
    operation: z.enum(['analyze', 'transform', 'validate']).describe('Type of operation to perform'),
    batchSize: z.number().optional().default(10).describe('Number of items to process per batch'),
  }),
  outputSchema: z.object({
    operation: z.enum(['analyze', 'transform', 'validate']),
    totalItems: z.number(),
    processed: z.number(),
    results: z.array(z.any()),
    summary: z.object({
      success: z.number(),
      failed: z.number(),
      duration: z.string(),
    }),
  }),
  handler: async ({ input, ctx }) => {
    const { data, operation, batchSize = 10 } = input;
    const totalItems = data.length;
    let processed = 0;
    const results: any[] = [];

    // Update status to running
    await ctx.jobStore?.update({ status: 'running' });

    // Process data in batches
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      
      // Simulate processing time (1-3 seconds per batch)
      const processingTime = 1000 + Math.random() * 2000;
      await new Promise(resolve => setTimeout(resolve, processingTime));

      // Process batch based on operation type
      let batchResults: any[];
      switch (operation) {
        case 'analyze':
          batchResults = batch.map((item, idx) => ({
            index: i + idx,
            value: item,
            analysis: {
              type: typeof item,
              length: typeof item === 'string' ? item.length : undefined,
              keys: typeof item === 'object' && item !== null ? Object.keys(item) : undefined,
            },
          }));
          break;
        case 'transform':
          batchResults = batch.map((item, idx) => ({
            index: i + idx,
            original: item,
            transformed: typeof item === 'string' 
              ? item.toUpperCase() 
              : typeof item === 'number'
              ? item * 2
              : { ...item, processed: true, timestamp: new Date().toISOString() },
          }));
          break;
        case 'validate':
          batchResults = batch.map((item, idx) => ({
            index: i + idx,
            value: item,
            valid: item !== null && item !== undefined,
            errors: item === null || item === undefined ? ['Value is null or undefined'] : [],
          }));
          break;
      }

      results.push(...batchResults);
      processed += batch.length;

      // Update progress
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

    // Update status to completed
    await ctx.jobStore?.update({
      status: 'completed',
      output: {
        operation,
        totalItems,
        processed,
        results,
        summary: {
          success: results.length,
          failed: 0,
          duration: `${Math.round(processed * 1.5)}ms (simulated)`,
        },
      },
    });

    return {
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
  },
});
