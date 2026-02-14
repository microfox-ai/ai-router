/**
 * Generic Lambda handler wrapper for worker agents.
 * Handles SQS events, executes user handlers, and sends webhook callbacks.
 * Job store: MongoDB only. Never uses HTTP/origin URL for job updates.
 */

import type { SQSEvent, SQSRecord, Context as LambdaContext } from 'aws-lambda';
import type { ZodType } from 'zod';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import {
  createMongoJobStore,
  upsertJob,
  isMongoJobStoreConfigured,
  getJobById as getMongoJobById,
} from './mongoJobStore';
import {
  createRedisJobStore,
  upsertRedisJob,
  isRedisJobStoreConfigured,
  loadJob as loadRedisJob,
} from './redisJobStore';
import {
  appendQueueJobStepInStore,
  updateQueueJobStepInStore,
  upsertInitialQueueJob,
  getQueueJob,
} from './queueJobStore';

export interface JobStoreUpdate {
  status?: 'queued' | 'running' | 'completed' | 'failed';
  metadata?: Record<string, any>;
  progress?: number;
  progressMessage?: string;
  output?: any;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

export interface JobRecord {
  jobId: string;
  workerId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  input: any;
  output?: any;
  error?: { message: string; stack?: string };
  metadata?: Record<string, any>;
  internalJobs?: Array<{ jobId: string; workerId: string }>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface JobStore {
  /**
   * Update job in job store.
   * @param update - Update object with status, metadata, progress, output, or error
   */
  update(update: JobStoreUpdate): Promise<void>;
  /**
   * Get current job record from job store.
   * @returns Job record or null if not found
   */
  get(): Promise<JobRecord | null>;
  /**
   * Append an internal (child) job to the current job's internalJobs list.
   * Used when this worker dispatches another worker (fire-and-forget or await).
   */
  appendInternalJob?(entry: { jobId: string; workerId: string }): Promise<void>;
  /**
   * Get any job by jobId (e.g. to poll child job status when await: true).
   * @returns Job record or null if not found
   */
  getJob?(jobId: string): Promise<JobRecord | null>;
}

/** Max SQS delay in seconds (AWS limit). */
export const SQS_MAX_DELAY_SECONDS = 900;

/** Options for ctx.dispatchWorker (worker-to-worker). */
export interface DispatchWorkerOptions {
  webhookUrl?: string;
  metadata?: Record<string, any>;
  /** Optional job ID for the child job (default: generated). */
  jobId?: string;
  /** If true, poll job store until child completes or fails; otherwise fire-and-forget. */
  await?: boolean;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  /**
   * Delay before the child is invoked (fire-and-forget only; ignored when await is true).
   * Uses SQS DelaySeconds (0–900). In local mode, waits this many seconds before sending the trigger request.
   */
  delaySeconds?: number;
}

/**
 * Logger provided on ctx with prefixed levels: [INFO], [WARN], [ERROR], [DEBUG].
 * Each method accepts a message and optional data (logged as JSON).
 */
export interface WorkerLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

export function createWorkerLogger(jobId: string, workerId: string): WorkerLogger {
  const prefix = (level: string) => `[${level}] [${workerId}] [${jobId}]`;
  return {
    info(msg: string, data?: Record<string, unknown>) {
      console.log(prefix('INFO'), msg, data !== undefined ? JSON.stringify(data) : '');
    },
    warn(msg: string, data?: Record<string, unknown>) {
      console.warn(prefix('WARN'), msg, data !== undefined ? JSON.stringify(data) : '');
    },
    error(msg: string, data?: Record<string, unknown>) {
      console.error(prefix('ERROR'), msg, data !== undefined ? JSON.stringify(data) : '');
    },
    debug(msg: string, data?: Record<string, unknown>) {
      if (process.env.DEBUG || process.env.WORKER_DEBUG) {
        console.debug(prefix('DEBUG'), msg, data !== undefined ? JSON.stringify(data) : '');
      }
    },
  };
}

export interface WorkerHandlerParams<INPUT, OUTPUT> {
  input: INPUT;
  ctx: {
    jobId: string;
    workerId: string;
    requestId?: string;
    /**
     * Job store interface for updating and retrieving job state.
     * Uses MongoDB directly when configured; never HTTP/origin URL.
     */
    jobStore?: JobStore;
    /**
     * Logger with prefixed levels: ctx.logger.info(), .warn(), .error(), .debug().
     */
    logger: WorkerLogger;
    /**
     * Dispatch another worker (fire-and-forget or await). Uses WORKER_QUEUE_URL_<SANITIZED_ID> env.
     * Always provided by the runtime (Lambda and local).
     */
    dispatchWorker: (
      workerId: string,
      input: unknown,
      options?: DispatchWorkerOptions
    ) => Promise<{ jobId: string; messageId?: string; output?: unknown }>;
    [key: string]: any;
  };
}

export type WorkerHandler<INPUT, OUTPUT> = (
  params: WorkerHandlerParams<INPUT, OUTPUT>
) => Promise<OUTPUT>;

/** Result of getNextStep for queue chaining. */
export interface QueueNextStep {
  workerId: string;
  delaySeconds?: number;
  mapInputFromPrev?: string;
}

/** One previous step's output (for mapInputFromPrev context). */
export interface QueueStepOutput {
  stepIndex: number;
  workerId: string;
  output: unknown;
}

/** Runtime helpers for queue-aware wrappers (provided by generated registry). */
export interface QueueRuntime {
  getNextStep(queueId: string, stepIndex: number): QueueNextStep | undefined;
  /** Optional: when provided, mapping can use outputs from any previous step. */
  getQueueJob?(queueJobId: string): Promise<{ steps: Array<{ workerId: string; output?: unknown }> } | null>;
  /** (initialInput, previousOutputs) – previousOutputs includes outputs for steps 0..stepIndex-1 and current step. */
  invokeMapInput?(
    queueId: string,
    stepIndex: number,
    initialInput: unknown,
    previousOutputs: QueueStepOutput[]
  ): Promise<unknown> | unknown;
}

const WORKER_QUEUE_KEY = '__workerQueue';
async function notifyQueueJobStep(
  queueJobId: string,
  action: 'start' | 'complete' | 'fail' | 'append',
  params: {
    stepIndex?: number;
    workerJobId: string;
    workerId?: string;
    output?: unknown;
    error?: { message: string };
    input?: unknown;
    queueId?: string;
  }
): Promise<void> {
  try {
    if (action === 'append') {
      if (!params.workerId || !params.workerJobId) return;
    await appendQueueJobStepInStore({
      queueJobId,
      workerId: params.workerId,
      workerJobId: params.workerJobId,
    });
    if (process.env.DEBUG_WORKER_QUEUES === '1') {
      console.log('[Worker] Queue job step appended', {
        queueJobId,
        workerId: params.workerId,
        workerJobId: params.workerJobId,
      });
    }
      return;
    }

    if (params.stepIndex === undefined) return;

    const status =
      action === 'start'
        ? 'running'
        : action === 'complete'
          ? 'completed'
          : action === 'fail'
            ? 'failed'
            : undefined;
    if (!status) return;

    await updateQueueJobStepInStore({
      queueJobId,
      stepIndex: params.stepIndex,
      workerId: params.workerId || '',
      workerJobId: params.workerJobId,
      status,
      input: params.input,
      output: params.output,
      error: params.error,
    });
    // Always log queue step updates so logs show which queue and step ran
    console.log('[Worker] Queue job step updated', {
      queueId: params.queueId ?? queueJobId,
      queueJobId,
      stepIndex: params.stepIndex,
      workerId: params.workerId,
      status,
    });
  } catch (err: any) {
    console.warn('[Worker] Queue job update error:', {
      queueJobId,
      action,
      error: err?.message ?? String(err),
    });
  }
}

/**
 * Wraps a user handler so that when the job has __workerQueue context (from
 * dispatchQueue or queue cron), it dispatches the next worker in the sequence
 * after the handler completes. Uses literal worker IDs so the CLI env injection
 * picks up WORKER_QUEUE_URL_* for next-step workers.
 */
export function wrapHandlerForQueue<INPUT, OUTPUT>(
  handler: WorkerHandler<INPUT, OUTPUT>,
  queueRuntime: QueueRuntime
): WorkerHandler<INPUT & { __workerQueue?: { id: string; stepIndex: number; initialInput: unknown; queueJobId?: string } }, OUTPUT> {
  return async (params) => {
    const queueContext = (params.input as any)?.[WORKER_QUEUE_KEY];
    const output = await handler(params);

    if (!queueContext || typeof queueContext !== 'object' || !queueContext.id) {
      return output;
    }

    const { id: queueId, stepIndex, initialInput, queueJobId } = queueContext;
    const jobId = (params.ctx as any)?.jobId;
    const workerId = (params.ctx as any)?.workerId ?? '';

    const next = queueRuntime.getNextStep(queueId, stepIndex);
    const childJobId = next ? `job-${Date.now()}-${Math.random().toString(36).slice(2, 11)}` : undefined;
    if (next && queueJobId) {
      // Append next step first so updateQueueJobStepInStore(complete) sees steps.length > 1
      await notifyQueueJobStep(queueJobId, 'append', {
        workerJobId: childJobId!,
        workerId: next.workerId,
      });
    }

    // Notify current step complete (after append when there's next, so queue isn't marked completed yet)
    if (queueJobId && typeof stepIndex === 'number') {
      await notifyQueueJobStep(queueJobId, 'complete', {
        queueId,
        stepIndex,
        workerJobId: jobId,
        workerId,
        output,
      });
    }

    if (!next) {
      return output;
    }

    let nextInput: unknown = output;
    if (next.mapInputFromPrev && typeof queueRuntime.invokeMapInput === 'function') {
      let previousOutputs: QueueStepOutput[] = [];
      if (queueJobId && typeof queueRuntime.getQueueJob === 'function') {
        try {
          const job = await queueRuntime.getQueueJob(queueJobId);
          if (job?.steps) {
            const fromStore = job.steps
              .slice(0, stepIndex)
              .map((s, i) => ({ stepIndex: i, workerId: s.workerId, output: s.output }));
            previousOutputs = fromStore.concat([
              { stepIndex, workerId: (params.ctx as any)?.workerId ?? '', output },
            ]);
          }
        } catch (e: any) {
          if (process.env.AI_WORKER_QUEUES_DEBUG === '1') {
            console.warn('[Worker] getQueueJob failed, mapping without previousOutputs:', e?.message ?? e);
          }
        }
      }
      nextInput = await queueRuntime.invokeMapInput(
        queueId,
        stepIndex + 1,
        initialInput,
        previousOutputs
      );
    }

    const nextInputWithQueue = {
      ...(nextInput !== null && typeof nextInput === 'object' ? (nextInput as Record<string, unknown>) : { value: nextInput }),
      [WORKER_QUEUE_KEY]: {
        id: queueId,
        stepIndex: stepIndex + 1,
        initialInput,
        queueJobId,
      },
    };

    const debug = process.env.AI_WORKER_QUEUES_DEBUG === '1';
    if (debug) {
      console.log('[Worker] Queue chain dispatching next:', {
        queueId,
        fromStep: stepIndex,
        nextWorkerId: next.workerId,
        delaySeconds: next.delaySeconds,
      });
    }

    await params.ctx.dispatchWorker(next.workerId, nextInputWithQueue, {
      await: false,
      delaySeconds: next.delaySeconds,
      jobId: childJobId,
    });

    return output;
  };
}

export interface SQSMessageBody {
  workerId: string;
  jobId: string;
  input: any;
  context: Record<string, any>;
  webhookUrl?: string;
  /** @deprecated Never use. Job updates use MongoDB only. */
  jobStoreUrl?: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

export interface WebhookPayload {
  jobId: string;
  workerId: string;
  status: 'success' | 'error';
  output?: any;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
  metadata?: Record<string, any>;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

function sanitizeWorkerIdForEnv(workerId: string): string {
  return workerId.replace(/-/g, '_').toUpperCase();
}

function getQueueUrlForWorker(calleeWorkerId: string): string | undefined {
  const key = `WORKER_QUEUE_URL_${sanitizeWorkerIdForEnv(calleeWorkerId)}`;
  return process.env[key]?.trim() || undefined;
}

/**
 * Create dispatchWorker for use in handler context (Lambda).
 * Sends message to SQS, appends to parent internalJobs, optionally polls until child completes.
 */
function createDispatchWorker(
  parentJobId: string,
  parentWorkerId: string,
  parentContext: Record<string, any>,
  jobStore: JobStore | undefined
): (
  workerId: string,
  input: unknown,
  options?: DispatchWorkerOptions
) => Promise<{ jobId: string; messageId?: string; output?: unknown }> {
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

    const messageBody: SQSMessageBody = {
      workerId: calleeWorkerId,
      jobId: childJobId,
      input: input ?? {},
      context: serializedContext,
      webhookUrl: options?.webhookUrl,
      metadata,
      timestamp: new Date().toISOString(),
    };

    const queueUrl = getQueueUrlForWorker(calleeWorkerId);

    if (queueUrl) {
      const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
      const sqs = new SQSClient({ region });
      // SQS message timer (per-message DelaySeconds): message stays invisible for N seconds.
      // Calling worker returns immediately; no computation during delay. See:
      // https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-delay-queues.html
      const delaySeconds =
        options?.await !== true && options?.delaySeconds != null
          ? Math.min(SQS_MAX_DELAY_SECONDS, Math.max(0, Math.floor(options.delaySeconds)))
          : undefined;
      const sendResult = await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(messageBody),
          ...(delaySeconds !== undefined && delaySeconds > 0 ? { DelaySeconds: delaySeconds } : {}),
        })
      );
      const messageId = sendResult.MessageId ?? undefined;

