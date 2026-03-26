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
import type { WorkerQueueContext, ChainContext, HitlResumeContext, QueueStepOutput, LoopContext } from './queue';
import { QUEUE_ORCHESTRATION_KEYS } from './queue';
import { type SmartRetryConfig, type RetryContext, executeWithRetry, matchesRetryPattern } from './retryConfig.js';
import { type TokenUsage, TokenBudgetExceededError, createTokenTracker } from './tokenBudget.js';

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
  userId?: string;
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
    /** ID of the user who triggered this job. Pass via DispatchOptions.userId from your API route. */
    userId?: string;
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
    /**
     * Report token usage after an LLM call. Accumulates across all calls in this job.
     * Throws TokenBudgetExceededError if the configured maxTokens budget is exceeded.
     * Also persists usage to the job store for observability.
     *
     * @example
     * ```ts
     * const result = await anthropic.messages.create({ ... });
     * await ctx.reportTokenUsage({
     *   inputTokens: result.usage.input_tokens,
     *   outputTokens: result.usage.output_tokens,
     * });
     * ```
     */
    reportTokenUsage: (usage: TokenUsage) => Promise<void>;
    /**
     * Get the current token usage and remaining budget for this job.
     * Returns `{ used, budget: null, remaining: null }` when no maxTokens was set.
     */
    getTokenBudget: () => { used: number; budget: number | null; remaining: number | null };
    /**
     * Populated on retry attempts (attempt >= 2). Contains info about the previous failure
     * so the handler can self-correct (e.g. inject the error message into the next prompt).
     * `undefined` on the first attempt — use `if (ctx.retryContext)` to detect retries.
     */
    retryContext?: RetryContext;
    [key: string]: any;
  };
}

// Re-export retry and token types so consumers can import from '@microfox/ai-worker'
export type { SmartRetryConfig, RetryContext, BuiltInRetryPattern, CustomRetryPattern, RetryPattern } from './retryConfig.js';
export type { TokenUsage, TokenBudgetState } from './tokenBudget.js';
export { TokenBudgetExceededError } from './tokenBudget.js';

export type WorkerHandler<INPUT, OUTPUT> = (
  params: WorkerHandlerParams<INPUT, OUTPUT>
) => Promise<OUTPUT>;

/** Result of getNextStep for queue chaining. */
export interface QueueNextStep {
  workerId: string;
  delaySeconds?: number;
  requiresApproval?: boolean;
  /** Whether this step has a `chain` function (or built-in string) defined. */
  hasChain?: boolean;
  /** Whether this step has a `resume` function defined. */
  hasResume?: boolean;
  /** Optional HITL metadata from queue step config (UI/tooling only). */
  hitl?: { ui?: unknown } | unknown;
  /** Smart retry config for this step. Overrides worker-level retry for this step only. */
  retry?: SmartRetryConfig;
}

// QueueStepOutput, ChainContext, HitlResumeContext are imported from './queue'
// and re-exported via index.ts. No local definitions needed.

/**
 * @deprecated Use {@link ChainContext} for the normal chain path and
 * {@link HitlResumeContext} for the HITL resume path instead.
 * Kept for backwards compatibility with queue files written against the old API.
 */
export interface MapStepInputContext {
  initialInput: unknown;
  previousOutputs: QueueStepOutput[];
  /** @deprecated Use HitlResumeContext.reviewerInput instead. */
  hitlInput?: unknown;
  /** @deprecated Use HitlResumeContext.pendingInput instead. */
  pendingStepInput?: Record<string, unknown>;
}

// Re-export new types so consumers can import from '@microfox/ai-worker/handler'
export type { ChainContext, HitlResumeContext, QueueStepOutput, LoopContext } from './queue';

