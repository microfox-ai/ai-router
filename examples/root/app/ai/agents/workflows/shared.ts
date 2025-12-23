import { AiRouter } from '@microfox/ai-router';

// Shared router instance for workflows
// Storage is now auto-configured in useWorkflow() from microfox.config.ts
export const aiRouter = new AiRouter();
