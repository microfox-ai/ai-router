import type { HitlStepConfig } from './hitlConfig.js';
import type { SmartRetryConfig } from './retryConfig.js';

/**
 * Queue definition and context types for worker queues.
 *
 * ## Human-in-the-loop (HITL) pause / resume
 *
 * **Pause (`awaiting_approval`)** — After a step completes, if the **next** step has
 * `requiresApproval: true`, the runtime calls the step's `chain` function (if any),
 * stores the result as the pending input for that step, marks it `awaiting_approval`,
 * and does **not** dispatch the worker until a human approves.
 *
 * **Resume (`POST .../approve`)** — The app route calls `dispatchWorker` for that step
 * with `__hitlInput` (reviewer form payload) attached. The `wrapHandlerForQueue` runtime
 * calls the step's `resume` function (or merges inputs by default) to produce the final
 * domain input, then strips all envelope keys before the user handler receives it.
 *
 * Workers **do not** need to accept any `__workerQueue` / `__hitlPending` / `__hitlInput`
 * keys in their Zod schemas — the runtime strips them automatically.
 */

/** Output from one completed step, available to subsequent steps via ChainContext / HitlResumeContext. */
export interface QueueStepOutput {
  stepIndex: number;
  workerId: string;
  output: unknown;
}

/**
 * Context passed to a step's {@link WorkerQueueStep.chain} function when the queue
 * advances normally (previous step completed without HITL).
 */
export interface ChainContext {
  /** Original input passed to `dispatchQueue` (the first step's input). */
  initialInput: unknown;
  /**
   * Outputs from all previous steps in order.
   * `previousOutputs[0]` = step 0 output; last entry = most recent.
   */
  previousOutputs: QueueStepOutput[];
}

/**
 * Context passed to a step's {@link WorkerQueueStep.resume} function when a human has
 * approved the HITL pause and the step is being re-dispatched.
 *
 * @template T - Shape of the reviewer / UI form payload.
 *               Derive it from your `hitl.inputSchema` if defined:
 *               `HitlResumeContext<z.infer<typeof reviewerSchema>>`.
 */
export interface HitlResumeContext<T = unknown> {
  /** Original input passed to `dispatchQueue` (the first step's input). */
  initialInput: unknown;
  /**
   * Outputs from all previous steps in order.
   * `previousOutputs[0]` = step 0 output; last entry = most recent.
   */
  previousOutputs: QueueStepOutput[];
  /** Reviewer / UI form payload submitted via `POST .../approve` (`input` body field). */
  reviewerInput: T;
  /**
   * The computed next-step input that was stored pending approval (domain fields only;
   * all `__workerQueue` / `__hitlPending` / `hitl` envelope keys are stripped).
   * This is what the `chain` function produced before the step was paused.
   */
  pendingInput: Record<string, unknown>;
}

/** Internal envelope keys injected by the queue runtime. Never passed to user handlers. */
export const QUEUE_ORCHESTRATION_KEYS = [
  '__workerQueue',
  '__hitlInput',
  '__hitlDecision',
  '__hitlPending',
  'hitl',
] as const;

export interface WorkerQueueStep {
  /** Worker ID for this step. Must match an existing registered worker. */
  workerId: string;
  /**
   * Optional delay (in seconds) before this step is executed.
   * Implemented via SQS DelaySeconds (max 900).
   */
  delaySeconds?: number;
  /**
   * Called when the queue advances to this step after the previous step completes
   * normally (no HITL). Receives a {@link ChainContext} and must return the input
   * object for this worker.
   *
   * **Built-in shortcuts** (use a string instead of a function):
   * - `'passthrough'` — pass the previous step's output directly as this step's input.
   * - `'continueFromPrevious'` — extract `{ current, history }` from the previous
   *   output and build a `{ mode: 'continue', ... }` payload (useful for multi-round sessions).
   *
   * When omitted, the previous step's output is used as-is (equivalent to `'passthrough'`).
   *
   * @example
   * ```ts
   * chain: (ctx) => ({
   *   mode: 'review' as const,
   *   data: ctx.previousOutputs[ctx.previousOutputs.length - 1]?.output,
   * }),
   * ```
   */
  chain?: ((ctx: ChainContext) => unknown) | 'passthrough' | 'continueFromPrevious';
  /**
   * Called when this step resumes after a human approves a HITL pause.
   * Receives a {@link HitlResumeContext} with the reviewer's form payload and the
   * stored pending input, and must return the final domain input for this worker.
   *
   * When omitted, a shallow merge of `pendingInput` + `reviewerInput` is used as the
   * default (suitable for simple cases where reviewer fields override pending fields).
   *
   * @example
   * ```ts
   * resume: (ctx: HitlResumeContext<ReviewerSchema>) => ({
   *   ...ctx.pendingInput,
   *   overriddenField: ctx.reviewerInput.overriddenField,
   * }),
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resume?: (ctx: HitlResumeContext<any>) => unknown;
  /**
   * When `true`, queue execution pauses before dispatching this step.
   * The step waits until a human calls `POST .../approve` (or `POST .../reject`).
   * Define a `resume` function to control how the reviewer's payload is merged with
   * the pending input.
   */
  requiresApproval?: boolean;
  /**
   * Optional HITL UI/metadata for this step (consumed by app UI and tooling).
   * Use {@link defineHitlConfig} for type-safe authoring.
   * The worker runtime uses only `requiresApproval` — this field is UI-only.
   */
  hitl?: HitlStepConfig;
  /**
   * Smart retry configuration for this queue step.
   * Overrides any retry config on the worker definition for this step only.
   * Retries run in-process (same Lambda invocation); ctx.retryContext is populated
   * on each retry so the handler can self-correct (e.g. inject error into prompt).
   *
   * @example
   * ```ts
   * retry: { maxAttempts: 3, on: ['rate-limit', 'json-parse'] }
   * ```
   */
  retry?: SmartRetryConfig;
  /**
   * When defined, evaluated after each run of this step to decide whether to
   * re-run it (another iteration) instead of advancing to the next step.
   *
   * Combine with `requiresApproval: true` for HITL-gated loops where the
   * reviewer's decision (e.g. a `continueLoop` field in their payload)
   * controls whether another round starts.
   *
   * @example
   * ```ts
   * // Loop continues until the worker returns { finalized: true }
   * loop: {
   *   shouldContinue: ({ output }) => !(output as { finalized?: boolean }).finalized,
   *   maxIterations: 20,
   * }
   * ```
   */
  loop?: {
    /** Return true to run this step again; false to advance to the next step. */
    shouldContinue: (ctx: LoopContext) => boolean | Promise<boolean>;
    /**
     * Hard cap on total iterations (including the first run).
     * Prevents runaway loops. Default: 50.
     */
    maxIterations?: number;
  };
}

