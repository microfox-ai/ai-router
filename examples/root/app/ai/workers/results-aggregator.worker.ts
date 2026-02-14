import { createWorker } from '@microfox/ai-worker';
import { z } from 'zod';

/**
 * Results Aggregator Worker
 *
 * Consumes processed data from demo (process mode) and creates a summary report.
 * Demonstrates how queue steps can transform and aggregate data from previous steps.
 */

/** Config for Lambda (timeout, memory). Extracted by ai-worker-cli when bundling. */
export const workerConfig = {
  timeout: 300,
  memorySize: 512,
};

export default createWorker({
  id: 'results-aggregator',
  inputSchema: z.object({
    // Receives output from demo (process) via mapInputFromPrev
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
  outputSchema: z.object({
    report: z.object({
      operation: z.enum(['analyze', 'transform', 'validate']),
      totalItems: z.number(),
      processed: z.number(),
      successRate: z.number(),
      averageProcessingTime: z.string(),
      insights: z.array(z.string()),
    }),
    timestamp: z.string(),
  }),
  handler: async ({ input, ctx }) => {
    await ctx.jobStore?.update({ status: 'running' });

    const { operation, totalItems, processed, results, summary } = input;

    // Calculate success rate
    const successRate = totalItems > 0 ? (summary.success / totalItems) * 100 : 0;

    // Generate insights based on operation type
    const insights: string[] = [];
    
    if (operation === 'analyze') {
      insights.push(`Analyzed ${totalItems} items successfully`);
      if (results.length > 0) {
        const types = new Set(results.map((r: any) => r.analysis?.type).filter(Boolean));
        insights.push(`Found ${types.size} different data types`);
      }
    } else if (operation === 'transform') {
      insights.push(`Transformed ${summary.success} items`);
      insights.push(`Transformation completed in ${summary.duration}`);
    } else if (operation === 'validate') {
      insights.push(`Validated ${totalItems} items`);
      insights.push(`Success rate: ${successRate.toFixed(1)}%`);
      if (summary.failed > 0) {
        insights.push(`Found ${summary.failed} validation errors`);
      }
    }

    // Calculate average processing time (simulated)
    const avgTime = totalItems > 0 ? Math.round(parseInt(summary.duration) / totalItems) : 0;

    const report = {
      operation,
      totalItems,
      processed,
      successRate: Math.round(successRate * 100) / 100,
      averageProcessingTime: `${avgTime}ms per item`,
      insights,
    };

    await ctx.jobStore?.update({
      status: 'completed',
      output: {
        report,
        timestamp: new Date().toISOString(),
      },
    });

    return {
      report,
      timestamp: new Date().toISOString(),
    };
  },
});
