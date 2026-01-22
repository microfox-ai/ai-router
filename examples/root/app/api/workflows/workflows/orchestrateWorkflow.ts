// Main orchestration workflow function
// This file must be separate to avoid Next.js dependencies in workflow runtime

import type { OrchestrationConfig, OrchestrationContext, OrchestrationStep } from '@microfox/ai-router';
import { 
  callAgentStep, 
  callWorkflowStep,
  callWorkerStep,
  resolveInput,
  resolveToken
} from './steps';

// Note: config is available in the scope but we need to access continueOnError
// For now, we'll pass it through executeStep if needed

// Helper to safely get step ID (not all step types have 'id' property)
function getStepId(step: OrchestrationStep, index: number): string {
  if ('id' in step && step.id) {
    return step.id;
  }
  return `${index}-${step.type}`;
}

// Execute a single step
async function executeStep(
  step: OrchestrationStep,
  context: OrchestrationContext,
  baseUrl: string,
  messages: any[],
  config?: OrchestrationConfig
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
        await executeStep(branchStep, context, baseUrl, messages, config);
      }
      
      return { condition: conditionResult };
    }

    case 'parallel': {
      // Execute all steps in parallel with error handling
      // Use Promise.allSettled to collect all results/errors
      // This allows partial success and error reporting
      const promises = step.steps.map((branchStep, index) => 
        executeStep(branchStep, context, baseUrl, messages, config)
          .then(result => ({ success: true as const, index, result }))
          .catch(error => ({ success: false as const, index, error }))
      );
      
      const settledResults = await Promise.all(promises);
      
      // Separate successful and failed results
      const results: any[] = [];
      const errors: Array<{ step: number; error: any }> = [];
      
      settledResults.forEach((result, index) => {
        if (result.success) {
          results[index] = result.result;
        } else {
          errors.push({ step: index, error: result.error });
          // For failed steps, set result to null to maintain index alignment
          results[index] = null;
        }
      });
      
      // If any step failed, handle based on config
      if (errors.length > 0) {
        if (config?.continueOnError !== true) {
          // Fail-fast mode: throw first error
          throw errors[0].error;
        }
        
        // Continue-on-error mode: store errors in context
        if (!context.errors) {
          context.errors = [];
        }
        context.errors.push(...errors);
      }
      
      const output = { parallel: results };
      
      // Update context
      context.previous = output;
      context.all.push(output);
      
      return output;
    }

    case 'worker': {
      const workerInput = step.input !== undefined 
        ? resolveInput(step.input, context)
        : context.previous || context.input;

      // Always fire-and-forget (ignore step.await if provided)
      // Workers are long-running background tasks that complete independently
      const result = await callWorkerStep({
        workerId: step.worker,
        workerInput,
        baseUrl,
      });
      
      // Update context with job info
      if (step.id) {
        context.steps[step.id] = result;
      }
      context.previous = result;
      context.all.push(result);
      
      return result;
    }

    case 'workflow': {
      const workflowInput = step.input !== undefined 
        ? resolveInput(step.input, context)
        : context.previous || context.input;

      if (step.await === false) {
        // Fire-and-forget: start workflow and return immediately
        const result = await callWorkflowStep({
          workflowPath: step.workflow,
          workflowInput,
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
        // Blocking: await workflow result
        // For now, we poll the workflow status endpoint
        // This could be improved to use workflow runtime features if available
        const startResult = await callWorkflowStep({
          workflowPath: step.workflow,
          workflowInput,
          baseUrl,
          messages,
        });
        
        const runId = startResult.runId;
        
        // Poll workflow status until completed or failed
        const maxAttempts = 120; // 10 minutes at 5s intervals
        const pollInterval = 5000; // 5 seconds
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const statusResponse = await fetch(`${baseUrl}/api/workflows/${step.workflow}/${runId}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          });
          
          if (statusResponse.ok) {
            const status = await statusResponse.json();
            
            if (status.status === 'completed') {
              const output = status.result || status;
              
              // Update context
              if (step.id) {
                context.steps[step.id] = output;
              }
              context.previous = output;
              context.all.push(output);
              
              return output;
            }
            
            if (status.status === 'failed') {
              throw new Error(status.error || 'Workflow execution failed');
            }
          }
          
          // Wait before next poll (if not last attempt)
          if (attempt < maxAttempts - 1) {
            const { sleep } = await import('workflow');
            await sleep(pollInterval);
          }
        }
        
        throw new Error(`Workflow ${step.workflow} did not complete within timeout period`);
      }
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
  
  // Extract runId from input if provided, or leave undefined
  // Note: Vercel workflow runtime doesn't expose runId within the workflow function
  // The runId is only available when starting the workflow via `start()` 
  // If runId is needed for token generation, it should be passed as part of config.input
  // For orchestration workflows, we accept that runId may not be available
  // Hook tokens can be generated deterministically from step IDs and context if needed
  const runId: string | undefined = (config.input as any)?.runId;
  
  const context: OrchestrationContext = {
    input: config.input || {},
    steps: {},
    previous: null,
    all: [],
    runId,
    errors: config.continueOnError ? [] : undefined,
  };

  // Execute steps sequentially with error handling
  for (let i = 0; i < config.steps.length; i++) {
    const step = config.steps[i];
    
    try {
      await executeStep(step, context, baseUrl, config.messages || [], config);
    } catch (error: any) {
      // Handle step errors based on config
      if (config.continueOnError) {
        // Continue-on-error mode: collect error and continue
        if (!context.errors) {
          context.errors = [];
        }
        context.errors.push({ 
          step: getStepId(step, i), 
          error: error?.message || String(error)
        });
        // Continue to next step
        continue;
      } else {
        // Fail-fast mode: throw error immediately
        throw error;
      }
    }
  }

  return {
    context,
    result: context.previous,
  };
}
