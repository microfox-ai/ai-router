// Main orchestration workflow function
// This file must be separate to avoid Next.js dependencies in workflow runtime

import type {
  OrchestrationConfig,
  OrchestrationContext,
  OrchestrationStep,
  StepFieldCondition,
} from '@microfox/ai-workflow/orchestrate';
import { evaluateStepFieldCondition } from '@microfox/ai-workflow/orchestrate';
import { 
  callAgentStep, 
  callWorkflowStep,
  callWorkerStep,
  pollWorkerJobStep,
  resolveInput,
  resolveToken,
  updateWorkflowStatus,
  getRunIdFromExecutionId
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

// Note: Vercel workflows don't expose runId within the workflow function
// The workflow cannot update the database directly because it doesn't have access to runId
// Status updates are handled by the GET endpoint which reads from the workflow runtime
// and updates the database accordingly

// Execute a single step
async function executeStep(
  step: OrchestrationStep,
  context: OrchestrationContext,
  baseUrl: string,
  messages: any[],
  config?: OrchestrationConfig,
  workerTriggerBaseUrl?: string,
  workerCallbackBaseUrl?: string
): Promise<any> {
  switch (step.type) {
    case 'agent': {
      const agentInput = step.input !== undefined 
        ? resolveInput(step.input, context, step)
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
      // Check for token override from request (context.input.hookTokens[stepId])
      const hookTokens = (context.input as any)?.hookTokens || {};
      const tokenOverride = step.id ? hookTokens[step.id] : undefined;
      
      // Use override if provided, otherwise resolve from step definition
      const token = tokenOverride || resolveToken(step.token, context, step);
      
      // Update status to 'paused' with token (the auto-injected _statusUpdate step before this
      // sets status to 'paused' but without token, so we update it here with the token)
      const runId = (context.input as any)?.runId;
      if (runId) {
        // Validate that runId is the actual workflow runId, not a mapping key
        if (runId.startsWith('executionId:')) {
          console.error('[OrchestrateWorkflow] Invalid runId in hook step (looks like mapping key):', runId);
        } else {
          const apiBaseUrl = baseUrl.replace('/api/studio/chat/agent', '');
          try {
            console.log('[OrchestrateWorkflow] Updating hook status with token:', {
              runId,
              token,
            });
            await updateWorkflowStatus({
              apiBaseUrl,
              runId,
              status: 'paused',
              hookToken: token,
            });
          } catch (error: any) {
            console.warn('[OrchestrateWorkflow] Failed to update hook status:', {
              runId,
              error: error?.message || String(error),
            });
            // Ignore errors - status update is best effort
          }
        }
      } else {
        console.warn('[OrchestrateWorkflow] No runId available in hook step');
      }
      
      // Import defineHook from workflow
      const { defineHook } = await import('workflow');
      const { z } = await import('zod');
      
      // Create a hook schema (using z.any() for generic hooks without schema)
      const hookSchema = defineHook({
        schema: step.schema || z.any(), // Use provided schema or default to any
      });
      
      // Create hook instance with token and await it
      // This will pause the workflow until the hook is resumed
      const hook = hookSchema.create({ token });
      const payload = await hook;
      
      // Note: Status update to 'running' is handled by auto-injected _statusUpdate step after this
      
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
      // Note: Status update to 'paused' is handled by auto-injected _statusUpdate step before this
      
      // Import sleep from workflow
      const { sleep } = await import('workflow');
      
      // @ts-expect-error - StringValue type is stricter than string, but runtime accepts both
      await sleep(step.duration);
      
      // Note: Status update to 'running' is handled by auto-injected _statusUpdate step after this
      
      const output = { slept: step.duration };
      
      // Update context
      context.previous = output;
      context.all.push(output);
      
      return output;
    }

    case 'condition': {
      let conditionResult: boolean;
      if (typeof step.if === 'function') {
        conditionResult = step.if(context);
      } else if ((step as any)._ifIsFunction) {
        throw new Error(
          'Condition functions cannot be serialized in Vercel workflows. ' +
          'Use whenStep() for serializable conditions (e.g. whenStep("approval", "payload.approved", "eq", true)).'
        );
      } else if (typeof step.if === 'boolean') {
        conditionResult = step.if;
      } else if (step.if && typeof step.if === 'object' && (step.if as StepFieldCondition).type === 'stepField') {
        conditionResult = evaluateStepFieldCondition(step.if as StepFieldCondition, context);
      } else {
        throw new Error('Condition step "if" must be a boolean, a whenStep() condition, or (non-serializable) a function');
      }

      // Only run then/else based on condition. E.g. whenStep('approval','payload.approved','eq',true)
      // ensures we run "then" (worker, etc.) only after HITL resume with payload.approved === true.
      const stepsToExecute = conditionResult ? step.then : (step.else || []);

      // Execute steps in the selected branch
      for (const branchStep of stepsToExecute) {
        await executeStep(branchStep, context, baseUrl, messages, config, workerTriggerBaseUrl, workerCallbackBaseUrl);
      }
      
      return { condition: conditionResult };
    }

    case 'parallel': {
      // Execute all steps in parallel with error handling
      // Use Promise.allSettled to collect all results/errors
      // This allows partial success and error reporting
      const promises = step.steps.map((branchStep, index) => 
        executeStep(branchStep, context, baseUrl, messages, config, workerTriggerBaseUrl, workerCallbackBaseUrl)
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
        ? resolveInput(step.input, context, step)
        : context.previous || context.input;

      const fallback = baseUrl.replace(/\/api\/studio\/chat\/agent\/?$/, '');
      const nextJsBaseUrl = (workerCallbackBaseUrl || fallback).replace(/\/+$/, '');

      if (!workerTriggerBaseUrl) {
        throw new Error(
          'Worker steps require WORKER_BASE_URL (or WORKERS_CONFIG_API_URL). ' +
          'Set it to your workers service base (e.g. https://xxx.execute-api.us-east-1.amazonaws.com/prod).'
        );
      }

      // Dispatch via POST /workers/trigger (no registry)
      const dispatchResult = await callWorkerStep({
        workerId: step.worker,
        workerInput,
        workerTriggerBaseUrl,
        awaitMode: step.await === true,
      });
      
      // If await is false or not specified, return immediately (fire-and-forget)
      if (step.await !== true) {
        const output = { jobId: dispatchResult.jobId, status: dispatchResult.status || 'queued' };
        
        // Update context with job info
        if (step.id) {
          context.steps[step.id] = output;
        }
        context.previous = output;
        context.all.push(output);
        
        return output;
      }

      // Blocking mode: trigger then step-based poll loop. Each poll and sleep is a separate step.
      const jobId = dispatchResult.jobId;
      const workerId = step.worker;

      const defaults = { intervalMs: 3000, timeoutMs: 600_000, maxRetries: 200 };
      type PollCfg = { intervalMs?: number; timeoutMs?: number; maxRetries?: number };
      const configPoll = (config as { workerPoll?: PollCfg })?.workerPoll;
      const stepPoll = (step as { workerPoll?: PollCfg }).workerPoll;
      const cfg: PollCfg = { ...defaults, ...configPoll, ...stepPoll };
      const intervalMs = cfg.intervalMs ?? defaults.intervalMs;
      const timeoutMs = cfg.timeoutMs ?? defaults.timeoutMs;
      const maxRetries = cfg.maxRetries ?? defaults.maxRetries;

      const { sleep } = await import('workflow');
      const start = Date.now();
      let attempt = 0;

      while (true) {
        const r = await pollWorkerJobStep({
          baseUrl: nextJsBaseUrl,
          workerId,
          jobId,
          attempt,
        });

        if (r.done && r.status === 'completed') {
          const output = {
            jobId,
            status: r.status,
            output: r.output,
            metadata: r.metadata,
          };
          if (step.id) context.steps[step.id] = output;
          context.previous = output;
          context.all.push(output);
          return output;
        }

        if (r.done && r.status === 'failed') {
          throw new Error(r.error?.message ?? 'Worker execution failed');
        }

        attempt++;
        if (attempt >= maxRetries || (timeoutMs && Date.now() - start >= timeoutMs)) {
          throw new Error(`Worker ${workerId} (job ${jobId}) did not complete within timeout period`);
        }

        await sleep(intervalMs);
      }
    }

    case 'workflow': {
      const workflowInput = step.input !== undefined 
        ? resolveInput(step.input, context, step)
        : context.previous || context.input;

      const workflowBaseUrl = baseUrl.replace(/\/api\/studio\/chat\/agent\/?$/, '');

      if (step.await === false) {
        // Fire-and-forget: start workflow and return immediately
        const result = await callWorkflowStep({
          workflowPath: step.workflow,
          workflowInput,
          baseUrl: workflowBaseUrl,
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
          baseUrl: workflowBaseUrl,
          messages,
        });
        
        const runId = startResult.runId;
        
        // Poll workflow status until completed or failed
        const maxAttempts = 120; // 10 minutes at 5s intervals
        const pollInterval = 5000; // 5 seconds
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const statusResponse = await fetch(`${workflowBaseUrl}/api/workflows/${step.workflow}/${runId}`, {
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

    case '_statusUpdate': {
      // Internal status update step (auto-injected before/after hook/sleep)
      const statusStep = step as any;
      const runId = (context.input as any)?.runId;
      
      if (!runId) {
        console.warn('[OrchestrateWorkflow] Cannot update status: runId not found in context.input');
        return { status: 'skipped' };
      }
      
      // Validate that runId is the actual workflow runId, not a mapping key
      if (runId.startsWith('executionId:')) {
        console.error('[OrchestrateWorkflow] Invalid runId (looks like mapping key):', runId);
        return { status: 'skipped' };
      }
      
      const apiBaseUrl = baseUrl.replace('/api/studio/chat/agent', '');
      
      try {
        let hookToken = statusStep.hookToken;
        
        // If this is a 'paused' status update and hookToken is not set, 
        // it means we need to get it from the next hook step
        // The token will be resolved when the hook step executes
        // For now, we'll update status without token, and the hook step will update it with token
        
        console.log('[OrchestrateWorkflow] Updating workflow status:', {
          runId,
          status: statusStep.status,
          hasHookToken: hookToken !== undefined,
        });
        
        await updateWorkflowStatus({
          apiBaseUrl,
          runId,
          status: statusStep.status,
          hookToken: hookToken !== undefined ? hookToken : undefined,
        });
      } catch (updateError: any) {
        console.warn('[OrchestrateWorkflow] Failed to update status:', {
          runId,
          status: statusStep.status,
          error: updateError?.message || String(updateError),
        });
        // Ignore errors - status update is best effort
      }
      
      return { status: statusStep.status };
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
  workerTriggerBaseUrl?: string;
  workerCallbackBaseUrl?: string;
}) {
  "use workflow";

  const { config, baseUrl, workerTriggerBaseUrl, workerCallbackBaseUrl } = input;

  // Use workflow's fetch step for HTTP (global fetch is unavailable in workflow context).
  // This must run before any fetch (steps, polling, status updates).
  const { fetch } = await import('workflow');
  (globalThis as any).fetch = fetch;

  // Note: Functions in config are pre-resolved before passing to start().
  // Hook tokens can be overridden via context.input.hookTokens[stepId] from the request.
  
  // Get runId from executionId (we can't pass runId in input because we don't have it until after start())
  const executionId = (config.input as any)?.executionId;
  let runId: string | undefined;
  
  if (executionId) {
    try {
      const apiBaseUrl = baseUrl.replace('/api/studio/chat/agent', '');
      const result = await getRunIdFromExecutionId({
        apiBaseUrl,
        executionId,
      });
      runId = result; // getRunIdFromExecutionId returns the runId string directly
      
      if (!runId) {
        console.warn('[OrchestrateWorkflow] getRunIdFromExecutionId returned empty runId');
      } else {
        console.log('[OrchestrateWorkflow] Successfully retrieved runId from executionId:', {
          executionId,
          runId,
        });
      }
    } catch (error: any) {
      console.warn('[OrchestrateWorkflow] Failed to get runId from executionId:', {
        executionId,
        error: error?.message || String(error),
      });
      // Continue without runId - status updates will fail but workflow can still run
    }
  } else {
    console.warn('[OrchestrateWorkflow] No executionId found in config.input');
  }
  
  const context: OrchestrationContext = {
    input: {
      ...(config.input || {}),
      runId, // Add runId to input so it's available to all steps
    },
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
      await executeStep(step, context, baseUrl, config.messages || [], config, workerTriggerBaseUrl, workerCallbackBaseUrl);
    } catch (error: any) {
      // Update status to failed if runId is available
      if (runId) {
        const apiBaseUrl = baseUrl.replace('/api/studio/chat/agent', '');
        try {
          await updateWorkflowStatus({
            apiBaseUrl,
            runId,
            status: 'failed',
            error: {
              message: error?.message || String(error),
              stack: error?.stack,
            },
          });
        } catch {
          // Ignore errors - status update shouldn't fail the workflow
        }
      }
      
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

  // Update status to completed when workflow finishes successfully
  // Result is persisted in DB (status API reads from there) and also returned for runtime.
  if (runId) {
    const apiBaseUrl = baseUrl.replace('/api/studio/chat/agent', '');
    try {
      await updateWorkflowStatus({
        apiBaseUrl,
        runId,
        status: 'completed',
        result: context.previous,
      });
    } catch {
      // Ignore errors - status update shouldn't fail the workflow
    }
  }

  return { context, result: context.previous };
}
