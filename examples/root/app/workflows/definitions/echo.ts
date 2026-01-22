import { z } from 'zod';
import { defineWorkflow } from '@microfox/ai-router/workflow';

/**
 * Example workflow definition (for reference only).
 * 
 * Note: The workflow registry has been removed. Agents are now called directly by their router path.
 * This file is kept for reference but is not used by the system.
 * 
 * To use an agent as a workflow, call it directly via its path:
 * - POST /api/workflows/system/current_date
 * - GET  /api/workflows/system/current_date/:runId
 */
export default defineWorkflow({
  id: 'echo',
  input: z.object({
    message: z.string(),
  }),
  output: z.object({
    echoed: z.string(),
    at: z.string(),
  }),
  handler: async (input) => {
    'use workflow';
    return {
      echoed: input.message,
      at: new Date().toISOString(),
    };
  },
});