/** Runtime helpers for queue-aware wrappers (provided by generated registry). */
export interface QueueRuntime {
  getNextStep(queueId: string, stepIndex: number): QueueNextStep | undefined;
  /** Step config at `stepIndex`. */
  getStepAt?(queueId: string, stepIndex: number): QueueNextStep | undefined;
  /** Optional: when provided, mappers can use outputs from any previous step. */
  getQueueJob?(queueJobId: string): Promise<{ steps: Array<{ workerId: string; output?: unknown }> } | null>;
  /**
   * Build the input for a step when the queue advances normally (no HITL resume).
   * Calls the step's `chain` function, or the built-in passthrough/continueFromPrevious.
   */
  invokeChain?(queueId: string, stepIndex: number, ctx: ChainContext): Promise<unknown> | unknown;
  /**
   * Build the domain input for a step when it resumes after HITL approval.
   * Calls the step's `resume` function, or merges pendingInput + reviewerInput by default.
   */
  invokeResume?(queueId: string, stepIndex: number, ctx: HitlResumeContext): Promise<unknown> | unknown;
  /**
   * Evaluate whether a looping step should run again.
   * Calls the step's `loop.shouldContinue` function. Returns false if none defined.
   */
  invokeLoop?(queueId: string, stepIndex: number, ctx: LoopContext): Promise<boolean> | boolean;
}

const WORKER_QUEUE_KEY = '__workerQueue';

/** Build previous step outputs when resuming step `stepIndex` (excludes step `stepIndex` itself). */
async function loadPreviousOutputsBeforeStep(
  queueRuntime: QueueRuntime,
  queueJobId: string | undefined,
  beforeStepIndex: number
): Promise<QueueStepOutput[]> {
  if (!queueJobId || typeof queueRuntime.getQueueJob !== 'function') {
    return [];
  }
  try {
    const job = await queueRuntime.getQueueJob(queueJobId);
    if (!job?.steps) return [];
    return job.steps
      .slice(0, beforeStepIndex)
      .map((s, i) => ({ stepIndex: i, workerId: s.workerId, output: s.output }));
  } catch (e: any) {
    if (process.env.AI_WORKER_QUEUES_DEBUG === '1') {
      console.warn('[Worker] getQueueJob failed (resume mapping):', e?.message ?? e);
    }
    return [];
  }
}

/**
 * When POST /approve forwards `__hitlInput`, call the step's `resume` function
 * (via `queueRuntime.invokeResume`) to merge reviewer payload with the pending
 * domain input. Runs before the user handler so it receives clean merged input.
 */
async function maybeApplyHitlResumeMapper<INPUT, OUTPUT>(
  params: WorkerHandlerParams<INPUT, OUTPUT>,
  queueRuntime: QueueRuntime
): Promise<void> {
  const inputObj = params.input as Record<string, unknown> | null;
  if (!inputObj || typeof inputObj !== 'object') return;
  if (!('__hitlInput' in inputObj)) return;

  const wq = inputObj[WORKER_QUEUE_KEY] as WorkerQueueContext | undefined;
  if (!wq?.id || typeof wq.stepIndex !== 'number') return;

  const queueId = wq.id;
  const stepIndex = wq.stepIndex;
  const initialInput = wq.initialInput;
  const queueJobId = wq.queueJobId;
  const previousOutputs = await loadPreviousOutputsBeforeStep(queueRuntime, queueJobId, stepIndex);

  // Build pending domain input — strip all envelope keys.
  const pendingInput: Record<string, unknown> = { ...inputObj };
  for (const key of QUEUE_ORCHESTRATION_KEYS) {
    delete pendingInput[key];
  }
  delete pendingInput[WORKER_QUEUE_KEY];

  const reviewerInput = inputObj.__hitlInput;
  const decision = inputObj.__hitlDecision;

  let merged: unknown;
  if (typeof queueRuntime.invokeResume === 'function') {
    merged = await queueRuntime.invokeResume(queueId, stepIndex, {
      initialInput,
      previousOutputs,
      reviewerInput,
      pendingInput,
    });
  } else {
    // Default: shallow merge pendingInput + reviewerInput.
    merged = {
      ...pendingInput,
      ...(reviewerInput !== null && typeof reviewerInput === 'object'
        ? (reviewerInput as Record<string, unknown>)
        : {}),
    };
  }

  const mergedObj =
    merged !== null && typeof merged === 'object'
      ? (merged as Record<string, unknown>)
      : { value: merged };

  (params as { input: INPUT }).input = {
    ...mergedObj,
    [WORKER_QUEUE_KEY]: wq,
    ...(decision !== undefined ? { __hitlDecision: decision } : {}),
  } as INPUT;
}

