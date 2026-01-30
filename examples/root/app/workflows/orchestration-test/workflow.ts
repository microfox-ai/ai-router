/**
 * Orchestration Test Workflow (pure object)
 *
 * Tests: HITL (hook), conditionals (whenStep), worker polling (await echo),
 * context passing (whenStep reads context.steps.emitter).
 *
 * Flow: emitter -> hook (gate) -> condition(emitter.label === 'go')
 *   -> then: echo worker (await) -> reflect(branch then)
 *   -> else: reflect(branch else)
 */

import type { OrchestrationConfig, OrchestrationStep } from '@microfox/ai-workflow';
import { whenStep } from '@microfox/ai-workflow';

const steps: OrchestrationStep[] = [
  {
    type: 'agent',
    agent: '/emitter',
    input: { seed: 42, label: 'go' },
    id: 'emitter',
  },
  {
    type: 'hook',
    token: 'orchestration-test:gate',
    id: 'gate',
  },
  {
    type: 'condition',
    if: whenStep('emitter', 'label', 'eq', 'go'),
    then: [
      {
        type: 'worker',
        worker: 'echo',
        input: { message: 'from-then' },
        await: true,
        id: 'echo',
      },
      {
        type: 'agent',
        agent: '/reflect',
        input: { branch: 'then', note: 'after echo worker' },
        id: 'reflectThen',
      },
    ] as OrchestrationStep[],
    else: [
      {
        type: 'agent',
        agent: '/reflect',
        input: { branch: 'else' },
        id: 'reflectElse',
      },
    ] as OrchestrationStep[],
  },
];

export const orchestrationTestWorkflow: OrchestrationConfig = {
  id: 'orchestration-test',
  steps,
};
