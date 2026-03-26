import {
  defineHitlConfig,
  defineWorkerQueue,
  type ChainContext,
  type HitlResumeContext,
  type SmartRetryConfig,
} from '@microfox/ai-worker';
import { z } from 'zod';

/** Reviewer form — import in UI from this queue file. */
export const demoDataProcessorHitlInputSchema = z.object({
  decision: z.enum(['approve', 'reject', 'needs_changes']),
  reviewNotes: z.string().min(10),
  correctedOperation: z.enum(['analyze', 'transform', 'validate']).optional(),
  maxItemsToProcess: z.number().min(1).optional(),
});
export type DemoDataProcessorHitlInput = z.infer<typeof demoDataProcessorHitlInputSchema>;

const reviewAggregatedResultsHitl = defineHitlConfig({
  taskKey: 'review-aggregated-results',
  timeoutSeconds: 60 * 60 * 24,
  onTimeout: 'reject',
  assignees: ['ops-team', 'risk-analyst'],
  ui: {
    type: 'custom',
    viewId: 'queue-demo-hitl-v1',
    title: 'Review transformed output before finalization',
    sections: [
      { type: 'progress' },
      { type: 'previous-outputs', stepIndex: 0 },
      { type: 'json-diff', left: 'raw', right: 'transformed' },
      { type: 'form', schemaRef: 'QueueDemoReviewInput' },
    ],
  },
  inputSchema: demoDataProcessorHitlInputSchema,
});

type DemoProcessOutput = {
  operation: 'analyze' | 'transform' | 'validate';
  totalItems: number;
  processed: number;
  results: unknown[];
  summary: { success: number; failed: number; duration: string };
};

/**
 * Chain: transform data-processor output into aggregator input.
 */
function chainToAggregator(ctx: ChainContext) {
  const lastStep = ctx.previousOutputs[ctx.previousOutputs.length - 1];
  const prevOutput = lastStep?.output as DemoProcessOutput | undefined;
  if (!prevOutput) {
    throw new Error('chainToAggregator expects previous step (demo process) output');
  }
  return {
    operation: prevOutput.operation,
    totalItems: prevOutput.totalItems,
    processed: prevOutput.processed,
    results: prevOutput.results,
    summary: prevOutput.summary,
  };
}

/**
 * Resume: on HITL approval, pass the stored pending domain input as-is.
 * Reviewer fields (decision, notes) are auditing metadata, not aggregator input.
 */
function resumeAggregator(ctx: HitlResumeContext<DemoDataProcessorHitlInput>) {
  return ctx.pendingInput;
}

/**
 * Worker queue: demo-data-processor
 *
 * Multi-step demo queue showcasing:
 * 1. Sequential step execution
 * 2. Data passing between steps (`chain`)
 * 3. Delayed step execution (`delaySeconds`)
 * 4. HITL checkpoint (`requiresApproval` + `resume`)
 *
 * Pipeline:
 * - Step 1: demo (process mode) — Processes initial data array
 * - Step 2: results-aggregator — Aggregates and summarizes results (with 2s delay,
 *   HITL approval required before proceeding)
 */
// Step 1 retry: transient infra errors only (not json-parse — demo worker doesn't do LLM calls).
const step1Retry: SmartRetryConfig = { maxAttempts: 3, on: ['rate-limit', 'server-error'] };

// Step 2 retry: rate limits only; ctx.retryContext.lastError available in the aggregator handler.
const step2Retry: SmartRetryConfig = { maxAttempts: 2, on: ['rate-limit'] };

export default defineWorkerQueue({
  id: 'demo-data-processor',
  steps: [
    {
      workerId: 'demo',
      retry: step1Retry,
    },
    {
      workerId: 'results-aggregator',
      delaySeconds: 2,
      chain: chainToAggregator,
      resume: resumeAggregator,
      requiresApproval: true,
      hitl: reviewAggregatedResultsHitl,
      retry: step2Retry,
    },
  ],
  // Every 5 minutes – comment out after testing to avoid unnecessary cron runs
  // schedule: 'rate(5 minutes)',
});
