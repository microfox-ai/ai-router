/**
 * Client for dispatching background worker jobs.
 *
 * In production, dispatching happens via the workers HTTP API:
 *   POST /workers/trigger  -> enqueues message to SQS on the workers service side
 *
 * This avoids requiring AWS credentials in your Next.js app.
 */

import type { ZodType, z } from 'zod';

export interface DispatchOptions {
  /**
   * Optional webhook callback URL to notify when the job finishes.
   * If omitted, no webhook will be sent.
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
}

export interface DispatchResult {
  messageId: string;
  status: 'queued';
  jobId: string;
}

export interface SerializedContext {
  requestId?: string;
  userId?: string;
  traceId?: string;
  [key: string]: any;
}

/**
 * Derives the full /workers/trigger URL from env.
 *
 * Preferred env vars:
 * - WORKER_BASE_URL: base URL of the workers service (e.g. https://.../prod)
 * - NEXT_PUBLIC_WORKER_BASE_URL: same, but exposed to the browser
 *
 * Legacy env vars (still supported for backwards compatibility):
 * - WORKERS_TRIGGER_API_URL / NEXT_PUBLIC_WORKERS_TRIGGER_API_URL
 * - WORKERS_CONFIG_API_URL / NEXT_PUBLIC_WORKERS_CONFIG_API_URL
 */
function getWorkersTriggerUrl(): string {
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

  // Create message body
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
