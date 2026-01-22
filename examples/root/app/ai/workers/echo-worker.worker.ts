import { z } from 'zod';
import { createWorker } from '@microfox/ai-worker';

/**
 * Example worker for testing:
 * - auto-discovery: app/ai/*.worker.ts
 * - POST /api/workflows/workers/echo-worker
 * - GET  /api/workflows/workers/echo-worker/:jobId
 */
export default createWorker({
  id: 'echo-worker',
  inputSchema: z.object({
    message: z.string(),
  }),
  outputSchema: z.object({
    echoed: z.string(),
    at: z.string(),
  }),
  handler: async ({ input }) => {
    return {
      echoed: input.message,
      at: new Date().toISOString(),
    };
  },
});
