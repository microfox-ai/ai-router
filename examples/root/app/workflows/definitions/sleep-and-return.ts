import { z } from 'zod';
import { defineWorkflow } from '@microfox/ai-router/workflow';
import { sleep } from 'workflow';

/**
 * Tests Vercel workflow steps ("use step") + status polling.
 * - POST /api/workflows/sleep-and-return
 * - GET  /api/workflows/sleep-and-return/:runId
 */
export default defineWorkflow({
  id: 'sleep-and-return',
  input: z.object({
    ms: z.number().int().min(0).max(30_000).default(2000),
  }),
  output: z.object({
    sleptMs: z.number(),
    at: z.string(),
  }),
  handler: async (input) => {
    'use workflow';
    // uses "workflow" package step primitive internally
    await sleep(input.ms);
    return { sleptMs: input.ms, at: new Date().toISOString() };
  },
});

