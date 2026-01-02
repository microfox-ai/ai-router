// This file registers the workflow with ai-router.
// The actual workflow function is defined in workflow.ts to avoid
// importing from @microfox/ai-router in the workflow file (which would
// cause the Workflow DevKit scanner to detect Node.js dependencies).

import { createWorkflow } from '@microfox/ai-router';
import { researchWorkflowFn, researchInputSchema, researchOutputSchema } from './workflow';

export const researchWorkflow = createWorkflow({
  id: 'research-workflow-v1',
  version: '1.0',
  input: researchInputSchema,
  output: researchOutputSchema,
  // External runtime entrypoint
  workflowFn: researchWorkflowFn,
});

// Re-export the workflow function for direct use if needed
export { researchWorkflowFn };
