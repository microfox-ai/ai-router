/**
 * @microfox/ai-worker
 * Worker runtime for ai-router - SQS-based async agent execution
 */

import { dispatch, dispatchLocal, getWorkersTriggerUrl, type DispatchOptions, type DispatchResult } from './client.js';
import { createLambdaHandler, createWorkerLogger, type WorkerHandler, type JobStore, type DispatchWorkerOptions, SQS_MAX_DELAY_SECONDS } from './handler.js';
import type { ZodType, z } from 'zod';

export * from './client.js';
export * from './handler.js';
export * from './config.js';
export * from './queue.js';

/**
 * Schedule event configuration for a worker.
 * Supports both simple rate/cron strings and full configuration objects.
 * 
 * @example Simple rate/cron
 * ```typescript
 * schedule: 'rate(2 hours)'
 * // or
 * schedule: 'cron(0 12 * * ? *)'
 * ```
 * 
 * @example Full configuration
 * ```typescript
 * schedule: {
 *   rate: 'rate(10 minutes)',
 *   enabled: true,
 *   input: { key1: 'value1' }
 * }
 * ```
 * 
 * @example Multiple schedules
 * ```typescript
 * schedule: [
 *   'rate(2 hours)',
 *   { rate: 'cron(0 12 * * ? *)', enabled: false }
 * ]
 * ```
 */
export interface ScheduleEventConfig {
  /**
   * Schedule rate using either rate() or cron() syntax.
   * Can be a string or array of strings for multiple schedules.
   * 
   * @example 'rate(2 hours)' or 'cron(0 12 * * ? *)'
   * @example ['cron(0 0/4 ? * MON-FRI *)', 'cron(0 2 ? * SAT-SUN *)']
   */
  rate: string | string[];
  /**
   * Whether the schedule is enabled (default: true).
   */
  enabled?: boolean;
  /**
   * Input payload to pass to the function.
   */
  input?: Record<string, any>;
  /**
   * JSONPath expression to select part of the event data as input.
   */
  inputPath?: string;
  /**
   * Input transformer configuration for custom input mapping.
   */
  inputTransformer?: {
    inputPathsMap?: Record<string, string>;
    inputTemplate?: string;
  };
  /**
   * Name of the schedule event.
   */
  name?: string;
  /**
   * Description of the schedule event.
   */
  description?: string;
  /**
   * Method to use: 'eventBus' (default) or 'scheduler'.
   * Use 'scheduler' for higher limits (1M events vs 300).
   */
  method?: 'eventBus' | 'scheduler';
  /**
   * Timezone for the schedule (only used with method: 'scheduler').
   * @example 'America/New_York'
   */
  timezone?: string;
}

export type ScheduleConfig = 
  | string 
  | ScheduleEventConfig 
  | (string | ScheduleEventConfig)[];

/**
 * Configuration for a worker's Lambda function deployment.
 * 
 * **Best Practice**: Export this as a separate const from your worker file:
 * ```typescript
 * export const workerConfig: WorkerConfig = {
 *   timeout: 900,
 *   memorySize: 2048,
 *   layers: ['arn:aws:lambda:${aws:region}:${aws:accountId}:layer:ffmpeg:1'],
 *   schedule: 'rate(2 hours)',
 * };
 * ```
 * 
 * The CLI will automatically extract it from the export. You do not need to pass it to `createWorker()`.
 */
export interface WorkerConfig {
  /**
   * Lambda function timeout in seconds (max 900).
   */
  timeout?: number;
  /**
   * Lambda function memory size in MB (128-10240).
   */
  memorySize?: number;
  /**
   * Optional Lambda layers ARNs to attach to this worker function.
   *
   * This is primarily used by @microfox/ai-worker-cli when generating serverless.yml.
   * Supports CloudFormation pseudo-parameters like ${aws:region} and ${aws:accountId}.
   *
   * Example:
   *   layers: ['arn:aws:lambda:${aws:region}:${aws:accountId}:layer:ffmpeg:1']
   */
  layers?: string[];
  /**
   * Schedule events configuration for this worker.
   * Allows multiple schedule events to be attached to the same function.
   * 
   * @example Simple rate
   * ```typescript
   * schedule: 'rate(2 hours)'
   * ```
   * 
   * @example Multiple schedules
   * ```typescript
   * schedule: [
   *   'rate(2 hours)',
   *   { rate: 'cron(0 12 * * ? *)', enabled: true, input: { key: 'value' } }
   * ]
   * ```
   * 
   * @example Using scheduler method with timezone
   * ```typescript
   * schedule: {
   *   method: 'scheduler',
   *   rate: 'cron(0 0/4 ? * MON-FRI *)',
   *   timezone: 'America/New_York',
   *   input: { key1: 'value1' }
   * }
   * ```
   */
  schedule?: ScheduleConfig;

