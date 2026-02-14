/**
 * Content Pipeline Orchestration (pure object)
 *
 * Demonstrates: parallel agents, analyzer (_fromSteps + _join), HITL approval,
 * worker (_fromSteps), conditionals, summary.
 *
 * Flow:
 * 1. Generate content in parallel (content1, content2, content3)
 * 2. Analyze all via _fromSteps + _path + _join -> content
 * 3. HITL approval
 * 4. If approved: demo worker (process) -> summarize agent
 * 5. Else: rejection agent
 */

import type { OrchestrationConfig, OrchestrationStep } from '@microfox/ai-workflow';
import { whenStep } from '@microfox/ai-workflow';

const steps: OrchestrationStep[] = [
  {
    type: 'parallel',
    steps: [
      {
        type: 'agent',
        agent: '/content-generator',
        input: { topic: 'Artificial Intelligence Trends 2024', style: 'informative', length: 'medium' },
        id: 'content1',
      },
      {
        type: 'agent',
        agent: '/content-generator',
        input: { topic: 'Sustainable Technology Solutions', style: 'analytical', length: 'medium' },
        id: 'content2',
      },
      {
        type: 'agent',
        agent: '/content-generator',
        input: { topic: 'Remote Work Best Practices', style: 'persuasive', length: 'short' },
        id: 'content3',
      },
    ] as OrchestrationStep[],
  },
  {
    type: 'agent',
    agent: '/analyzer',
    input: {
      _fromSteps: ['content1', 'content2', 'content3'],
      _path: 'content',
      _join: '\n\n',
      analysisType: 'comprehensive',
    },
    id: 'analysis',
  },
  {
    type: 'hook',
    token: 'content-approval:default',
    id: 'approval',
  },
  {
    type: 'condition',
    if: whenStep('approval', 'payload.approved', 'eq', true),
    then: [
      {
        type: 'worker',
        worker: 'demo',
        input: {
          _fromSteps: ['content1', 'content2', 'content3'],
          _path: 'content',
          operation: 'analyze',
          batchSize: 5,
        },
        await: true,
        workerPoll: { intervalMs: 2000, maxRetries: 300 },
        id: 'processing',
      } as OrchestrationStep,
      {
        type: 'agent',
        agent: '/summarize',
        input: {
          type: 'markdown',
          summaryRequirements:
            'Create a comprehensive summary of all the generated content, analysis results, and processing outcomes. Include key insights and recommendations.',
        },
        id: 'summary',
      },
    ] as OrchestrationStep[],
    else: [
      {
        type: 'agent',
        agent: '/content-generator',
        input: { topic: 'Content Rejection Notice', style: 'informative', length: 'short' },
        id: 'rejection',
      },
    ] as OrchestrationStep[],
  },
];

export const contentPipelineWorkflow: OrchestrationConfig = {
  id: 'content-pipeline',
  steps,
};
