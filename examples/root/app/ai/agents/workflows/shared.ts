import { researchWorkflow } from './research';
import { onboardingWorkflow } from './onboarding';
import { AiRouter } from '@microfox/ai-router';

// Shared router instance for workflows
// This router will be mounted at /workflows in the main router
export const aiRouter = new AiRouter();

export const aiWorkflowRouter = aiRouter.useWorkflow(
    '/research',
    researchWorkflow,
    {
        exposeAsTool: true,
    }
)
    .useWorkflow(
        '/onboarding',
        onboardingWorkflow,
        {
            exposeAsTool: true,
        }
    )
