import { Client } from '@upstash/workflow';
import type {
  WorkflowRuntimeAdapter,
  WorkflowRuntimeStartResult,
  WorkflowRuntimeStatusResult,
} from '@microfox/ai-router';
import { getWorkflowConfig } from '@microfox/ai-router';

// Initialize Upstash Workflow client
let upstashClient: Client | null = null;

function getUpstashClient(): Client {
  if (!upstashClient) {
    const config = getWorkflowConfig();
    const upstashConfig = config.adapters.upstash;
    const token = upstashConfig?.token || process.env.QSTASH_TOKEN;
    
    if (!token) {
      throw new Error(
        '[ai-router][workflow] QSTASH_TOKEN environment variable or config is required for Upstash Workflow adapter.',
      );
    }
    upstashClient = new Client({ token });
  }
  return upstashClient;
}

/**
 * Map Upstash workflow state to normalized status string.
 */
function normalizeUpstashStatus(
  state: string | undefined,
): string {
  if (!state) return 'pending';

  // Upstash states: RUN_STARTED, RUN_SUCCESS, RUN_FAILED, RUN_CANCELED
  const stateUpper = state.toUpperCase();
  if (stateUpper === 'RUN_STARTED') return 'running';
  if (stateUpper === 'RUN_SUCCESS') return 'completed';
  if (stateUpper === 'RUN_FAILED') return 'failed';
  if (stateUpper === 'RUN_CANCELED') return 'cancelled';

  // For intermediate states (sleeping, waiting for event), we might need
  // to check the logs API for more detail, but for now map generically
  return 'running';
}

/**
 * Upstash Workflow runtime adapter.
 *
 * This adapter uses the Upstash Workflow Client SDK to trigger workflows,
 * check status via logs API, and resume workflows via notify.
 *
 * It expects the workflow definition to contain:
 * - `endpointUrl`: The public URL of the Next.js route that implements
 *   the workflow using `serve` from `@upstash/workflow/nextjs`.
 */
