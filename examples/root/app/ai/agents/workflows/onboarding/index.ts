// // This file registers the workflow with ai-router.
// // The actual workflow function is defined in workflow.ts to avoid
// // importing from @microfox/ai-router in the workflow file (which would
// // cause the Workflow DevKit scanner to detect Node.js dependencies).

// import { createWorkflow } from '@microfox/ai-router/workflow';
// import { onboardingWorkflowFn, onboardingInputSchema, onboardingOutputSchema } from './workflow';

// export const onboardingWorkflow = createWorkflow({
//   id: 'onboarding-workflow-v1',
//   version: '1.0',
//   input: onboardingInputSchema,
//   output: onboardingOutputSchema,
//   // External runtime entrypoint
//   workflowFn: onboardingWorkflowFn,
// });

// // Re-export the workflow function for direct use if needed
// export { onboardingWorkflowFn };
