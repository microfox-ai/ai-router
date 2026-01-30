/**
 * Worker Proof Workflow (pure orchestration object)
 *
 * Demonstrates awaited worker steps:
 * - sequential awaited workers (clearly ordered by timestamps)
 * - parallel awaited workers (overlap proof)
 * - then HITL hook
 * - then a proof worker that returns a computed timeline + assertions
 */

import type { OrchestrationConfig, OrchestrationStep } from '@microfox/ai-workflow';

export const workerProofWorkflow: OrchestrationConfig = {
  id: 'worker-proof',
  steps: [
    // Sequential awaited workers
    {
      type: 'worker',
      worker: 'timed-sleep',
      id: 'seq1',
      await: true,
      input: { label: 'seq-1', sleepMs: 2000 },
    },
    {
      type: 'worker',
      worker: 'timed-sleep',
      id: 'seq2',
      await: true,
      input: { label: 'seq-2', sleepMs: 3000 },
    },

    // Parallel awaited workers
    {
      type: 'parallel',
      steps: [
        {
          type: 'worker',
          worker: 'timed-sleep',
          id: 'parA',
          await: true,
          input: { label: 'par-A', sleepMs: 5000 },
        },
        {
          type: 'worker',
          worker: 'timed-sleep',
          id: 'parB',
          await: true,
          input: { label: 'par-B', sleepMs: 2000 },
        },
      ] as OrchestrationStep[],
    },

    // HITL gate before producing proof (so you can verify it truly paused mid-way)
    {
      type: 'hook',
      token: 'worker-proof:gate:default',
      id: 'gate',
    },

    // Proof step: collect step outputs, compute overlap/gap, return as final result.
    {
      type: 'worker',
      worker: 'timeline-proof',
      id: 'proof',
      await: true,
      input: {
        _fromSteps: ['seq1', 'seq2', 'parA', 'parB'],
        // Pull the inner worker output object (TimedSleepOutput) instead of the envelope
        // { jobId, status, output, metadata } so timeline-proof can read label/timestamps directly.
        _path: 'output',
        expected: {
          seq1: 'seq-1',
          seq2: 'seq-2',
          parA: 'par-A',
          parB: 'par-B',
        },
      },
    } as OrchestrationStep,
  ],
};

