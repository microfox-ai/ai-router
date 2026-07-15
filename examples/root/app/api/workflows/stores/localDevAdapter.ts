/**
 * Local dev-server store adapter (`WORKER_DATABASE_TYPE=local`).
 *
 * When workers run under `ai-worker dev` with the local file-persisted store,
 * job state lives inside the dev server process — this app cannot read it from
 * Redis/Mongo. This adapter proxies every read AND write to the dev server's
 * `/dev-store/*` HTTP API (single source of truth), using the same base URL
 * (`WORKER_BASE_URL`, e.g. http://localhost:4100) and API key the trigger
 * calls already use.
 *
 * DEV ONLY: never use this in a deployed app — point WORKER_DATABASE_TYPE at
 * mongodb/upstash-redis there.
 */

import type { JobRecord, InternalJobEntry } from './jobStore';
import type { QueueJobRecord, QueueJobStep } from './queueJobStore';

function devServerBaseUrl(): string {
  const base =
    process.env.WORKER_BASE_URL ||
    process.env.WORKERS_TRIGGER_API_URL?.replace(/\/workers\/trigger\/?$/, '');
  if (!base) {
    throw new Error(
      'WORKER_DATABASE_TYPE=local requires WORKER_BASE_URL to point at your `ai-worker dev` server (e.g. http://localhost:4100).'
    );
  }
  return base.replace(/\/+$/, '');
}

let warnedProduction = false;

async function devStoreFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<{ status: number; data: T | null }> {
  if (process.env.NODE_ENV === 'production' && !warnedProduction) {
    warnedProduction = true;
    console.warn(
      '[localDevAdapter] WORKER_DATABASE_TYPE=local is active in a production build — this store only works against a local `ai-worker dev` server.'
    );
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = process.env.WORKERS_API_KEY || process.env.WORKERS_TRIGGER_API_KEY;
  if (key) headers['x-workers-trigger-key'] = key;

  const response = await fetch(`${devServerBaseUrl()}${path}`, {
    method: init?.method ?? 'GET',
    headers,
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    cache: 'no-store',
  });
  if (response.status === 404) {
    return { status: 404, data: null };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Dev store request failed: ${init?.method ?? 'GET'} ${path} -> ${response.status}${text ? ` ${text}` : ''}. Is \`ai-worker dev\` running at ${devServerBaseUrl()}?`
    );
  }
  return { status: response.status, data: (await response.json()) as T };
}

// === JobStoreAdapter surface (see jobStore.ts) ===

export const localDevJobStore = {
  async setJob(jobId: string, data: Partial<JobRecord>): Promise<void> {
    await devStoreFetch(`/dev-store/jobs/${encodeURIComponent(jobId)}`, {
      method: 'PUT',
      body: data,
    });
  },
  async getJob(jobId: string): Promise<JobRecord | null> {
    const { data } = await devStoreFetch<JobRecord>(
      `/dev-store/jobs/${encodeURIComponent(jobId)}`
    );
    return data;
  },
  async updateJob(jobId: string, data: Partial<JobRecord>): Promise<void> {
    await devStoreFetch(`/dev-store/jobs/${encodeURIComponent(jobId)}`, {
      method: 'PUT',
      body: data,
    });
  },
  async appendInternalJob(parentJobId: string, entry: InternalJobEntry): Promise<void> {
    await devStoreFetch(`/dev-store/jobs/${encodeURIComponent(parentJobId)}/internal-jobs`, {
      method: 'POST',
      body: entry,
    });
  },
  async listJobsByWorker(workerId: string): Promise<JobRecord[]> {
    const { data } = await devStoreFetch<JobRecord[]>(
      `/dev-store/jobs?workerId=${encodeURIComponent(workerId)}`
    );
    return data ?? [];
  },
};

// === Queue job store surface (see queueJobStore.ts) ===

export async function createQueueJobLocal(
  id: string,
  queueId: string,
  firstStep: { workerId: string; workerJobId: string },
  metadata?: Record<string, unknown>
): Promise<void> {
  const now = new Date().toISOString();
  const record: QueueJobRecord = {
    id,
    queueId,
    status: 'running',
    steps: [
      { workerId: firstStep.workerId, workerJobId: firstStep.workerJobId, status: 'queued' },
    ],
    metadata: metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };
  await devStoreFetch(`/dev-store/queue-jobs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: record,
  });
}

export async function updateQueueStepLocal(
  queueJobId: string,
  stepIndex: number,
  update: {
    status?: QueueJobStep['status'];
    input?: unknown;
    output?: unknown;
    error?: { message: string };
    startedAt?: string;
    completedAt?: string;
  }
): Promise<void> {
  const { status } = await devStoreFetch(
    `/dev-store/queue-jobs/${encodeURIComponent(queueJobId)}/steps/${stepIndex}`,
    { method: 'PUT', body: update }
  );
  if (status === 404) {
    throw new Error(`Queue job ${queueJobId} not found (or no step at index ${stepIndex})`);
  }
}

export async function appendQueueStepLocal(
  queueJobId: string,
  step: { workerId: string; workerJobId: string }
): Promise<void> {
  const { status } = await devStoreFetch(
    `/dev-store/queue-jobs/${encodeURIComponent(queueJobId)}/steps`,
    { method: 'POST', body: step }
  );
  if (status === 404) {
    throw new Error(`Queue job ${queueJobId} not found`);
  }
}

export async function updateQueueJobLocal(
  queueJobId: string,
  update: { status?: QueueJobRecord['status']; completedAt?: string }
): Promise<void> {
  await devStoreFetch(`/dev-store/queue-jobs/${encodeURIComponent(queueJobId)}`, {
    method: 'PUT',
    body: update,
  });
}

export async function getQueueJobLocal(queueJobId: string): Promise<QueueJobRecord | null> {
  const { data } = await devStoreFetch<QueueJobRecord>(
    `/dev-store/queue-jobs/${encodeURIComponent(queueJobId)}`
  );
  return data;
}

export async function listQueueJobsLocal(
  queueId?: string,
  limit = 50
): Promise<QueueJobRecord[]> {
  const params = new URLSearchParams();
  if (queueId) params.set('queueId', queueId);
  params.set('limit', String(limit));
  const { data } = await devStoreFetch<QueueJobRecord[]>(
    `/dev-store/queue-jobs?${params.toString()}`
  );
  return data ?? [];
}
