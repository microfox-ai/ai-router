// Main orchestration workflow function
// This file must be separate to avoid Next.js dependencies in workflow runtime

import type { OrchestrationConfig, OrchestrationContext, OrchestrationStep } from '@microfox/ai-router/workflow/orchestrate';
import { 
  callAgentStep, 
  callWorkflowStep,
  resolveInput,
  resolveToken
} from './steps';

// Execute a single step
async function executeStep(
  step: OrchestrationStep,
  context: OrchestrationContext,
  baseUrl: string,
  messages: any[]
): Promise<any> {
  switch (step.type) {
    case 'agent': {
      const agentInput = step.input !== undefined 
        ? resolveInput(step.input, context)
        : context.previous || context.input;

      if (step.await === false) {
        // Fire-and-forget: start workflow and return immediately
        const result = await callWorkflowStep({
          workflowPath: step.agent,
          workflowInput: agentInput,
          baseUrl,
          messages,
        });
        
        const output = { runId: result.runId, status: result.status };
        
        // Update context
        if (step.id) {
          context.steps[step.id] = output;
        }
        context.previous = output;
        context.all.push(output);
        
        return output;
      } else {
        // Blocking: await agent result
        const result = await callAgentStep({
          agentPath: step.agent,
          agentInput,
          baseUrl,
          messages,
          await: true,
        });
        
        // Update context
        if (step.id) {
          context.steps[step.id] = result;
        }
        context.previous = result;
        context.all.push(result);
        
        return result;
      }
    }

    case 'hook': {
      // defineHook().create() must be called directly in the workflow function, not in a step
      const token = resolveToken(step.token, context);
      
      // Import defineHook from workflow
      const { defineHook } = await import('workflow');
      const { z } = await import('zod');
      
      // Create a hook schema (using z.any() for generic hooks without schema)
      const hookSchema = defineHook({
        schema: step.schema || z.any(), // Use provided schema or default to any
      });
      
      // Create hook instance with token and await it
      const hook = hookSchema.create({ token });
      const payload = await hook;
      
      const output = { token, payload };
      
      // Update context
      if (step.id) {
        context.steps[step.id] = output;
      }
      context.previous = output;
      context.all.push(output);
      
      return output;
    }

    case 'sleep': {
      // sleep() must be called directly in the workflow function, not in a step
      // Import sleep from workflow
      const { sleep } = await import('workflow');
      
      // @ts-expect-error - StringValue type is stricter than string, but runtime accepts both
      await sleep(step.duration);
      
      const output = { slept: step.duration };
      
      // Update context
      context.previous = output;
      context.all.push(output);
      
      return output;
    }

    case 'condition': {
      const conditionResult = step.if(context);
      const stepsToExecute = conditionResult ? step.then : (step.else || []);
      
      // Execute steps in the selected branch
      for (const branchStep of stepsToExecute) {
        await executeStep(branchStep, context, baseUrl, messages);
      }
      
      return { condition: conditionResult };
    }

    case 'parallel': {
      // Execute all steps in parallel
      const promises = step.steps.map(branchStep => 
        executeStep(branchStep, context, baseUrl, messages)
      );
      
      const results = await Promise.all(promises);
      
      const output = { parallel: results };
      
      // Update context
      context.previous = output;
      context.all.push(output);
      
      return output;
    }

    default: {
      const _exhaustive: never = step;
      throw new Error(`Unknown step type: ${(_exhaustive as any).type}`);
    }
  }
}

// Main workflow function
export async function orchestrateWorkflowFn(input: {
  config: OrchestrationConfig;
  baseUrl: string;
}) {
  "use workflow";

  const { config, baseUrl } = input;
  
  // Try to get runId from workflow runtime if available
  // Note: This may not be available in all workflow runtime versions
  let runId: string | undefined;
  try {
    const workflowApi = await import('workflow/api');
    // Some workflow runtimes might expose current run context
    // For now, we'll leave it undefined if not available
  } catch {
    // Ignore if not available
  }
  
  const context: OrchestrationContext = {
    input: config.input || {},
    steps: {},
    previous: null,
    all: [],
    runId,
  };

  // Execute steps sequentially
  for (const step of config.steps) {
    await executeStep(step, context, baseUrl, config.messages || []);
  }

  return {
    context,
    result: context.previous,
  };
}
