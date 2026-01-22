import { serve } from '@upstash/workflow/nextjs';
import type {
  OrchestrationConfig,
  OrchestrationContext,
  OrchestrationStep,
} from '@microfox/ai-router';
import {
  resolveInput,
  resolveToken,
  callWorkerStep,
} from '../../workflows/steps';

/**
 * Upstash Workflow implementation of orchestration.
 *
 * This route uses `serve` from `@upstash/workflow/nextjs` to create a
 * re-entrant workflow endpoint that interprets the orchestration DSL
 * using Upstash's `context.run`, `context.sleep`, `context.waitForEvent`,
 * and `context.call` primitives.
 */

// Helper to extract agent return value from UIMessage array
function extractAgentResult(uiMessages: any[]): any {
  if (!uiMessages || uiMessages.length === 0) {
    return null;
  }

  for (const message of uiMessages) {
    if (message.parts && Array.isArray(message.parts)) {
      for (const part of message.parts) {
        if (part.type === 'tool-call-result') {
          if (part.output !== undefined) return part.output;
          if (part.result !== undefined) return part.result;
        }
        if (part.type?.startsWith('tool-') && part.output !== undefined) {
          return part.output;
        }
        if (part.type === 'data' && part.data !== undefined) {
          return part.data;
        }
        if (part.type === 'data-end' && part.data !== undefined) {
          return part.data;
        }
      }
    }
  }

  if (uiMessages.length === 1) {
    const message = uiMessages[0];
    if (!message.parts || message.parts.length === 0) {
      if (message.result !== undefined) return message.result;
      if (typeof message === 'object' && !message.id && !message.parts) {
        return message;
      }
    }
  }

  return null;
}

