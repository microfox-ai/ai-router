/**
 * Client for dispatching background worker jobs.
 *
 * In production, dispatching happens via the workers HTTP API:
 *   POST /workers/trigger  -> enqueues message to SQS on the workers service side
 *
 * This avoids requiring AWS credentials in your Next.js app.
 */

import type { ZodType, z } from 'zod';
import type { WorkerQueueConfig, WorkerQueueContext } from './queue.js';

export interface WorkerQueueRegistry {
  getQueueById(queueId: string): WorkerQueueConfig | undefined;
  invokeMapInput?: (
    queueId: string,
    stepIndex: number,
    prevOutput: unknown,
    initialInput: unknown
  ) => Promise<unknown> | unknown;
}

export interface DispatchOptions {
  /**
   * Optional webhook callback URL to notify when the job finishes.
   * Only called when provided. Default: no webhook (use job store / MongoDB only).
   */
  webhookUrl?: string;
  /**
   * Controls how dispatch executes.
   * - "auto" (default): local inline execution in development unless WORKERS_LOCAL_MODE=false.
   * - "local": force inline execution (no SQS).
   * - "remote": force SQS/Lambda dispatch even in development.
   */
  mode?: 'auto' | 'local' | 'remote';
  jobId?: string;
  metadata?: Record<string, any>;
  /**
   * In-memory queue registry for dispatchQueue. Required when using dispatchQueue.
   * Pass a registry that imports from your .queue.ts definitions (works on Vercel/serverless).
   */
  registry?: WorkerQueueRegistry;
  /**
   * Optional callback to create a queue job record before dispatching.
   * Called with queueJobId (= first worker's jobId), queueId, and firstStep.
   */
  onCreateQueueJob?: (params: {
    queueJobId: string;
    queueId: string;
    firstStep: { workerId: string; workerJobId: string };
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
}

export interface DispatchResult {
  messageId: string;
  status: 'queued';
  jobId: string;
}

export interface DispatchQueueResult extends DispatchResult {
  queueId: string;
}

export interface SerializedContext {
  requestId?: string;
  userId?: string;
  traceId?: string;
  [key: string]: any;
}

/**
 * Derives the full /workers/trigger URL from env.
 * Exported for use by local dispatchWorker (worker-to-worker in dev).
 *
 * Preferred env vars:
 * - WORKER_BASE_URL: base URL of the workers service (e.g. https://.../prod)
 * - NEXT_PUBLIC_WORKER_BASE_URL: same, but exposed to the browser
 *
 * Legacy env vars (still supported for backwards compatibility):
 * - WORKERS_TRIGGER_API_URL / NEXT_PUBLIC_WORKERS_TRIGGER_API_URL
 * - WORKERS_CONFIG_API_URL / NEXT_PUBLIC_WORKERS_CONFIG_API_URL
 */
export function getWorkersTriggerUrl(): string {
  const raw =
    process.env.WORKER_BASE_URL ||
    process.env.NEXT_PUBLIC_WORKER_BASE_URL ||
    process.env.WORKERS_TRIGGER_API_URL ||
    process.env.NEXT_PUBLIC_WORKERS_TRIGGER_API_URL ||
    process.env.WORKERS_CONFIG_API_URL ||
    process.env.NEXT_PUBLIC_WORKERS_CONFIG_API_URL;

  if (!raw) {
    throw new Error(
      'WORKER_BASE_URL (preferred) or NEXT_PUBLIC_WORKER_BASE_URL is required for background workers'
    );
  }

  const url = new URL(raw);
  url.search = '';
  url.hash = '';

  const path = url.pathname || '';

  // If the user pointed at a specific endpoint, normalize back to the service root.
  url.pathname = path.replace(/\/?workers\/(trigger|config)\/?$/, '');

  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}/workers/trigger`.replace(/\/+$/, '');

  return url.toString();
}

/**
 * Serializes context data for transmission to Lambda.
 * Only serializes safe, JSON-compatible properties.
 */
function serializeContext(ctx: any): SerializedContext {
  const serialized: SerializedContext = {};

  if (ctx.requestId) {
    serialized.requestId = ctx.requestId;
  }

  // Extract any additional serializable metadata
  if (ctx.metadata && typeof ctx.metadata === 'object') {
    Object.assign(serialized, ctx.metadata);
  }

  // Allow custom context serialization via a helper property
  if (ctx._serializeContext && typeof ctx._serializeContext === 'function') {
    const custom = ctx._serializeContext();
    Object.assign(serialized, custom);
  }

  return serialized;
}


/**
 * Dispatches a background worker job to SQS.
 *
 * @param workerId - The ID of the worker to dispatch
 * @param input - The input data for the worker (will be validated against inputSchema)
 * @param inputSchema - Zod schema for input validation
 * @param options - Dispatch options including webhook URL
 * @param ctx - Optional context object (only serializable parts will be sent)
 * @returns Promise resolving to dispatch result with messageId and jobId
 */
export async function dispatch<INPUT_SCHEMA extends ZodType<any>>(
  workerId: string,
  input: z.input<INPUT_SCHEMA>,
  inputSchema: INPUT_SCHEMA,
  options: DispatchOptions,
  ctx?: any
): Promise<DispatchResult> {
  // Validate input against schema
  const validatedInput = inputSchema.parse(input);

  // Generate job ID if not provided
  const jobId =
    options.jobId || `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Resolve /workers/trigger endpoint URL
  const triggerUrl = getWorkersTriggerUrl();

  // Serialize context (only safe, JSON-compatible parts)
  const serializedContext = ctx ? serializeContext(ctx) : {};

  // Job updates use MongoDB only; never pass jobStoreUrl/origin URL.
  const messageBody = {
    workerId,
    jobId,
    input: validatedInput,
    context: serializedContext,
    webhookUrl: options.webhookUrl,
    metadata: options.metadata || {},
    timestamp: new Date().toISOString(),
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const triggerKey = process.env.WORKERS_TRIGGER_API_KEY;
  if (triggerKey) {
    headers['x-workers-trigger-key'] = triggerKey;
  }

  const response = await fetch(triggerUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      workerId,
      body: messageBody,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Failed to trigger worker "${workerId}": ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`
    );
  }

  const data = (await response.json().catch(() => ({}))) as any;
  const messageId = data?.messageId ? String(data.messageId) : `trigger-${jobId}`;

  return {
    messageId,
    status: 'queued',
    jobId,
  };
}

/**
 * Local development mode: runs the handler immediately in the same process.
 * This bypasses SQS and Lambda for faster iteration during development.
 *
 * @param handler - The worker handler function
 * @param input - The input data
 * @param ctx - The context object
 * @returns The handler result
 */
export async function dispatchLocal<INPUT, OUTPUT>(
  handler: (params: { input: INPUT; ctx: any }) => Promise<OUTPUT>,
  input: INPUT,
  ctx?: any
): Promise<OUTPUT> {
  return handler({ input, ctx: ctx || {} });
}

/**
 * Dispatches a queue by ID, using a generated registry of .queue.ts
 * definitions to determine the first worker and initial input mapping.
 *
 * This API intentionally mirrors the ergonomics of dispatching a single
 * worker, but under the hood it embeds queue context into the job input
 * so queue-aware wrappers can chain subsequent steps.
 */
export async function dispatchQueue<InitialInput = any>(
  queueId: string,
  initialInput: InitialInput,
  options: DispatchOptions = {},
  ctx?: any
): Promise<DispatchQueueResult> {
  const registry = options.registry;
  if (!registry?.getQueueById) {
    throw new Error(
      'dispatchQueue requires options.registry with getQueueById. ' +
        'Use getQueueRegistry() from your workflows registry (e.g. app/api/workflows/registry/workers) and pass { registry: await getQueueRegistry() }.'
    );
  }
  const { getQueueById, invokeMapInput } = registry;
  const queue = getQueueById(queueId);

  if (!queue) {
    throw new Error(`Worker queue "${queueId}" not found in registry`);
  }

  if (!queue.steps || queue.steps.length === 0) {
    throw new Error(`Worker queue "${queueId}" has no steps defined`);
  }

  const stepIndex = 0;
  const firstStep = queue.steps[stepIndex];
  const firstWorkerId = firstStep.workerId;

  if (!firstWorkerId) {
    throw new Error(
      `Worker queue "${queueId}" has an invalid first step (missing workerId)`
    );
  }

  // Compute the first step's input:
  // - If a mapping function is configured and the registry exposes invokeMapInput,
  //   use it (prevOutput is undefined for the first step).
  // - Otherwise, default to the initial input.
  let firstInput: unknown = initialInput;
  if (firstStep.mapInputFromPrev && typeof invokeMapInput === 'function') {
    firstInput = await invokeMapInput(
      queueId,
      stepIndex,
      undefined,
      initialInput
    );
  }

  const jobId =
    options.jobId ||
    `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const queueContext: WorkerQueueContext<InitialInput> = {
    id: queueId,
    stepIndex,
    initialInput,
    queueJobId: jobId,
  };

  // Create queue job record if callback provided (for progress tracking)
  if (options.onCreateQueueJob) {
    try {
      await options.onCreateQueueJob({
        queueJobId: jobId,
        queueId,
        firstStep: { workerId: firstWorkerId, workerJobId: jobId },
        metadata: options.metadata as Record<string, unknown> | undefined,
      });
    } catch (err: any) {
      console.warn('[dispatchQueue] onCreateQueueJob failed:', err?.message ?? err);
    }
  }

  // Embed queue context into the worker input under a reserved key.
  const normalizedFirstInput =
    firstInput !== null && typeof firstInput === 'object'
      ? (firstInput as Record<string, any>)
      : { value: firstInput };

  const inputWithQueue = {
    ...normalizedFirstInput,
    __workerQueue: queueContext,
  };

  const metadataWithQueue = {
    ...(options.metadata || {}),
    __workerQueue: queueContext,
  };

  const triggerUrl = getWorkersTriggerUrl();
  const serializedContext = ctx ? serializeContext(ctx) : {};

  const messageBody = {
    workerId: firstWorkerId,
    jobId,
    input: inputWithQueue,
    context: serializedContext,
    webhookUrl: options.webhookUrl,
    metadata: metadataWithQueue,
    timestamp: new Date().toISOString(),
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const triggerKey = process.env.WORKERS_TRIGGER_API_KEY;
  if (triggerKey) {
    headers['x-workers-trigger-key'] = triggerKey;
  }

  const response = await fetch(triggerUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      workerId: firstWorkerId,
      body: messageBody,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Failed to trigger queue "${queueId}" (worker "${firstWorkerId}"): ` +
        `${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`
    );
  }

  const data = (await response.json().catch(() => ({}))) as any;
  const messageId = data?.messageId ? String(data.messageId) : `trigger-${jobId}`;

  return {
    queueId,
    messageId,
    status: 'queued',
    jobId,
  };
}