/** Read embedded queue context from job input or metadata without `as any`. */
function getWorkerQueueContext(
  input: unknown,
  metadata?: Record<string, unknown>
): WorkerQueueContext | undefined {
  const fromInput =
    input !== null && typeof input === 'object' && WORKER_QUEUE_KEY in input
      ? (input as Record<string, unknown>)[WORKER_QUEUE_KEY]
      : undefined;
  const fromMeta =
    metadata !== undefined && typeof metadata === 'object' && WORKER_QUEUE_KEY in metadata
      ? (metadata as Record<string, unknown>)[WORKER_QUEUE_KEY]
      : undefined;
  const q = fromInput ?? fromMeta;
  if (q === null || typeof q !== 'object') return undefined;
  return q as WorkerQueueContext;
}

async function notifyQueueJobStep(
  queueJobId: string,
  action: 'start' | 'awaiting_approval' | 'complete' | 'fail' | 'append',
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
        : action === 'awaiting_approval'
          ? 'awaiting_approval'
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
    // Append must succeed before we can complete the current step with a "next" step;
    // otherwise step 0 complete + only 1 row in store marks the whole queue completed.
    if (action === 'append') {
      console.error('[Worker] Queue append failed (rethrowing):', {
        queueJobId,
        error: err?.message ?? String(err),
      });
      throw err;
    }
    console.warn('[Worker] Queue job update error:', {
      queueJobId,
      action,
      error: err?.message ?? String(err),
    });
  }
}

/**
 * Wraps a user handler so that when the job has `__workerQueue` context (from
 * `dispatchQueue` or queue cron), it dispatches the next worker in the sequence
 * **after** the handler completes.
 *
 * All queue/HITL envelope keys (`__workerQueue`, `__hitlInput`, `__hitlDecision`,
 * `__hitlPending`, `hitl`) are **stripped from `params.input` before the user handler
 * runs** — workers receive clean domain input and do not need to accept these keys
 * in their Zod schemas.
 *
 * **HITL resume:** When `__hitlInput` is present, `invokeResume` is called first to
 * produce the merged domain input. **Chain advancement:** After a step completes,
 * `invokeChain` is called to compute the next step's input.
 */
