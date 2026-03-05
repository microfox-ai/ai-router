import { start, getRun, resumeHook } from 'workflow/api';
import type {
  WorkflowRuntimeAdapter,
  WorkflowRuntimeStartResult,
  WorkflowRuntimeStatusResult,
} from '@microfox/ai-workflow';

/**
 * Vercel `workflow` runtime adapter.
 *
 * This is a concrete implementation of `WorkflowRuntimeAdapter` that talks to
 * the official `workflow` runtime via the `workflow/api` entrypoint.
 *
 * It expects the workflow definition to either be:
 * - a `"use workflow"` function directly, or
 * - an object with a `workflowFn` property that is such a function.
 */
export const vercelWorkflowAdapter: WorkflowRuntimeAdapter = {
  async startWorkflow<Input, Output>(
    def: any,
    input: Input,
  ): Promise<WorkflowRuntimeStartResult<Output>> {
    const workflowFn = typeof def === 'function' ? def : def?.workflowFn;
    if (typeof workflowFn !== 'function') {
      throw new Error(
        '[ai-router][workflow] Workflow definition for Vercel adapter is missing `workflowFn`. ' +
          'Provide a `"use workflow"` function or an object with `workflowFn`.',
      );
    }

    // Start the workflow as described in the official docs.
    // The workflow runtime executes steps asynchronously, so we return
    // immediately with the runId. The status endpoint will handle
    // polling for completion.
    const run = await start(workflowFn, [input]);

    // Get the current status (may be "pending", "running", "completed", etc.)
    // We don't wait for completion here – that's handled by the status endpoint.
    const status: string = await run.status;

    let result: any;
    // Only try to get the result if the workflow completed synchronously
    // (unlikely, but possible for very fast workflows).
    if (status === 'completed') {
      try {
        result = await run.returnValue;
      } catch {
        // If returnValue isn't available yet, that's fine – status polling
        // via `getWorkflowStatus` will handle it.
      }
    }

    return {
      runId: run.runId,
      status,
      result,
    };
  },

  async getWorkflowStatus<Output>(
    def: any,
    runId: string,
  ): Promise<WorkflowRuntimeStatusResult<Output>> {
    const run = getRun(runId);
    if (!run) {
      throw new Error(
        `[ai-router][workflow] Workflow run ${runId} not found.`,
      );
    }

    // The workflow runtime's run.status is a promise that resolves to the
    // current status. It may be reactive and update as the workflow progresses.
    let status: string;
    let workflowError: any;
    try {
      status = await run.status;

      // Also check for errors – the workflow might have failed while creating
      // a hook or at some later step.
      // Note: run.error may exist at runtime but isn't in the Run type definition
      try {
        const runAny = run as any;
        const errorValue = await runAny.error;
        if (errorValue) {
          workflowError = errorValue;
          // If there's an error but status is still "running" or "pending",
          // normalize to "failed".
          if (status === 'running' || status === 'pending') {
            status = 'failed';
          }
        }
      } catch {
        // run.error might not be available or might throw – that's okay.
      }
    } catch (err: any) {
      status = 'error';
      workflowError = err;
    }

    let result: any;
    let error: any;

    // Try to get the result if the workflow is completed.
    if (status === 'completed') {
      try {
        result = await run.returnValue;
      } catch (err: any) {
        error = err;
      }
    } else if (status === 'failed' || status === 'error') {
      // If the workflow failed, use the error we detected.
      error = workflowError;
    }

    const finalStatus = status;

    const resultObj: WorkflowRuntimeStatusResult<any> = {
      status: finalStatus,
      result,
      error: error?.message || (error ? String(error) : undefined),
    };

    // Extract hook token from Vercel workflow status
    // Note: Vercel workflow API doesn't expose hook tokens in the run object
    // Hook tokens are created in workflow code and must be provided by callers
    // or constructed deterministically from input + runId
    // The workflow runtime returns "paused" status when waiting for hooks/webhooks
    // We surface a generic hook placeholder; callers are responsible for
    // constructing deterministic tokens based on input + runId if needed
    if (finalStatus === 'paused') {
      // Try to extract token from run metadata if available
      // The run object may contain hook information in metadata
      const runAny = run as any;
      const hookToken = runAny.hookToken 
        || runAny.waitingForToken
        || runAny.metadata?.hookToken
        || '';
      
      resultObj.hook = {
        token: hookToken,
        type: 'hook',
      };
    }

    return resultObj;
  },

  async resumeHook<Payload, Output>(
    token: string,
    payload: Payload,
  ): Promise<WorkflowRuntimeStatusResult<Output>> {
    try {
      await resumeHook(token, payload);

      // We don't have a straightforward way to map token -> runId here,
      // so we return a minimal status object and let callers re-query
      // status separately if they need richer information.
      return {
        status: 'resumed',
      };
    } catch (error: any) {
      throw new Error(
        `[ai-router][workflow] Failed to resume hook with token ${token}: ${error?.message || String(error)}`,
      );
    }
  },

  async resumeWebhook<Payload, Output>(
    token: string,
    payload: Payload,
  ): Promise<WorkflowRuntimeStatusResult<Output>> {
    // Use resumeHook for webhook resumption as well
    // resumeHook accepts payload directly and works for both hooks and webhooks
    try {
      await resumeHook(token, payload);
      return {
        status: 'resumed',
      };
    } catch (error: any) {
      throw new Error(
        `[ai-router][workflow] Failed to resume webhook with token ${token}: ${error?.message || String(error)}`,
      );
    }
  },
};