  /**
   * SQS queue settings for this worker (used by @microfox/ai-worker-cli when generating serverless.yml).
   *
   * Notes:
   * - To effectively disable retries, set `maxReceiveCount: 1` (requires DLQ; the CLI will create one).
   * - SQS does not support `maxReceiveCount: 0`.
   * - `messageRetentionPeriod` is in seconds (max 1209600 = 14 days).
   */
  sqs?: {
    /**
     * How many receives before sending to DLQ.
     * Use 1 to avoid retries.
     */
    maxReceiveCount?: number;
    /**
     * How long messages are retained in the main queue (seconds).
     */
    messageRetentionPeriod?: number;
    /**
     * Visibility timeout for the main queue (seconds).
     * If not set, CLI defaults to (worker timeout + 60s).
     */
    visibilityTimeout?: number;
    /**
     * DLQ message retention period (seconds).
     * Defaults to `messageRetentionPeriod` (or 14 days).
     */
    deadLetterMessageRetentionPeriod?: number;
  };
}

export interface WorkerAgentConfig<INPUT_SCHEMA extends ZodType<any>, OUTPUT> {
  id: string;
  inputSchema: INPUT_SCHEMA;
  outputSchema: ZodType<OUTPUT>;
  handler: WorkerHandler<z.infer<INPUT_SCHEMA>, OUTPUT>;
  /**
   * @deprecated Prefer exporting `workerConfig` as a separate const from your worker file.
   * The CLI will automatically extract it from the export. This parameter is kept for backward compatibility.
   */
  workerConfig?: WorkerConfig;
}

export interface WorkerAgent<INPUT_SCHEMA extends ZodType<any>, OUTPUT> {
  id: string;
  dispatch: (
    input: z.input<INPUT_SCHEMA>,
    options: DispatchOptions
  ) => Promise<DispatchResult>;
  handler: WorkerHandler<z.infer<INPUT_SCHEMA>, OUTPUT>;
  inputSchema: INPUT_SCHEMA;
  outputSchema: ZodType<OUTPUT>;
  workerConfig?: WorkerConfig;
}

/**
 * Creates a worker agent that can be dispatched to SQS/Lambda.
 *
 * In development mode (NODE_ENV === 'development' and WORKERS_LOCAL_MODE !== 'false'),
 * dispatch() will run the handler immediately in the same process.
 *
 * In production, dispatch() sends a message to SQS which triggers a Lambda function.
 *
 * @template INPUT_SCHEMA - The Zod schema type (e.g., `typeof InputSchema`).
 *                          Used to derive both:
 *                          - Pre-parse input type via `z.input<INPUT_SCHEMA>` for `dispatch()` (preserves optional fields)
 *                          - Parsed input type via `z.infer<INPUT_SCHEMA>` for handler (defaults applied)
 * @template OUTPUT - The output type returned by the handler. Use `z.infer<typeof OutputSchema>`.
 *
 * @param config - Worker agent configuration
 * @returns A worker agent object with a dispatch method
 *
 * @example
 * ```typescript
 * const InputSchema = z.object({
 *   url: z.string().url(),
 *   timeout: z.number().optional().default(5000), // optional with default
 * });
 *
 * export const worker = createWorker<typeof InputSchema, Output>({
 *   // dispatch() accepts { url: string, timeout?: number } (pre-parse, optional preserved)
 *   // handler receives { url: string, timeout: number } (parsed, default applied)
 * });
 * ```
 */
