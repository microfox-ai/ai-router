/**
 * Client for dispatching background worker jobs.
 *
 * In production, dispatching happens via the workers HTTP API:
 *   POST /workers/trigger  -> enqueues message to SQS on the workers service side
 *
 * This avoids requiring AWS credentials in your Next.js app.
 */

import type { ZodType, z } from 'zod';
import type { WorkerQueueConfig } from './queue.js';

export interface WorkerQueueRegistry {
  getQueueById(queueId: string): WorkerQueueConfig | undefined;
  /** (initialInput, previousOutputs) for best DX: derive next input from original request and all prior step outputs. */
  invokeMapInput?: (
    queueId: string,
    stepIndex: number,
    initialInput: unknown,
    previousOutputs: Array<{ stepIndex: number; workerId: string; output: unknown }>
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
 * Server-side only; clients should use useWorkflowJob with your app's /api/workflows routes.
 *
 * Env vars:
 * - WORKER_BASE_URL: base URL of the workers service (e.g. https://.../prod)
 * - WORKERS_TRIGGER_API_URL / WORKERS_CONFIG_API_URL: legacy, still supported
 */
export function getWorkersTriggerUrl(): string {
  const raw =
    process.env.WORKER_BASE_URL ||
    process.env.WORKERS_TRIGGER_API_URL ||
    process.env.WORKERS_CONFIG_API_URL;

  if (!raw) {
    throw new Error(
      'WORKER_BASE_URL is required for background workers. Set it server-side only.'
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
 * URL for the queue start endpoint (dispatch proxy). Use this so queue starts
 * go through the queue handler Lambda for easier debugging (one log stream per queue).
 */
export function getQueueStartUrl(queueId: string): string {
  const raw =
    process.env.WORKER_BASE_URL ||
    process.env.WORKERS_TRIGGER_API_URL ||
    process.env.WORKERS_CONFIG_API_URL;

  if (!raw) {
    throw new Error(
      'WORKER_BASE_URL is required for background workers. Set it server-side only.'
    );
  }

  const url = new URL(raw);
  url.search = '';
  url.hash = '';

  const path = url.pathname || '';
  url.pathname = path.replace(/\/?workers\/(trigger|config)\/?$/, '');
  const basePath = url.pathname.replace(/\/+$/, '');
  const safeSegment = encodeURIComponent(queueId);
  url.pathname = `${basePath}/queues/${safeSegment}/start`.replace(/\/+$/, '');

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
 * Dispatch a worker by ID without importing the worker module.
 * Sends to the workers trigger API (WORKER_BASE_URL). No input schema validation at call site.
 *
 * @param workerId - The worker ID (e.g. 'echo', 'data-processor')
 * @param input - Input payload (object or undefined)
 * @param options - Optional jobId, webhookUrl, metadata
 * @param ctx - Optional context (serializable parts sent in the request)
 * @returns Promise resolving to { messageId, status: 'queued', jobId }
 */
export async function dispatchWorker(
  workerId: string,
  input?: Record<string, unknown>,
  options: DispatchOptions = {},
  ctx?: any
): Promise<DispatchResult> {
  const jobId =
    options.jobId || `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const triggerUrl = getWorkersTriggerUrl();
  const serializedContext = ctx ? serializeContext(ctx) : {};
  const messageBody = {
    workerId,
    jobId,
    input: input ?? {},
    context: serializedContext,
    webhookUrl: options.webhookUrl,
    metadata: options.metadata || {},
    timestamp: new Date().toISOString(),
  };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const triggerKey = process.env.WORKERS_TRIGGER_API_KEY;
  if (triggerKey) headers['x-workers-trigger-key'] = triggerKey;
  const response = await fetch(triggerUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ workerId, body: messageBody }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Failed to trigger worker "${workerId}": ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`
    );
  }
  const data = (await response.json().catch(() => ({}))) as any;
  const messageId = data?.messageId ? String(data.messageId) : `trigger-${jobId}`;
  return { messageId, status: 'queued', jobId };
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
 * Dispatches a queue by ID. POSTs to the queue-start API; the queue-start handler creates the queue job.
 * Pass the first worker's input directly (no registry required).
 */
export async function dispatchQueue<InitialInput = any>(
  queueId: string,
  initialInput?: InitialInput,
  options: DispatchOptions = {},
  _ctx?: any
): Promise<DispatchQueueResult> {
  const jobId =
    options.jobId || `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const queueStartUrl = getQueueStartUrl(queueId);
  const normalizedInput =
    initialInput !== null && typeof initialInput === 'object'
      ? (initialInput as Record<string, unknown>)
      : { value: initialInput };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const triggerKey = process.env.WORKERS_TRIGGER_API_KEY;
  if (triggerKey) headers['x-workers-trigger-key'] = triggerKey;
  const response = await fetch(queueStartUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input: normalizedInput,
      initialInput: normalizedInput,
      metadata: options.metadata ?? {},
      jobId,
      ...(options.webhookUrl ? { webhookUrl: options.webhookUrl } : {}),
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Failed to start queue "${queueId}": ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`
    );
  }
  const data = (await response.json().catch(() => ({}))) as any;
  const messageId = data?.messageId ?? data?.jobId ?? `queue-${jobId}`;
  return { queueId, messageId, status: 'queued', jobId };
}