      if (jobStore?.appendInternalJob) {
        await jobStore.appendInternalJob({ jobId: childJobId, workerId: calleeWorkerId });
      }

      if (options?.await && jobStore?.getJob) {
        const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        const pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
        const deadline = Date.now() + pollTimeoutMs;
        while (Date.now() < deadline) {
          const child = await jobStore.getJob(childJobId);
          if (!child) {
            await new Promise((r) => setTimeout(r, pollIntervalMs));
            continue;
          }
          if (child.status === 'completed') {
            return { jobId: childJobId, messageId, output: child.output };
          }
          if (child.status === 'failed') {
            const err = child.error;
            throw new Error(
              err?.message ?? `Child worker ${calleeWorkerId} failed`
            );
          }
          await new Promise((r) => setTimeout(r, pollIntervalMs));
        }
        throw new Error(
          `Child worker ${calleeWorkerId} (${childJobId}) did not complete within ${pollTimeoutMs}ms`
        );
      }

      return { jobId: childJobId, messageId };
    }

    // Fallback: no queue URL (e.g. local dev). Caller (index.ts) should provide in-process dispatch.
    throw new Error(
      `WORKER_QUEUE_URL_${sanitizeWorkerIdForEnv(calleeWorkerId)} is not set. ` +
        'Configure queue URL for worker-to-worker dispatch, or run in local mode.'
    );
  };
}