// Execute a single step using Upstash context primitives
async function executeUpstashStep(
  step: OrchestrationStep,
  context: OrchestrationContext,
  baseUrl: string,
  messages: any[],
  upstashContext: any, // Upstash workflow context
  config: OrchestrationConfig, // Required (hook timeout, error handling)
): Promise<any> {
  switch (step.type) {
    case 'agent': {
      const agentInput =
        step.input !== undefined
          ? resolveInput(step.input, context)
          : context.previous || context.input;

      if (step.await === false) {
        // Fire-and-forget: use context.call to start workflow asynchronously
        const workflowApiPath = baseUrl
          ? `${baseUrl}/api/workflows${step.agent.startsWith('/') ? step.agent : '/' + step.agent}`
          : `/api/workflows${step.agent.startsWith('/') ? step.agent : '/' + step.agent}`;

        const result = await upstashContext.call(
          `fire-and-forget-${step.agent}`,
          {
            url: workflowApiPath,
            method: 'POST',
            body: JSON.stringify({
              input: agentInput,
              messages,
            }),
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );

        const output = { runId: result.runId, status: result.status };

        if (step.id) {
          context.steps[step.id] = output;
        }
        context.previous = output;
        context.all.push(output);

        return output;
      } else {
        // Blocking: use context.call to await agent result
        const url = baseUrl
          ? `${baseUrl}${step.agent.startsWith('/') ? step.agent : '/' + step.agent}`
          : step.agent;

        const response = await upstashContext.call(`agent-${step.agent}`, {
          url,
          method: 'POST',
          body: JSON.stringify({
            messages,
            input: agentInput,
            params: agentInput,
          }),
          headers: {
            'Content-Type': 'application/json',
          },
        });

        const uiMessages = Array.isArray(response) ? response : [response];
        const agentResult = extractAgentResult(uiMessages);

        if (step.id) {
          context.steps[step.id] = agentResult;
        }
        context.previous = agentResult;
        context.all.push(agentResult);

        return agentResult;
      }
    }

    case 'hook': {
      // Use context.waitForEvent for HITL
      const token = resolveToken(step.token, context);
      // IMPORTANT: eventId must match what resumeHook(notify) uses.
      // We use the *token itself* as the eventId so clients can resume
      // with the exact token they receive from status.
      const eventId = token;

      // Use configured hook timeout or default to 7d
      const hookTimeout = config.hookTimeout || '7d';
      
      const { eventData, timeout } = await upstashContext.waitForEvent(
        `wait-for-hook-${token}`,
        eventId,
        {
          timeout: hookTimeout,
        },
      );

      if (timeout) {
        throw new Error(`Hook timeout: ${token}`);
      }

      const output = { token, payload: eventData };

      if (step.id) {
        context.steps[step.id] = output;
      }
      context.previous = output;
      context.all.push(output);

      return output;
    }

    case 'sleep': {
      // Use context.sleep for delays
      await upstashContext.sleep(step.duration);

      const output = { slept: step.duration };

      context.previous = output;
      context.all.push(output);

      return output;
    }

    case 'condition': {
      const conditionResult = step.if(context);
      const stepsToExecute = conditionResult ? step.then : step.else || [];

      for (const branchStep of stepsToExecute) {
        await executeUpstashStep(
          branchStep,
          context,
          baseUrl,
          messages,
          upstashContext,
          config,
        );
      }

      return { condition: conditionResult };
    }

    case 'parallel': {
      // Execute steps in parallel using Promise.allSettled with context.run
      // Each parallel step gets its own context.run for memoization
      const promises = step.steps.map((branchStep, index) =>
        upstashContext.run(`parallel-${index}-${branchStep.type}`, async () => {
          try {
            // Create a shallow copy of context for each parallel branch
            // to avoid race conditions, but share the steps object
            const branchContext: OrchestrationContext = {
              ...context,
              steps: { ...context.steps }, // Copy steps object
              errors: config.continueOnError ? [] : undefined,
            };
            const result = await executeUpstashStep(
              branchStep,
              branchContext,
              baseUrl,
              messages,
              upstashContext,
              config,
            );
            return { success: true as const, index, result };
          } catch (error: any) {
            return { success: false as const, index, error };
          }
        }),
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
          results[index] = null;
        }
      });
      
      // If any step failed and not in continue-on-error mode, throw first error
      if (errors.length > 0 && !config.continueOnError) {
        throw errors[0].error;
      }
      
      // Store errors in context if continue-on-error mode
      if (errors.length > 0 && config.continueOnError) {
        if (!context.errors) {
          context.errors = [];
        }
        context.errors.push(...errors);
      }

      // Merge results back into main context
      results.forEach((result, index) => {
        const branchStep = step.steps[index];
        // Only Agent/Hook steps carry optional `id`
        if ('id' in branchStep && branchStep.id) {
          context.steps[branchStep.id] = result;
        }
      });

      const output = { parallel: results };

      context.previous = output;
      context.all.push(output);

      return output;
    }

    case 'workflow': {
      const workflowInput =
        step.input !== undefined
          ? resolveInput(step.input, context)
          : context.previous || context.input;

      if (step.await === false) {
        // Fire-and-forget: use context.call to start workflow asynchronously
        const workflowApiPath = baseUrl
          ? `${baseUrl}/api/workflows${step.workflow.startsWith('/') ? step.workflow : '/' + step.workflow}`
          : `/api/workflows${step.workflow.startsWith('/') ? step.workflow : '/' + step.workflow}`;

        const result = await upstashContext.call(
          `workflow-${step.workflow}`,
          {
            url: workflowApiPath,
            method: 'POST',
            body: JSON.stringify({
              input: workflowInput,
              messages,
            }),
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );

        const output = { runId: result.runId, status: result.status || 'running' };

        if (step.id) {
          context.steps[step.id] = output;
        }
        context.previous = output;
        context.all.push(output);

        return output;
      } else {
        // Blocking: start workflow and wait for result
        const workflowApiPath = baseUrl
          ? `${baseUrl}/api/workflows${step.workflow.startsWith('/') ? step.workflow : '/' + step.workflow}`
          : `/api/workflows${step.workflow.startsWith('/') ? step.workflow : '/' + step.workflow}`;

        // Start workflow
        const startResult = await upstashContext.call(
          `workflow-start-${step.workflow}`,
          {
            url: workflowApiPath,
            method: 'POST',
            body: JSON.stringify({
              input: workflowInput,
              messages,
            }),
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );

        const runId = startResult.runId;

        if (!runId) {
          throw new Error(`Failed to start workflow ${step.workflow}`);
        }

        // Poll workflow status until completed or failed
        // Use context.call to poll status endpoint
        const maxAttempts = 120; // 10 minutes at 5s intervals
        const pollInterval = 5000; // 5 seconds

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const statusResult = await upstashContext.call(
            `workflow-status-${step.workflow}-${runId}-${attempt}`,
            {
              url: `${baseUrl}/api/workflows/${step.workflow}/${runId}`,
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
              },
            },
          );

          if (statusResult.status === 'completed') {
            const output = statusResult.result || statusResult;

            if (step.id) {
              context.steps[step.id] = output;
            }
            context.previous = output;
            context.all.push(output);

            return output;
          }

          if (statusResult.status === 'failed') {
            throw new Error(statusResult.error || 'Workflow execution failed');
          }

          // Wait before next poll
          if (attempt < maxAttempts - 1) {
            await upstashContext.sleep(pollInterval);
          }
        }

        throw new Error(`Workflow ${step.workflow} did not complete within timeout period`);
      }
    }

    case 'worker': {
      const workerInput =
        step.input !== undefined
          ? resolveInput(step.input, context)
          : context.previous || context.input;

      // Always fire-and-forget (ignore step.await if provided)
      // Workers are long-running background tasks that complete independently
      // Vercel's stateless APIs cannot reliably notify the workflow engine of worker completion
      const workerApiPath = baseUrl
        ? `${baseUrl}/api/workflows/workers/${step.worker}`
        : `/api/workflows/workers/${step.worker}`;

      const result = await upstashContext.call(
        `worker-${step.worker}`,
        {
          url: workerApiPath,
          method: 'POST',
          body: JSON.stringify({
            input: workerInput,
            await: false, // Always false
          }),
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      const output = { jobId: result.jobId, status: result.status || 'queued' };

      if (step.id) {
        context.steps[step.id] = output;
      }
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

// Helper to check if URL is localhost/loopback
function isLocalhost(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      hostname.startsWith('127.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      (hostname.startsWith('172.') && 
       parseInt(hostname.split('.')[1] || '0') >= 16 && 
       parseInt(hostname.split('.')[1] || '0') <= 31)
    );
  } catch {
    return false;
  }
}

// Helper to get public base URL for Upstash workflow callbacks
function getPublicBaseUrl(): string | undefined {
  // Check environment variables for public URL
  const tunnelUrl = process.env.UPSTASH_WORKFLOW_URL || 
                    process.env.UPSTASH_WEBHOOK_URL || 
                    process.env.TUNNEL_URL || 
                    process.env.NEXT_PUBLIC_TUNNEL_URL;
  
  if (tunnelUrl) {
    // Remove trailing slash if present
    return tunnelUrl.replace(/\/$/, '');
  }
  
  return undefined;
}

// Upstash workflow entrypoint
export const { POST } = serve<{
  config: OrchestrationConfig;
  baseUrl: string;
}>(
  async (context) => {
    // Store the initial config in a context.run() step so it persists across workflow invocations
    // This is necessary because Upstash workflow callbacks pass different payloads (agent responses)
    const workflowState = await context.run('init-orchestration-config', async () => {
      // Extract config from initial request payload (only on first invocation)
      let payload: any = context.requestPayload;
      
      // Debug: Log the structure to understand what we're receiving
      if (process.env.NODE_ENV === 'development') {
        console.log('[Upstash Workflow] Initial requestPayload type:', typeof payload);
        console.log('[Upstash Workflow] Initial requestPayload keys:', payload && typeof payload === 'object' ? Object.keys(payload) : 'N/A');
      }
      
      // Handle case where requestPayload is the direct payload (initial trigger)
      // Skip if this is an Upstash callback context (has 'status', 'header', etc.)
      if (payload && typeof payload === 'object' && 'body' in payload && !('status' in payload)) {
        const body = payload.body;
        if (typeof body === 'string') {
          try {
            payload = JSON.parse(body);
          } catch (e) {
            try {
              if (/^[A-Za-z0-9+/=]+$/.test(body)) {
                const decoded = Buffer.from(body, 'base64').toString('utf-8');
                payload = JSON.parse(decoded);
              } else {
                throw e;
              }
            } catch (decodeError) {
              throw new Error(`Upstash workflow: Failed to parse request body: ${e}`);
            }
          }
        } else if (typeof body === 'object' && body !== null) {
          payload = body;
        }
      }

      // Handle case where payload might be an array (unwrap first element)
      if (Array.isArray(payload)) {
        if (payload.length === 0) {
          throw new Error('Upstash workflow: requestPayload is an empty array');
        }
        payload = payload[0];
      }

      // Extract config and baseUrl from payload
      let config: OrchestrationConfig;
      let baseUrlInput: string;

      if (payload && typeof payload === 'object') {
        // Expected structure: { config: {...}, baseUrl: "..." }
        if ('config' in payload && 'baseUrl' in payload) {
          config = payload.config as OrchestrationConfig;
          baseUrlInput = payload.baseUrl as string;
        }
        // Alternative: payload is the config directly with baseUrl as a property
        else if ('steps' in payload) {
          config = payload as OrchestrationConfig;
          baseUrlInput = (payload as any).baseUrl || '';
        }
        // If we have neither structure, it's an error
        else {
          throw new Error(
            'Upstash workflow: requestPayload must contain config and baseUrl. ' +
            `Received payload keys: ${JSON.stringify(Object.keys(payload))}. ` +
            'Expected structure: { config: OrchestrationConfig, baseUrl: string }'
          );
        }
      } else {
        throw new Error(
          `Upstash workflow: requestPayload must be an object. Received type: ${typeof payload}`
        );
      }

      // Validate required fields
      if (!config) {
        throw new Error('Upstash workflow: config is required in requestPayload');
      }

      if (!config.steps || !Array.isArray(config.steps)) {
        throw new Error('Upstash workflow: config.steps must be an array');
      }

      if (!baseUrlInput || typeof baseUrlInput !== 'string') {
        throw new Error('Upstash workflow: baseUrl is required in requestPayload');
      }

      return { config, baseUrl: baseUrlInput };
    });

    const config = workflowState.config;
    let baseUrl = workflowState.baseUrl;

    // Ensure baseUrl is not localhost (should already be fixed, but double-check)
    // If it's localhost, try to get tunnel URL from env
    if (isLocalhost(baseUrl)) {
      const tunnelUrl = getPublicBaseUrl();
      if (tunnelUrl) {
        // Extract the base path from the original baseUrl and prepend tunnel URL
        try {
          const urlObj = new URL(baseUrl);
          const path = urlObj.pathname;
          baseUrl = `${tunnelUrl}${path}`;
        } catch {
          // If parsing fails, just use tunnel URL
          baseUrl = tunnelUrl;
        }
      } else {
        throw new Error(
          'Upstash workflow received localhost baseUrl. ' +
          'Please set UPSTASH_WORKFLOW_URL, UPSTASH_WEBHOOK_URL, TUNNEL_URL, or NEXT_PUBLIC_TUNNEL_URL environment variable.'
        );
      }
    }

    // Get workflow run ID from Upstash context
    const runId = context.workflowRunId;

    const orchestrationContext: OrchestrationContext = {
      input: config.input || {},
      steps: {},
      previous: null,
      all: [],
      runId,
      errors: config.continueOnError ? [] : undefined,
    };

    // Execute steps sequentially with error handling
    // Note: We don't wrap executeUpstashStep in context.run() because it already uses
    // context.call() internally, and Upstash doesn't allow nested steps.
    // context.run() is only used for deterministic memoization, not for HTTP calls.
    for (let i = 0; i < config.steps.length; i++) {
      const step = config.steps[i];

      try {
        await executeUpstashStep(
          step,
          orchestrationContext,
          baseUrl,
          config.messages || [],
          context,
          config,
        );
      } catch (error: any) {
        // Handle step errors based on config
        if (config.continueOnError) {
          // Continue-on-error mode: collect error and continue
          if (!orchestrationContext.errors) {
            orchestrationContext.errors = [];
          }
          orchestrationContext.errors.push({ 
            step: ('id' in step && step.id) ? step.id : `${i}-${step.type}`, 
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
      context: orchestrationContext,
      result: orchestrationContext.previous,
    };
  },
  {
    // Override baseUrl for Upstash callbacks to use public URL instead of localhost
    // This ensures Upstash can reach the workflow endpoint for callbacks
    baseUrl: getPublicBaseUrl(),
  }
);
