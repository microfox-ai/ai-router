/**
 * Worker registry system.
 *
 * Uses only the GET /workers/config API as the source of truth.
 * No directory scanning, no dynamic imports, no .worker.ts loading.
 *
 * - getWorker(workerId): returns a synthetic WorkerAgent that dispatches via POST /workers/trigger
 * - listWorkers(): returns worker IDs from the config API response
 */

import type { WorkerAgent } from '@microfox/ai-worker';

export interface WorkersConfig {
  version?: string;
  stage?: string;
  region?: string;
  workers: Record<string, { queueUrl: string; region: string }>;
}

let configCache: WorkersConfig | null = null;

function getConfigBaseUrl(): string {
  const raw =
    process.env.WORKERS_CONFIG_API_URL ||
    process.env.NEXT_PUBLIC_WORKERS_CONFIG_API_URL ||
    process.env.WORKER_BASE_URL ||
    process.env.NEXT_PUBLIC_WORKER_BASE_URL;
  if (!raw?.trim()) {
    throw new Error(
      'WORKERS_CONFIG_API_URL or WORKER_BASE_URL is required for the worker registry. ' +
        'Set it to the base URL of your workers service (e.g. https://xxx.execute-api.us-east-1.amazonaws.com/prod).'
    );
  }
  const base = raw.trim().replace(/\/+$/, '');
  if (base.endsWith('/workers/config')) {
    return base.replace(/\/workers\/config\/?$/, '');
  }
  return base;
}

function getConfigUrl(): string {
  const base = getConfigBaseUrl();
  return `${base}/workers/config`;
}

function getTriggerUrl(): string {
  const base = getConfigBaseUrl();
  return `${base}/workers/trigger`;
}

/**
 * Fetch and cache workers config from GET /workers/config.
 */
export async function fetchWorkersConfig(): Promise<WorkersConfig> {
  if (configCache?.workers && Object.keys(configCache.workers).length > 0) {
    return configCache;
  }
  const configUrl = getConfigUrl();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = process.env.WORKERS_CONFIG_API_KEY;
  if (apiKey) {
    headers['x-workers-config-key'] = apiKey;
  }
  const res = await fetch(configUrl, { method: 'GET', headers });
  if (!res.ok) {
    throw new Error(
      `[WorkerRegistry] GET ${configUrl} failed: ${res.status} ${res.statusText}`
    );
  }
  const data = (await res.json()) as WorkersConfig;
  if (!data?.workers || typeof data.workers !== 'object') {
    throw new Error(
      '[WorkerRegistry] Invalid config: expected { workers: { [id]: { queueUrl, region } } }'
    );
  }
  configCache = data;
  return data;
}

/**
 * Build a synthetic WorkerAgent that dispatches via POST /workers/trigger.
 * Matches the trigger API contract used by @microfox/ai-worker.
 */
function createSyntheticAgent(workerId: string): WorkerAgent<any, any> {
  return {
    id: workerId,
    dispatch: async (input: any, options: any) => {
      const jobId =
        options?.jobId ||
        `job-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const webhookUrl = options?.webhookUrl;
      const metadata = options?.metadata ?? {};
      const triggerUrl = getTriggerUrl();
      const messageBody = {
        workerId,
        jobId,
        input: input ?? {},
        context: {},
        webhookUrl: webhookUrl ?? undefined,
        metadata,
        timestamp: new Date().toISOString(),
      };
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const key = process.env.WORKERS_TRIGGER_API_KEY;
      if (key) {
        headers['x-workers-trigger-key'] = key;
      }
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
      return { messageId, status: 'queued' as const, jobId };
    },
  } as WorkerAgent<any, any>;
}

/**
 * List worker IDs from the config API.
 */
export async function listWorkers(): Promise<string[]> {
  const config = await fetchWorkersConfig();
  return Object.keys(config.workers);
}

/**
 * Get a worker by ID. Returns a synthetic WorkerAgent that dispatches via
 * POST /workers/trigger. Returns null if the worker is not in the config.
 */
export async function getWorker(
  workerId: string
): Promise<WorkerAgent<any, any> | null> {
  const config = await fetchWorkersConfig();
  if (!(workerId in config.workers)) {
    return null;
  }
  return createSyntheticAgent(workerId);
}

/**
 * Clear the in-memory config cache (e.g. for tests or refresh).
 */
export function clearConfigCache(): void {
  configCache = null;
}
