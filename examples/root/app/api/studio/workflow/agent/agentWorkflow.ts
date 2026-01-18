import { callAgentStep } from './agentStep';

// Workflow function that calls the agent step
// This file must be separate to avoid Next.js dependencies in workflow runtime
export async function agentWorkflowFn(input: {
  agentPath: string;
  input: any;
  baseUrl: string;
  messages: any[];
}) {
  "use workflow";

  // Call the step with the workflow input
  const result = await callAgentStep(input);
  return result;
}