export function createWorker<INPUT_SCHEMA extends ZodType<any>, OUTPUT>(
  config: WorkerAgentConfig<INPUT_SCHEMA, OUTPUT>
): WorkerAgent<INPUT_SCHEMA, OUTPUT> {
  const { id, inputSchema, outputSchema, handler } = config;

  const agent: WorkerAgent<INPUT_SCHEMA, OUTPUT> = {
    id,
    handler,
    inputSchema,
    outputSchema,

    async dispatch(input: z.input<INPUT_SCHEMA>, options: DispatchOptions): Promise<DispatchResult> {
      const mode = options.mode ?? 'auto';
      const envWantsLocal =
        process.env.NODE_ENV === 'development' &&
        process.env.WORKERS_LOCAL_MODE !== 'false';
      // Check if we're in local development mode
      const isLocal = mode === 'local' || (mode === 'auto' && envWantsLocal);

      if (isLocal) {
        // Local mode: run handler immediately
        // Parse input to apply defaults and get the final parsed type
        const parsedInput = inputSchema.parse(input);
        const localJobId = options.jobId || `local-${Date.now()}`;
        
        // Try to get direct job store access in local mode (same process as Next.js app)
        // This allows direct DB updates without needing HTTP/webhook URLs
        let directJobStore: {
          updateJob: (jobId: string, data: any) => Promise<void>;
          setJob?: (jobId: string, data: any) => Promise<void>;
        } | null = null;

        // Path constants for job store imports
        const nextJsPathAlias = '@/app/api/workflows/stores/jobStore';
        const explicitPath = process.env.WORKER_JOB_STORE_MODULE_PATH;

        // Reliable approach: try Next.js path alias first, then explicit env var
        // The @/ alias works at runtime in Next.js context
        const resolveJobStore = async () => {
          // Option 1: Try Next.js path alias (works in Next.js runtime context)
          try {
            const module = await import(nextJsPathAlias);
            if (module?.updateJob) {
              return { updateJob: module.updateJob, setJob: module.setJob };
            }
          } catch {
            // Path alias not available (not in Next.js context or alias not configured)
          }

          // Option 2: Use explicit env var if provided (for custom setups)
          if (explicitPath) {
            try {
              const module = await import(explicitPath).catch(() => {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                return require(explicitPath);
              });
              if (module?.updateJob) {
                return { updateJob: module.updateJob, setJob: module.setJob };
              }
            } catch {
              // Explicit path failed
            }
          }

          return null;
        };

        directJobStore = await resolveJobStore();
        if (directJobStore) {
          console.log('[Worker] Using direct job store in local mode (no HTTP needed)');
        }

        // Derive job store URL from webhook URL or environment (fallback for HTTP mode)
        let jobStoreUrl: string | undefined;
        if (options.webhookUrl) {
          try {
            const webhookUrlObj = new URL(options.webhookUrl);
            jobStoreUrl = webhookUrlObj.pathname.replace(/\/webhook$/, '');
            jobStoreUrl = `${webhookUrlObj.origin}${jobStoreUrl}`;
          } catch {
            // Invalid URL, skip job store URL
          }
        }
        jobStoreUrl = jobStoreUrl || process.env.WORKER_JOB_STORE_URL;

        // Create job store interface for local mode
        // Prefer direct DB access, fallback to HTTP calls if needed
        const createLocalJobStore = (
          directStore: typeof directJobStore,
          httpUrl?: string
        ): JobStore | undefined => {
          // If we have direct job store access, use it (no HTTP needed)
          if (directStore) {
            return {
              update: async (update) => {
                try {
                  // Build update payload
                  const updatePayload: any = {};
                  
                  if (update.status !== undefined) {
                    updatePayload.status = update.status;
                  }
                  if (update.metadata !== undefined) {
                    updatePayload.metadata = update.metadata;
                  }
                  if (update.progress !== undefined) {
                    // Merge progress into metadata
                    updatePayload.metadata = {
                      ...updatePayload.metadata,
                      progress: update.progress,
                      progressMessage: update.progressMessage,
                    };
                  }
                  if (update.output !== undefined) {
                    updatePayload.output = update.output;
                  }
                  if (update.error !== undefined) {
                    updatePayload.error = update.error;
                  }

                  await directStore.updateJob(localJobId, updatePayload);
                  console.log('[Worker] Local job updated (direct DB):', {
                    jobId: localJobId,
                    workerId: id,
                    updates: Object.keys(updatePayload),
                  });
                } catch (error: any) {
                  console.warn('[Worker] Failed to update local job (direct DB):', {
                    jobId: localJobId,
                    workerId: id,
                    error: error?.message || String(error),
                  });
                }
              },
              get: async () => {
                try {
                  // Use the same direct store that has updateJob - it should also have getJob
                  if (directStore) {
                    // Try to import getJob from the same module
                    const nextJsPath = '@/app/api/workflows/stores/jobStore';
                    const explicitPath = process.env.WORKER_JOB_STORE_MODULE_PATH;
                    
                    for (const importPath of [nextJsPath, explicitPath].filter(Boolean)) {
                      try {
                        const module = await import(importPath!);
                        if (module?.getJob) {
                          return await module.getJob(localJobId);
                        }
                      } catch {
                        // Continue
                      }
                    }
                  }
                  return null;
                } catch (error: any) {
                  console.warn('[Worker] Failed to get local job (direct DB):', {
                    jobId: localJobId,
                    workerId: id,
                    error: error?.message || String(error),
                  });
                  return null;
                }
              },
              appendInternalJob: async (entry: { jobId: string; workerId: string }) => {
                try {
                  const nextJsPath = '@/app/api/workflows/stores/jobStore';
                  const explicitPath = process.env.WORKER_JOB_STORE_MODULE_PATH;
                  for (const importPath of [nextJsPath, explicitPath].filter(Boolean)) {
                    try {
                      const module = await import(importPath!);
                      if (typeof module?.appendInternalJob === 'function') {
                        await module.appendInternalJob(localJobId, entry);
                        return;
                      }
                    } catch {
                      // Continue
                    }
                  }
                } catch (error: any) {
                  console.warn('[Worker] Failed to appendInternalJob (direct DB):', { localJobId, error: error?.message || String(error) });
                }
              },
              getJob: async (otherJobId: string) => {
                try {
                  const nextJsPath = '@/app/api/workflows/stores/jobStore';
                  const explicitPath = process.env.WORKER_JOB_STORE_MODULE_PATH;
                  for (const importPath of [nextJsPath, explicitPath].filter(Boolean)) {
                    try {
                      const module = await import(importPath!);
                      if (typeof module?.getJob === 'function') {
                        return await module.getJob(otherJobId);
                      }
                    } catch {
                      // Continue
                    }
                  }
                } catch (error: any) {
                  console.warn('[Worker] Failed to getJob (direct DB):', { otherJobId, error: error?.message || String(error) });
                }
                return null;
              },
            };
          }

          // Fallback to HTTP calls if no direct access
          if (!httpUrl) {
            return undefined;
          }

          // Use HTTP calls to update job store
          return {
            update: async (update) => {
              try {
                // Build update payload
                const updatePayload: any = { jobId: localJobId, workerId: id };
                
                if (update.status !== undefined) {
                  updatePayload.status = update.status;
                }
                if (update.metadata !== undefined) {
                  updatePayload.metadata = update.metadata;
                }
                if (update.progress !== undefined) {
                  // Merge progress into metadata
                  updatePayload.metadata = {
                    ...updatePayload.metadata,
                    progress: update.progress,
                    progressMessage: update.progressMessage,
                  };
                }
                if (update.output !== undefined) {
                  updatePayload.output = update.output;
                }
                if (update.error !== undefined) {
                  updatePayload.error = update.error;
                }

                const response = await fetch(`${httpUrl}/update`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(updatePayload),
                });
                if (!response.ok) {
                  throw new Error(`Job store update failed: ${response.status} ${response.statusText}`);
                }
                console.log('[Worker] Local job updated (HTTP):', {
                  jobId: localJobId,
                  workerId: id,
                  updates: Object.keys(updatePayload),
                });
              } catch (error: any) {
                console.warn('[Worker] Failed to update local job (HTTP):', {
                  jobId: localJobId,
                  workerId: id,
                  error: error?.message || String(error),
                });
              }
            },
            get: async () => {
              try {
                // GET /api/workflows/workers/:workerId/:jobId
                const response = await fetch(`${httpUrl}/${id}/${localJobId}`, {
                  method: 'GET',
                  headers: { 'Content-Type': 'application/json' },
                });

                if (!response.ok) {
                  if (response.status === 404) {
                    return null;
                  }
                  throw new Error(`Job store get failed: ${response.status} ${response.statusText}`);
                }

                return await response.json();
              } catch (error: any) {
                console.warn('[Worker] Failed to get local job (HTTP):', {
                  jobId: localJobId,
                  workerId: id,
                  error: error?.message || String(error),
                });
                return null;
              }
            },
          };
        };

        const jobStore = createLocalJobStore(directJobStore, jobStoreUrl);

        const DEFAULT_POLL_INTERVAL_MS = 2000;
        const DEFAULT_POLL_TIMEOUT_MS = 15 * 60 * 1000;

        const createLocalDispatchWorker = (
          parentJobId: string,
          parentWorkerId: string,
          parentContext: Record<string, any>,
          store: JobStore | undefined
        ): ((
          workerId: string,
          input: unknown,
          options?: DispatchWorkerOptions
        ) => Promise<{ jobId: string; messageId?: string; output?: unknown }>) => {
          return async (
            calleeWorkerId: string,
            input: unknown,
            options?: DispatchWorkerOptions
          ): Promise<{ jobId: string; messageId?: string; output?: unknown }> => {
            const childJobId =
              options?.jobId ||
              `job-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
            const metadata = options?.metadata ?? {};
            const serializedContext: Record<string, any> = {};
            if (parentContext.requestId) serializedContext.requestId = parentContext.requestId;
            const messageBody = {
              workerId: calleeWorkerId,
              jobId: childJobId,
              input: input ?? {},
              context: serializedContext,
              webhookUrl: options?.webhookUrl,
              metadata,
              timestamp: new Date().toISOString(),
            };
            let triggerUrl: string;
            try {
              triggerUrl = getWorkersTriggerUrl();
            } catch (e: any) {
              throw new Error(
                `Local dispatchWorker requires WORKER_BASE_URL (or similar) for worker "${calleeWorkerId}": ${e?.message ?? e}`
              );
            }
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            const triggerKey = process.env.WORKERS_TRIGGER_API_KEY;
            if (triggerKey) headers['x-workers-trigger-key'] = triggerKey;

            // Fire-and-forget with delay: schedule trigger after delay, return immediately (no computation/wait in caller).
            if (options?.await !== true && options?.delaySeconds != null && options.delaySeconds > 0) {
              const sec = Math.min(SQS_MAX_DELAY_SECONDS, Math.max(0, Math.floor(options.delaySeconds)));
              const storeRef = store;
              setTimeout(() => {
                fetch(triggerUrl, {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({ workerId: calleeWorkerId, body: messageBody }),
                })
                  .then(async (response) => {
                    if (!response.ok) {
                      const text = await response.text().catch(() => '');
                      console.error(
                        `[Worker] Delayed trigger failed for "${calleeWorkerId}": ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`
                      );
                      return;
                    }
                    if (storeRef?.appendInternalJob) {
                      await storeRef.appendInternalJob({ jobId: childJobId, workerId: calleeWorkerId });
                    }
                  })
                  .catch((err) => {
                    console.error('[Worker] Delayed trigger error:', { calleeWorkerId, jobId: childJobId, error: err?.message ?? err });
                  });
              }, sec * 1000);
              return { jobId: childJobId, messageId: undefined };
            }

            const response = await fetch(triggerUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify({ workerId: calleeWorkerId, body: messageBody }),
            });
            if (!response.ok) {
              const text = await response.text().catch(() => '');
              throw new Error(
                `Failed to trigger worker "${calleeWorkerId}": ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`
              );
            }
            const data = (await response.json().catch(() => ({}))) as any;
            const messageId = data?.messageId ? String(data.messageId) : `trigger-${childJobId}`;

            if (store?.appendInternalJob) {
              await store.appendInternalJob({ jobId: childJobId, workerId: calleeWorkerId });
            }

            if (options?.await && store?.getJob) {
              const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
              const pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
              const deadline = Date.now() + pollTimeoutMs;
              while (Date.now() < deadline) {
                const child = await store.getJob(childJobId);
                if (!child) {
                  await new Promise((r) => setTimeout(r, pollIntervalMs));
                  continue;
                }
                if (child.status === 'completed') {
                  return { jobId: childJobId, messageId, output: child.output };
                }
                if (child.status === 'failed') {
                  const err = child.error;
                  throw new Error(err?.message ?? `Child worker ${calleeWorkerId} failed`);
                }
                await new Promise((r) => setTimeout(r, pollIntervalMs));
              }
              throw new Error(
                `Child worker ${calleeWorkerId} (${childJobId}) did not complete within ${pollTimeoutMs}ms`
              );
            }

            return { jobId: childJobId, messageId };
          };
        };

        // Create initial job record if we have job store access
        if (directJobStore?.setJob) {
          try {
            await directJobStore.setJob(localJobId, {
              jobId: localJobId,
              workerId: id,
              status: 'queued',
              input: parsedInput,
              metadata: options.metadata || {},
            });
          } catch (error: any) {
            console.warn('[Worker] Failed to create initial job record:', {
              jobId: localJobId,
              workerId: id,
              error: error?.message || String(error),
            });
            // Continue - job will still be created when status is updated
          }
        }

        const baseContext = { jobId: localJobId, workerId: id };
        const handlerContext = {
          ...baseContext,
          ...(jobStore ? { jobStore } : {}),
          logger: createWorkerLogger(localJobId, id),
          dispatchWorker: createLocalDispatchWorker(
            localJobId,
            id,
            baseContext,
            jobStore
          ),
        };

        try {
          // Update status to running before execution
          if (jobStore) {
            await jobStore.update({ status: 'running' });
          }

          const output = await dispatchLocal(handler, parsedInput, handlerContext);

          // Update status to completed before webhook
          if (jobStore) {
            await jobStore.update({ status: 'completed', output });
          }

          // Only send webhook if webhookUrl is provided
          if (options.webhookUrl) {
            try {
              await fetch(options.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jobId: localJobId,
                  workerId: id,
                  status: 'success',
                  output,
                  metadata: options.metadata,
                }),
              });
            } catch (error) {
              console.warn('[Worker] Local webhook call failed:', error);
            }
          }

          return {
            messageId: `local-${Date.now()}`,
            status: 'queued',
            jobId: localJobId,
          };
        } catch (error: any) {
          // Update status to failed before webhook
          if (jobStore) {
            await jobStore.update({
              status: 'failed',
              error: {
                message: error.message || 'Unknown error',
                stack: error.stack,
                name: error.name || 'Error',
              },
            });
          }

          // Only send error webhook if webhookUrl is provided
          if (options.webhookUrl) {
            try {
              await fetch(options.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jobId: localJobId,
                  workerId: id,
                  status: 'error',
                  error: {
                    message: error.message || 'Unknown error',
                    stack: error.stack,
                    name: error.name || 'Error',
                  },
                  metadata: options.metadata,
                }),
              });
            } catch (webhookError) {
              console.warn('[Worker] Local error webhook call failed:', webhookError);
            }
          }
          throw error;
        }
      }

      // Production mode: dispatch to SQS
      return dispatch(id, input, inputSchema, options);
    },
  };

  return agent;
}

/**
 * Creates a Lambda handler entrypoint for a worker agent.
 * This is used by the deployment script to generate Lambda entrypoints.
 *
 * @param agent - The worker agent
 * @returns A Lambda handler function
 */
export function createLambdaEntrypoint<INPUT_SCHEMA extends ZodType<any>, OUTPUT>(
  agent: WorkerAgent<INPUT_SCHEMA, OUTPUT>
) {
  return createLambdaHandler(agent.handler, agent.outputSchema);
}
