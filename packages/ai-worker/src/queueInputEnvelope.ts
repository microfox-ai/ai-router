/**
 * @deprecated Workers no longer need to accept queue orchestration keys in their Zod schemas.
 * The runtime strips `__workerQueue`, `__hitlInput`, `__hitlDecision`, `__hitlPending`, and `hitl`
 * automatically before calling the user handler. Remove `queueOrchestrationFieldsSchema`
 * and `withQueueOrchestrationEnvelope` from your worker schemas and use plain `z.object({...})`.
 */

import { z } from 'zod';

/**
 * @deprecated No longer needed. The queue runtime strips all envelope keys before the user handler runs.
 */
export const queueOrchestrationFieldsSchema = z.object({
  __workerQueue: z.record(z.string(), z.unknown()).optional(),
  __hitlPending: z.unknown().optional(),
  __hitlInput: z.unknown().optional(),
  __hitlDecision: z.unknown().optional(),
});

export type QueueOrchestrationFields = z.infer<typeof queueOrchestrationFieldsSchema>;

/**
 * @deprecated No longer needed. The queue runtime strips all envelope keys before the user handler runs.
 */
export function withQueueOrchestrationEnvelope<D extends z.ZodObject<z.ZodRawShape>>(domain: D) {
  return domain.merge(queueOrchestrationFieldsSchema);
}
