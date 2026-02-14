import { defineWorkerQueue } from '@microfox/ai-worker';

/**
 * Worker queue: demo-data-processor
 *
 * Multi-step demo queue showcasing all queue features:
 * 1. Sequential step execution
 * 2. Data passing between steps (mapInputFromPrev)
 * 3. Delayed step execution (delaySeconds)
 *
 * Pipeline:
 * - Step 1: demo (process mode) - Processes initial data array
 * - Step 2: results-aggregator - Aggregates and summarizes results (with 2s delay)
 *   Uses mapInputFromPrev to transform data-processor output into aggregator input
 */
export default defineWorkerQueue({
  id: 'demo-data-processor',
  steps: [
    // Step 1: Process the initial data
    { workerId: 'demo' },
    // Step 2: Aggregate results with a delay and data transformation
    {
      workerId: 'results-aggregator',
      delaySeconds: 2, // Wait 2 seconds before starting aggregation
      mapInputFromPrev: 'mapAggregatorInput', // Transform data-processor output
    },
  ],
  // Every 5 minutes – comment out after testing to avoid unnecessary cron runs
  // schedule: 'rate(5 minutes)',
});

/** One previous step's output (for mapping context). */
export type QueueStepOutput = {
  stepIndex: number;
  workerId: string;
  output: unknown;
};

/**
 * Mapping function: (initialInput, previousOutputs) → input for this step.
 * Best practice: first param is the original request, second is all prior step outputs.
 * Use previousOutputs[previousOutputs.length - 1]?.output for the immediate previous step; use index i for step i.
 */
export function mapAggregatorInput(
  initialInput: {
    data: any[];
    operation: 'analyze' | 'transform' | 'validate';
    batchSize?: number;
  },
  previousOutputs: QueueStepOutput[]
) {
  const lastStep = previousOutputs.length > 0 ? previousOutputs[previousOutputs.length - 1] : undefined;
  const prevOutput = lastStep?.output as {
    operation: 'analyze' | 'transform' | 'validate';
    totalItems: number;
    processed: number;
    results: any[];
    summary: { success: number; failed: number; duration: string };
  } | undefined;
  if (!prevOutput) {
    throw new Error('mapAggregatorInput expects previous step (demo process) output');
  }
  return {
    operation: prevOutput.operation,
    totalItems: prevOutput.totalItems,
    processed: prevOutput.processed,
    results: prevOutput.results,
    summary: prevOutput.summary,
  };
}