/**
 * Sends a webhook callback to the specified URL.
 */
async function sendWebhook(
  webhookUrl: string,
  payload: WebhookPayload
): Promise<void> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ai-router-worker/1.0',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('[Worker] Webhook callback failed:', {
        url: webhookUrl,
        status: response.status,
        statusText: response.statusText,
        errorText,
      });
      // Don't throw - webhook failures shouldn't fail the Lambda
    } else {
      console.log('[Worker] Webhook callback successful:', {
        url: webhookUrl,
        status: response.status,
      });
    }
  } catch (error: any) {
    console.error('[Worker] Webhook callback error:', {
      url: webhookUrl,
      error: error?.message || String(error),
      stack: error?.stack,
    });
    // Don't throw - webhook failures shouldn't fail the Lambda
  }
}

/**
 * Creates a Lambda handler function that processes SQS events for workers.
 * Job store: MongoDB only. Never uses HTTP/origin URL for job updates.
 *
 * @param handler - The user's worker handler function
 * @param outputSchema - Optional Zod schema for output validation
 * @returns A Lambda handler function
 */
export function createLambdaHandler<INPUT, OUTPUT>(
  handler: WorkerHandler<INPUT, OUTPUT>,
  outputSchema?: ZodType<OUTPUT>
): (event: SQSEvent, context: LambdaContext) => Promise<void> {
  return async (event: SQSEvent, lambdaContext: LambdaContext) => {
    const promises = event.Records.map(async (record: SQSRecord) => {
      let messageBody: SQSMessageBody | null = null;
      try {
        messageBody = JSON.parse(record.body) as SQSMessageBody;

        const { workerId, jobId, input, context, webhookUrl, metadata = {} } =
          messageBody;

        // Idempotency: skip if this job was already completed or failed (e.g. SQS redelivery or duplicate trigger).
        // Only the Lambda that processes a message creates/updates that job's key; parent workers only append to internalJobs and poll – they never write child job documents.
        const raw = (process.env.WORKER_DATABASE_TYPE || 'upstash-redis').toLowerCase();
        const jobStoreType: 'mongodb' | 'upstash-redis' =
          raw === 'mongodb' ? 'mongodb' : 'upstash-redis';
        if (jobStoreType === 'upstash-redis' && isRedisJobStoreConfigured()) {
          const existing = await loadRedisJob(jobId);
          if (existing && (existing.status === 'completed' || existing.status === 'failed')) {
            console.log('[Worker] Skipping already terminal job (idempotent):', {
              jobId,
              workerId,
              status: existing.status,
            });
            return;
          }
        } else if (jobStoreType === 'mongodb' || isMongoJobStoreConfigured()) {
          const existing = await getMongoJobById(jobId);
          if (existing && (existing.status === 'completed' || existing.status === 'failed')) {
            console.log('[Worker] Skipping already terminal job (idempotent):', {
              jobId,
              workerId,
              status: existing.status,
            });
            return;
          }
        }

        // Select job store and upsert this message's job only (never write child job documents from parent).
        let jobStore: JobStore | undefined;
        if (
          jobStoreType === 'upstash-redis' &&
          isRedisJobStoreConfigured()
        ) {
          await upsertRedisJob(jobId, workerId, input, metadata);
          jobStore = createRedisJobStore(workerId, jobId, input, metadata);
        } else if (
          jobStoreType === 'mongodb' ||
          isMongoJobStoreConfigured()
        ) {
          await upsertJob(jobId, workerId, input, metadata);
          jobStore = createMongoJobStore(workerId, jobId, input, metadata);
        }

        const baseContext = {
          jobId,
          workerId,
          requestId: context.requestId || lambdaContext.awsRequestId,
          ...context,
        };
        const handlerContext = {
          ...baseContext,
          ...(jobStore ? { jobStore } : {}),
          logger: createWorkerLogger(jobId, workerId),
          dispatchWorker: createDispatchWorker(
            jobId,
            workerId,
            baseContext,
            jobStore
          ),
        };

        if (jobStore) {
          try {
            await jobStore.update({ status: 'running' });
            const queueCtxForLog = (input as any)?.__workerQueue ?? metadata?.__workerQueue;
            console.log('[Worker] Job status updated to running:', {
              jobId,
              workerId,
              ...(queueCtxForLog?.id && { queueId: queueCtxForLog.id }),
              ...(queueCtxForLog?.queueJobId && { queueJobId: queueCtxForLog.queueJobId }),
            });
          } catch (error: any) {
            console.warn('[Worker] Failed to update status to running:', {
              jobId,
              workerId,
              error: error?.message || String(error),
            });
          }
        }

        const queueCtx = (input as any)?.__workerQueue ?? metadata?.__workerQueue;
        if (queueCtx?.queueJobId && typeof queueCtx.stepIndex === 'number') {
          // Ensure initial queue job exists (mainly for cron/queue-starter paths)
          if (queueCtx.stepIndex === 0) {
            try {
              await upsertInitialQueueJob({
                queueJobId: queueCtx.queueJobId,
                queueId: queueCtx.id,
                firstWorkerId: workerId,
                firstWorkerJobId: jobId,
                metadata,
              });
            } catch (e: any) {
              console.warn('[Worker] Failed to upsert initial queue job:', {
                queueJobId: queueCtx.queueJobId,
                queueId: queueCtx.id,
                error: e?.message ?? String(e),
              });
            }
          }
          await notifyQueueJobStep(queueCtx.queueJobId, 'start', {
            queueId: queueCtx.id,
            stepIndex: queueCtx.stepIndex,
            workerJobId: jobId,
            workerId,
            input,
          });
        }

        let output: OUTPUT;
        try {
          output = await handler({
            input: input as INPUT,
            ctx: handlerContext,
          });

          if (outputSchema) {
            output = outputSchema.parse(output);
          }
        } catch (error: any) {
          const errorPayload: WebhookPayload = {
            jobId,
            workerId,
            status: 'error',
            error: {
              message: error.message || 'Unknown error',
              stack: error.stack,
              name: error.name || 'Error',
            },
            metadata,
          };

          if (jobStore) {
            try {
              await jobStore.update({
                status: 'failed',
                error: errorPayload.error,
              });
              console.log('[Worker] Job status updated to failed:', {
                jobId,
                workerId,
              });
            } catch (updateError: any) {
              console.warn('[Worker] Failed to update job store on error:', {
                jobId,
                workerId,
                error: updateError?.message || String(updateError),
              });
            }
          }

          const queueCtxFail = (input as any)?.__workerQueue ?? metadata?.__workerQueue;
          if (queueCtxFail?.queueJobId && typeof queueCtxFail.stepIndex === 'number') {
            await notifyQueueJobStep(queueCtxFail.queueJobId, 'fail', {
              queueId: queueCtxFail.id,
              stepIndex: queueCtxFail.stepIndex,
              workerJobId: jobId,
              workerId,
              error: errorPayload.error,
            });
          }

          if (webhookUrl) {
            await sendWebhook(webhookUrl, errorPayload);
          }
          throw error;
        }

        if (jobStore) {
          try {
            await jobStore.update({
              status: 'completed',
              output,
            });
            console.log('[Worker] Job status updated to completed:', {
              jobId,
              workerId,
            });
          } catch (updateError: any) {
            console.warn('[Worker] Failed to update job store on success:', {
              jobId,
              workerId,
              error: updateError?.message || String(updateError),
            });
          }
        }

        // Queue step complete is notified from wrapHandlerForQueue (after append) so one DB update marks step + queue.

        console.log('[Worker] Job completed:', {
          jobId,
          workerId,
          output,
        });

        const successPayload: WebhookPayload = {
          jobId,
          workerId,
          status: 'success',
          output,
          metadata,
        };

        if (webhookUrl) {
          await sendWebhook(webhookUrl, successPayload);
        }
      } catch (error: any) {
        console.error('[Worker] Error processing SQS record:', {
          jobId: messageBody?.jobId ?? '(parse failed)',
          workerId: messageBody?.workerId ?? '(parse failed)',
          error: error?.message || String(error),
          stack: error?.stack,
        });
        throw error;
      }
    });

    await Promise.all(promises);
  };
}