export const upstashWorkflowAdapter: WorkflowRuntimeAdapter = {
  async startWorkflow<Input, Output>(
    def: any,
    input: Input,
  ): Promise<WorkflowRuntimeStartResult<Output>> {
    const endpointUrl = def?.endpointUrl;
    if (!endpointUrl || typeof endpointUrl !== 'string') {
      throw new Error(
        '[ai-router][workflow] Upstash workflow definition must include `endpointUrl` ' +
          'pointing to the Next.js route that implements the workflow.',
      );
    }

    const client = getUpstashClient();

    // Trigger the workflow via Upstash QStash
    const { workflowRunId } = await client.trigger({
      url: endpointUrl,
      body: input,
    });

    // Immediately check status to get initial state
    // Note: Upstash workflows start asynchronously, so initial status
    // will likely be "running" or "pending"
    let status = 'running';
    try {
      const logs = await client.logs({
        workflowRunId,
        count: 1,
      });
      if (logs.runs && logs.runs.length > 0) {
        status = normalizeUpstashStatus(logs.runs[0].workflowState);
      }
    } catch {
      // If logs aren't available yet, that's fine - workflow just started
      status = 'pending';
    }

    return {
      runId: workflowRunId,
      status,
      result: undefined, // Upstash workflows are async, result comes later
    };
  },

  async getWorkflowStatus<Output>(
    def: any,
    runId: string,
  ): Promise<WorkflowRuntimeStatusResult<Output>> {
    const client = getUpstashClient();

    try {
      const logs = await client.logs({
        workflowRunId: runId,
        count: 1,
      });

      if (!logs.runs || logs.runs.length === 0) {
        throw new Error(
          `[ai-router][workflow] Upstash workflow run ${runId} not found.`,
        );
      }

      const run = logs.runs[0];
      const status = normalizeUpstashStatus(run.workflowState);

      let result: any;
      let error: string | undefined;

      // Extract result from the last successful step if completed
      if (status === 'completed' && run.steps) {
        // `run.steps` is a union of grouped step logs; we need to be defensive.
        const stepsAny = run.steps as any[];
        const completedSteps = stepsAny.filter(
          (step: any) => step.state === 'SUCCESS' && 'output' in step && step.output !== undefined,
        );
        if (completedSteps.length > 0) {
          const lastStep = completedSteps[completedSteps.length - 1] as any;
          result = lastStep.output;
        }
      }

      // Extract error from failed steps
      if (status === 'failed' && run.steps) {
        const stepsAny = run.steps as any[];
        const failedSteps = stepsAny.filter(
          (step: any) => step.state === 'FAILED',
        );
        if (failedSteps.length > 0) {
          const lastFailed = failedSteps[failedSteps.length - 1] as any;
          const stepError = lastFailed.error;
          error =
            stepError?.message ||
            stepError ||
            'Workflow step failed';
        }
      }

      const resultObj: WorkflowRuntimeStatusResult<any> = {
        status,
        result,
        error,
      };

      // Extract hook token from Upstash workflow status
      // Upstash workflows pause when waiting for `waitForEvent` (HITL)
      // We detect this by checking for steps in WAITING state
      if (status === 'running' && run.steps) {
        const stepsAny = run.steps as any[];
        
        // Find steps that are waiting (could be waiting for events/hooks)
        const waitingSteps = stepsAny.filter((step: any) => {
          const stepState = step.state?.toUpperCase();
          const stepName = step.name?.toLowerCase() || '';
          
          // Check for WAITING state or steps with wait/event in name
          return (
            stepState === 'WAITING' ||
            stepName.includes('wait') ||
            stepName.includes('event') ||
            stepName.includes('hook')
          );
        });
        
        if (waitingSteps.length > 0) {
          // Try to extract event ID from the first waiting step
          // Upstash step logs contain eventId in various locations
          const firstWaiting: any = waitingSteps[0];
          
          // Try multiple extraction strategies for event ID
          let eventId: string | undefined;
          
          // Strategy 1: Direct eventId property
          eventId = firstWaiting.eventId;
          
          // Strategy 2: From metadata
          if (!eventId && firstWaiting.metadata) {
            eventId = firstWaiting.metadata.eventId || firstWaiting.metadata.event_id;
          }
          
          // Strategy 3: From input parameters (waitForEvent input)
          if (!eventId && firstWaiting.input) {
            eventId = firstWaiting.input.eventId || firstWaiting.input.event_id || firstWaiting.input.eventIdKey;
          }
          
          // Strategy 4: From output or result (if stored there)
          if (!eventId && firstWaiting.output) {
            eventId = firstWaiting.output.eventId || firstWaiting.output.event_id;
          }
          
          // Strategy 5: Parse from step name if it follows a pattern like "wait-for-hook-{token}"
          if (!eventId && firstWaiting.name) {
            const nameMatch = firstWaiting.name.match(/wait[-_]for[-_](?:hook[-_])?(.+)/i);
            if (nameMatch && nameMatch[1]) {
              eventId = nameMatch[1];
            }
          }
          
          // Strategy 6: Extract from step arguments if available
          if (!eventId && firstWaiting.args) {
            eventId = firstWaiting.args.eventId || firstWaiting.args.event_id;
          }
          
          // If we found an event ID, set it as the hook token.
          // IMPORTANT: token MUST be the exact eventId used by waitForEvent(),
          // because resumeHook() notifies by eventId.
          if (eventId) {
            resultObj.hook = {
              token: eventId,
              type: 'hook',
            };
          } else {
            // If no eventId found but step is waiting, still indicate a hook
            // The token might need to be constructed deterministically from runId + step name
            resultObj.hook = {
              token: `${runId}-${firstWaiting.name || 'hook'}`,
              type: 'hook',
            };
          }
        }
      }

      return resultObj;
    } catch (err: any) {
      return {
        status: 'error',
        error: err?.message || String(err),
      };
    }
  },

  async resumeHook<Payload, Output>(
    token: string,
    payload: Payload,
  ): Promise<WorkflowRuntimeStatusResult<Output>> {
    const client = getUpstashClient();

    try {
      // Use Upstash notify to resume workflows waiting on this event ID
      // client.notify returns an array of waiters directly
      const waiters = (await client.notify({
        eventId: token,
        eventData: payload,
      })) as any[];

      // Check if any workflows were actually waiting
      if (!waiters || waiters.length === 0) {
        throw new Error(
          `[ai-router][workflow] No Upstash workflows were waiting for event ID: ${token}`,
        );
      }

      // Return a resumed status; caller should poll getWorkflowStatus
      // to get updated workflow state after the event is processed
      return {
        status: 'resumed',
      };
    } catch (error: any) {
      throw new Error(
        `[ai-router][workflow] Failed to resume Upstash hook with token ${token}: ${error?.message || String(error)}`,
      );
    }
  },

  async resumeWebhook<Payload, Output>(
    token: string,
    payload: Payload,
  ): Promise<WorkflowRuntimeStatusResult<Output>> {
    // Upstash Workflow doesn't have a separate webhook concept;
    // webhooks are handled the same way as hooks via notify
    return this.resumeHook(token, payload);
  },
};