export function wrapHandlerForQueue<INPUT, OUTPUT>(
  handler: WorkerHandler<INPUT, OUTPUT>,
  queueRuntime: QueueRuntime
): WorkerHandler<INPUT, OUTPUT> {
  return async (params) => {
    // 1. On HITL resume, merge reviewer payload into domain input first.
    await maybeApplyHitlResumeMapper(params, queueRuntime);

    const inputObj =
      params.input !== null && typeof params.input === 'object'
        ? (params.input as Record<string, unknown>)
        : {};

    // 2. Save queue context before stripping (needed for chain dispatch after handler).
    const queueContextRaw = inputObj[WORKER_QUEUE_KEY];

    // Resolve step-level retry config before stripping (uses queueId + stepIndex from envelope).
    const queueCtxForRetry =
      queueContextRaw && typeof queueContextRaw === 'object'
        ? (queueContextRaw as WorkerQueueContext)
        : undefined;
    const stepRetryConfig: SmartRetryConfig | undefined =
      queueCtxForRetry?.id && typeof queueCtxForRetry.stepIndex === 'number' &&
      typeof queueRuntime.getStepAt === 'function'
        ? (queueRuntime.getStepAt(queueCtxForRetry.id, queueCtxForRetry.stepIndex) as any)?.retry
        : undefined;

    // 3. Strip all orchestration keys so the user handler sees only domain input.
    const domainInput: Record<string, unknown> = { ...inputObj };
    for (const key of QUEUE_ORCHESTRATION_KEYS) {
      delete domainInput[key];
    }
    delete domainInput[WORKER_QUEUE_KEY];
    (params as { input: unknown }).input = domainInput;

    // 4. Run user handler with clean domain input (with optional step-level retry).
    let output: OUTPUT;
    if (stepRetryConfig && stepRetryConfig.on.length > 0) {
      output = await executeWithRetry(
        async (retryCtx) => {
          (params.ctx as any).retryContext = retryCtx;
          return handler(params);
        },
        stepRetryConfig,
        (retryCtx, delayMs) => {
          const logger = (params.ctx as any).logger;
          if (logger?.warn) {
            logger.warn(
              `[queue-retry] Retrying step (attempt ${retryCtx.attempt}/${retryCtx.maxAttempts}): ${retryCtx.lastError.message}`,
              { delayMs }
            );
          } else {
            console.warn('[queue-retry] Step retry', { attempt: retryCtx.attempt, error: retryCtx.lastError.message, delayMs });
          }
        }
      );
    } else {
      output = await handler(params);
    }

    if (!queueContextRaw || typeof queueContextRaw !== 'object') {
      return output;
    }
    const queueContext = queueContextRaw as WorkerQueueContext;
    if (!queueContext.id) {
      return output;
    }

    const { id: queueId, stepIndex, initialInput, queueJobId } = queueContext;
    // arrayStepIndex tracks the actual steps[] position — differs from stepIndex for loop iterations.
    const arrayStepIndex = (queueContext as WorkerQueueContext).arrayStepIndex ?? stepIndex;
    const jobId = params.ctx.jobId;
    const workerId = params.ctx.workerId ?? '';

    const next = queueRuntime.getNextStep(queueId, stepIndex);
    const childJobId = next ? `job-${Date.now()}-${Math.random().toString(36).slice(2, 11)}` : undefined;

    // 5a. Check loop BEFORE appending next step or marking current complete.
    // This fixes two bugs in the original ordering:
    //   1. Premature queue completion: if this is the last step and the loop fires,
    //      marking complete before appending the loop step closes the queue early.
    //   2. Double-append: if there IS a next step and the loop fires, both the next step
    //      and the loop step get appended, orphaning the next step.
    const iterationCount = (queueContext as WorkerQueueContext).iterationCount ?? 0;
    if (typeof queueRuntime.invokeLoop === 'function') {
      const currentStep = typeof queueRuntime.getStepAt === 'function'
        ? queueRuntime.getStepAt(queueId, stepIndex)
        : undefined;
      const maxIterations = (currentStep as any)?.loop?.maxIterations ?? 50;
      if (iterationCount < maxIterations - 1) {
        let previousOutputsForLoop: QueueStepOutput[] = [];
        // Capture steps.length before appending so we know the array index of the
        // new loop step (used for awaiting_approval and as arrayStepIndex next iteration).
        let stepsLengthBeforeAppend = arrayStepIndex + 1; // fallback
        if (queueJobId && typeof queueRuntime.getQueueJob === 'function') {
          try {
            const job = await queueRuntime.getQueueJob(queueJobId);
            if (job?.steps) {
              previousOutputsForLoop = job.steps
                .slice(0, stepIndex)
                .map((s, i) => ({ stepIndex: i, workerId: s.workerId, output: s.output }));
              stepsLengthBeforeAppend = job.steps.length;
            }
          } catch { /* ignore */ }
        }
        previousOutputsForLoop = previousOutputsForLoop.concat([{ stepIndex, workerId, output }]);

        const shouldLoop = await queueRuntime.invokeLoop(queueId, stepIndex, {
          output,
          stepIndex,
          iterationCount,
          initialInput,
          previousOutputs: previousOutputsForLoop,
        });

        if (shouldLoop) {
          const loopJobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
          // Build loop-iteration input via chain (same step, re-mapped from current output).
          let loopInput: unknown = output;
          if (typeof queueRuntime.invokeChain === 'function') {
            loopInput = await queueRuntime.invokeChain(queueId, stepIndex, {
              initialInput,
              previousOutputs: previousOutputsForLoop,
            });
          }
          const loopInputWithQueue = {
            ...(loopInput !== null && typeof loopInput === 'object'
              ? (loopInput as Record<string, unknown>)
              : { value: loopInput }),
            [WORKER_QUEUE_KEY]: {
              id: queueId,
              stepIndex,                           // definition index stays fixed
              arrayStepIndex: stepsLengthBeforeAppend, // actual index for next iteration
              initialInput,
              queueJobId,
              iterationCount: iterationCount + 1,
            },
          };

          // Append loop step FIRST so mark-complete sees it — keeps queue running.
          if (queueJobId) {
            await notifyQueueJobStep(queueJobId, 'append', { workerJobId: loopJobId, workerId });
          }
          // Now mark current step complete using its actual array index.
          if (queueJobId && typeof arrayStepIndex === 'number') {
            await notifyQueueJobStep(queueJobId, 'complete', {
              queueId,
              stepIndex: arrayStepIndex,
              workerJobId: jobId,
              workerId,
              output,
            });
          }

          if (currentStep?.requiresApproval && queueJobId) {
            const hitlUiSpec =
              currentStep.hitl && typeof currentStep.hitl === 'object' && 'ui' in (currentStep.hitl as Record<string, unknown>)
                ? (currentStep.hitl as Record<string, unknown>).ui
                : undefined;
            const pendingInput = {
              ...loopInputWithQueue,
              ...(hitlUiSpec !== undefined ? { hitl: { uiSpec: hitlUiSpec } } : {}),
              __hitlPending: {
                queueId,
                queueJobId,
                stepIndex,
                workerId,
                createdAt: new Date().toISOString(),
              },
            };
            // Use stepsLengthBeforeAppend as the array index of the just-appended loop step.
            await notifyQueueJobStep(queueJobId, 'awaiting_approval', {
              queueId,
              stepIndex: stepsLengthBeforeAppend,
              workerJobId: loopJobId,
              workerId,
              input: pendingInput,
            });
            return output;
          }

          await params.ctx.dispatchWorker(workerId, loopInputWithQueue, {
            await: false,
            jobId: loopJobId,
          });
          return output;
        }
      }
    }

    // No loop fired — normal advance: append next step first, then mark current complete.
    if (next && queueJobId) {
      // Append next step first so complete-step update sees steps.length > 1 (queue not yet done).
      await notifyQueueJobStep(queueJobId, 'append', {
        workerJobId: childJobId!,
        workerId: next.workerId,
      });
    }

    // Notify current step complete using its actual array index.
    if (queueJobId && typeof arrayStepIndex === 'number') {
      await notifyQueueJobStep(queueJobId, 'complete', {
        queueId,
        stepIndex: arrayStepIndex,
        workerJobId: jobId,
        workerId,
        output,
      });
    }

    if (!next) {
      return output;
    }

    // 5c. Build next step input via invokeChain (uses the step's chain fn or built-in).
    let nextInput: unknown = output;
    if (typeof queueRuntime.invokeChain === 'function') {
      let previousOutputs: QueueStepOutput[] = [];
      if (queueJobId && typeof queueRuntime.getQueueJob === 'function') {
        try {
          const job = await queueRuntime.getQueueJob(queueJobId);
          if (job?.steps) {
            const fromStore = job.steps
              .slice(0, stepIndex)
              .map((s, i) => ({ stepIndex: i, workerId: s.workerId, output: s.output }));
            previousOutputs = fromStore.concat([
              { stepIndex, workerId: params.ctx.workerId ?? '', output },
            ]);
          }
        } catch (e: any) {
          if (process.env.AI_WORKER_QUEUES_DEBUG === '1') {
            console.warn('[Worker] getQueueJob failed, mapping without previousOutputs:', e?.message ?? e);
          }
        }
      }
      nextInput = await queueRuntime.invokeChain(queueId, stepIndex + 1, {
        initialInput,
        previousOutputs,
      });
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

    if (next.requiresApproval && queueJobId && typeof stepIndex === 'number') {
      const hitlUiSpec =
        next.hitl && typeof next.hitl === 'object' && 'ui' in (next.hitl as Record<string, unknown>)
          ? (next.hitl as Record<string, unknown>).ui
          : undefined;
      const pendingInput = {
        ...nextInputWithQueue,
        ...(hitlUiSpec !== undefined ? { hitl: { uiSpec: hitlUiSpec } } : {}),
        __hitlPending: {
          queueId,
          queueJobId,
          stepIndex: stepIndex + 1,
          workerId: next.workerId,
          createdAt: new Date().toISOString(),
        },
      };
      await notifyQueueJobStep(queueJobId, 'awaiting_approval', {
        queueId,
        stepIndex: stepIndex + 1,
        workerJobId: childJobId!,
        workerId: next.workerId,
        input: pendingInput,
      });
      if (debug) {
        console.log('[Worker] Queue chain paused for HITL approval:', {
          queueId,
          queueJobId,
          nextStep: stepIndex + 1,
          nextWorkerId: next.workerId,
          pendingWorkerJobId: childJobId,
        });
      }
      return output;
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
  /** ID of the user who triggered this job. Forwarded from dispatch options. */
  userId?: string;
  /** Maximum total tokens (input + output) for this job. Forwarded from DispatchOptions.maxTokens. */
  maxTokens?: number;
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
    if (parentContext.userId) serializedContext.userId = parentContext.userId;

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
  outputSchema?: ZodType<OUTPUT>,
  options?: { retry?: SmartRetryConfig }
): (event: SQSEvent, context: LambdaContext) => Promise<void> {
  return async (event: SQSEvent, lambdaContext: LambdaContext) => {
    const promises = event.Records.map(async (record: SQSRecord) => {
      let messageBody: SQSMessageBody | null = null;
      try {
        messageBody = JSON.parse(record.body) as SQSMessageBody;

        const { workerId, jobId, input, context, webhookUrl, metadata = {}, userId: messageUserId, maxTokens } =
          messageBody;
        // userId flows from dispatch options → context.userId → messageBody.userId
        const userId: string | undefined = (context.userId as string | undefined) ?? messageUserId;

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
          await upsertRedisJob(jobId, workerId, input, metadata, userId);
          jobStore = createRedisJobStore(workerId, jobId, input, metadata, userId);
        } else if (
          jobStoreType === 'mongodb' ||
          isMongoJobStoreConfigured()
        ) {
          await upsertJob(jobId, workerId, input, metadata, userId);
          jobStore = createMongoJobStore(workerId, jobId, input, metadata, userId);
        }

        // Emit a parseable audit log so log queries can find all jobs by user.
        // Pattern: [WORKER_USER:<userId>] — grep for this to extract caller userId.
        if (userId) {
          console.log(`[WORKER_USER:${userId}]`, { jobId, workerId, timestamp: new Date().toISOString() });
        }

        const baseContext = {
          jobId,
          workerId,
          requestId: context.requestId || lambdaContext.awsRequestId,
          ...(userId ? { userId } : {}),
          ...context,
        };

        // Token budget tracker — enforces maxTokens if set, accumulates otherwise.
        const tokenTracker = createTokenTracker(maxTokens ?? null);
        const logger = createWorkerLogger(jobId, workerId);

        const handlerContext: any = {
          ...baseContext,
          ...(jobStore ? { jobStore } : {}),
          logger,
          dispatchWorker: createDispatchWorker(jobId, workerId, baseContext, jobStore),
          reportTokenUsage: async (usage: TokenUsage) => {
            tokenTracker.report(usage); // throws TokenBudgetExceededError if over limit
            const state = tokenTracker.getState();
            if (jobStore) {
              await jobStore.update({ metadata: { tokenUsage: state } }).catch((e: any) => {
                logger.warn('Failed to persist tokenUsage to job store', { error: e?.message });
              });
            }
          },
          getTokenBudget: () => tokenTracker.getBudgetInfo(),
          retryContext: undefined as RetryContext | undefined,
        };

        if (jobStore) {
          try {
            await jobStore.update({ status: 'running' });
            const queueCtxForLog = getWorkerQueueContext(input, metadata);
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

        const queueCtx = getWorkerQueueContext(input, metadata);
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
                userId,
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
            // Use arrayStepIndex when set — it tracks the actual steps[] position for
            // looping steps where the definition index stays fixed across iterations.
            stepIndex: queueCtx.arrayStepIndex ?? queueCtx.stepIndex,
            workerJobId: jobId,
            workerId,
            input,
          });
        }

        let output: OUTPUT;
        try {
          const workerRetryConfig = options?.retry;
          const executeHandler = async (retryCtx: RetryContext | undefined): Promise<OUTPUT> => {
            handlerContext.retryContext = retryCtx;
            const result = await handler({ input: input as INPUT, ctx: handlerContext });
            return outputSchema ? outputSchema.parse(result) : result;
          };

          if (workerRetryConfig && workerRetryConfig.on.length > 0) {
            output = await executeWithRetry(executeHandler, workerRetryConfig, (retryCtx, delayMs) => {
              logger.warn(
                `[worker-retry] Retrying handler (attempt ${retryCtx.attempt}/${retryCtx.maxAttempts}): ${retryCtx.lastError.message}`,
                { delayMs }
              );
            });
          } else {
            output = await executeHandler(undefined);
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

          const queueCtxFail = getWorkerQueueContext(input, metadata);
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
