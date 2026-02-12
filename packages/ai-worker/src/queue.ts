/**
 * Queue definition and context types for worker queues.
 *
 * These types are used at code-time by .queue.ts files and at runtime
 * by the client and generated registry/queue wrappers.
 */

export interface WorkerQueueStep {
  /** Worker ID for this step. Must match an existing worker id. */
  workerId: string;
  /**
   * Optional delay (in seconds) before this step is executed.
   * Implemented via SQS DelaySeconds (0–900).
   */
  delaySeconds?: number;
  /**
   * Optional name of a mapping function exported from the .queue.ts file
   * that derives this step's input from the previous step's output and
   * the original initial input.
   */
  mapInputFromPrev?: string;
}

export interface WorkerQueueConfig<InitialInput = any, StepOutput = any> {
  /** Stable queue identifier, e.g. "cost-usage". */
  id: string;
  /** Ordered list of workers forming the queue. */
  steps: WorkerQueueStep[];
  /**
   * Optional schedule for the queue (cron or rate).
   * When set, the CLI generates a queue-starter Lambda triggered by this schedule.
   * Example: 'cron(0 3 * * ? *)' for daily at 03:00 UTC.
   */
  schedule?: string | { rate: string; enabled?: boolean; input?: Record<string, any> };
  // The generic parameters are reserved for future typing improvements and
  // are intentionally unused here (config is structural at runtime).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _initialInputType?: InitialInput;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _stepOutputType?: StepOutput;
}

/**
 * Queue execution context that is embedded into job input/metadata so
 * queue-aware wrappers can determine where they are in the queue.
 */
export interface WorkerQueueContext<InitialInput = any> {
  id: string;
  stepIndex: number;
  initialInput: InitialInput;
  /** Queue job ID (same as first worker's jobId) for tracking progress. */
  queueJobId?: string;
}

/**
 * Identity helper for defining worker queues in .queue.ts files.
 * This is primarily for type safety and CLI discovery.
 */
export function defineWorkerQueue<T extends WorkerQueueConfig>(config: T): T {
  return config;
}