export interface WorkerQueueConfig<InitialInput = any, StepOutput = any> {
  /** Stable queue identifier, e.g. `"cost-review"`. */
  id: string;
  /** Ordered list of steps forming the queue pipeline. */
  steps: WorkerQueueStep[];
  /**
   * Optional schedule for the queue (cron or rate expression).
   * When set, the CLI generates a queue-starter Lambda triggered by this schedule.
   * @example `'cron(0 3 * * ? *)'` — daily at 03:00 UTC.
   */
  schedule?: string | { rate: string; enabled?: boolean; input?: Record<string, any> };
  // Reserved phantom types for IDE hints — do not affect runtime.
  _initialInputType?: InitialInput;
  _stepOutputType?: StepOutput;
}

/**
 * Context passed to a step's {@link WorkerQueueStep.loop | loop.shouldContinue} function
 * after each iteration of a looping step.
 */
export interface LoopContext {
  /** Output returned by the worker for this iteration. */
  output: unknown;
  /** Step definition index (stable; does not change across iterations). */
  stepIndex: number;
  /** 0-based count of how many times this step has already run (0 = first run). */
  iterationCount: number;
  /** Original input passed to `dispatchQueue`. */
  initialInput: unknown;
  /** Outputs from all previous steps (and previous iterations of this step). */
  previousOutputs: QueueStepOutput[];
}

/**
 * Queue execution context embedded into job input so queue-aware wrappers
 * know their position in the pipeline. Injected automatically by the runtime.
 */
export interface WorkerQueueContext<InitialInput = any> {
  id: string;
  /** Queue definition step index — used to look up chain/resume/loop config. Stays fixed across loop iterations. */
  stepIndex: number;
  /**
   * Actual array position of this step in the job's steps[] store.
   * Differs from stepIndex when the same step has looped multiple times
   * (each iteration is appended as a new entry). Defaults to stepIndex when absent.
   */
  arrayStepIndex?: number;
  initialInput: InitialInput;
  /** Queue job ID for progress tracking (same as first worker's jobId). */
  queueJobId?: string;
  /** How many times this step has already run (used by looping steps). */
  iterationCount?: number;
}

/**
 * Repeat a step definition `count` times, calling `factory(index)` for each repetition.
 * Eliminates copy-paste for multi-round HITL workflows.
 *
 * @example
 * ```ts
 * const queue = defineWorkerQueue({
 *   id: 'multi-review',
 *   steps: [
 *     { workerId: 'ingest' },
 *     ...repeatStep(3, (i) => ({
 *       workerId: 'review',
 *       chain: chainFromPrev,
 *       resume: resumeFromHitl,
 *       requiresApproval: true,
 *       hitl: defineHitlConfig({ taskKey: `review-r${i + 1}`, ui: { type: 'schema-form', title: `Round ${i + 1}` } }),
 *     })),
 *   ],
 * });
 * ```
 */
export function repeatStep(
  count: number,
  factory: (index: number) => WorkerQueueStep
): WorkerQueueStep[] {
  return Array.from({ length: count }, (_, i) => factory(i));
}

/**
 * Identity helper for defining worker queues in `.queue.ts` files.
 * Use `satisfies WorkerQueueConfig<InitialInput, StepOutput>` for phantom-type docs.
 *
 * @example
 * ```ts
 * const q = defineWorkerQueue({
 *   id: 'my-queue',
 *   steps: [ ... ],
 * }) satisfies WorkerQueueConfig<MyInit, MyOutput>;
 * export default q;
 * ```
 */
export function defineWorkerQueue<T extends WorkerQueueConfig>(config: T): T {
  return config;
}
