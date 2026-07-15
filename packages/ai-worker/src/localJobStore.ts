/**
 * Local job store (`WORKER_DATABASE_TYPE=local`) — in-memory Maps with debounced
 * JSON persistence, standing in for Upstash/Mongo when running `ai-worker dev`.
 *
 * Never a fallback: this store is only used when WORKER_DATABASE_TYPE is
 * explicitly 'local' (the dev server sets it; compile never writes it into a
 * deployed env.json unless the user set it themselves).
 *
 * State lives on `globalThis`, not module scope: tsup bundles each package
 * entry (index / handler / queueJobStore) separately, so module-level Maps
 * would be duplicated per bundle and the dev server would read different
 * state than the runtime writes. The global anchor makes every copy share
 * one store (same trick as the local dispatch bridge).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { JobStore, JobStoreUpdate, JobRecord } from './handler.js';

/** Mirrors the queue job doc shape used by the redis/mongo queue stores. */
export interface LocalQueueJobStep {
  workerId: string;
  workerJobId: string;
  status: 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'failed';
  input?: unknown;
  output?: unknown;
  error?: { message: string };
  startedAt?: string;
  completedAt?: string;
}

export interface LocalQueueJobRecord {
  id: string;
  queueId: string;
  status: 'running' | 'completed' | 'failed' | 'partial';
  steps: LocalQueueJobStep[];
  metadata?: Record<string, unknown>;
  userId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

interface LocalStoreState {
  jobs: Map<string, JobRecord>;
  queueJobs: Map<string, LocalQueueJobRecord>;
  loadedFrom: string | null;
  persistTimer: ReturnType<typeof setTimeout> | null;
}

const STATE_GLOBAL_KEY = '__AI_WORKER_LOCAL_STORE_STATE__';
const PERSIST_DEBOUNCE_MS = 250;

export function isLocalJobStoreEnabled(): boolean {
  return (process.env.WORKER_DATABASE_TYPE || '').toLowerCase() === 'local';
}

function getStatePath(): string {
  return (
    process.env.AI_WORKER_LOCAL_STATE_PATH ||
    path.join(process.cwd(), '.microfox', 'dev-state.json')
  );
}

function getState(): LocalStoreState {
  const g = globalThis as Record<string, unknown>;
  let state = g[STATE_GLOBAL_KEY] as LocalStoreState | undefined;
  if (!state) {
    state = { jobs: new Map(), queueJobs: new Map(), loadedFrom: null, persistTimer: null };
    g[STATE_GLOBAL_KEY] = state;
  }
  // (Re)load from disk on first touch, or if the target path changed.
  const statePath = getStatePath();
  if (state.loadedFrom !== statePath) {
    state.loadedFrom = statePath;
    try {
      if (fs.existsSync(statePath)) {
        const raw = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as {
          jobs?: Record<string, JobRecord>;
          queueJobs?: Record<string, LocalQueueJobRecord>;
        };
        state.jobs = new Map(Object.entries(raw.jobs ?? {}));
        state.queueJobs = new Map(Object.entries(raw.queueJobs ?? {}));
      }
    } catch (e: any) {
      console.warn('[localJobStore] Could not read persisted dev state (starting empty):', {
        statePath,
        error: e?.message ?? String(e),
      });
    }
  }
  return state;
}

function schedulePersist(): void {
  const state = getState();
  if (state.persistTimer) return;
  state.persistTimer = setTimeout(() => {
    state.persistTimer = null;
    persistNow(state);
  }, PERSIST_DEBOUNCE_MS);
  // Never keep the process alive just to persist; flush handles shutdown.
  if (typeof state.persistTimer.unref === 'function') state.persistTimer.unref();
}

function persistNow(state: LocalStoreState): void {
  const statePath = getStatePath();
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const payload = {
      jobs: Object.fromEntries(state.jobs),
      queueJobs: Object.fromEntries(state.queueJobs),
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(statePath, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (e: any) {
    console.warn('[localJobStore] Failed to persist dev state:', {
      statePath,
      error: e?.message ?? String(e),
    });
  }
}

/** Synchronously write pending state to disk (dev server calls this on shutdown). */
export function flushLocalJobStore(): void {
  const g = globalThis as Record<string, unknown>;
  const state = g[STATE_GLOBAL_KEY] as LocalStoreState | undefined;
  if (!state) return;
  if (state.persistTimer) {
    clearTimeout(state.persistTimer);
    state.persistTimer = null;
  }
  persistNow(state);
}

// === Worker job records (mirrors redisJobStore semantics) ===

export async function loadLocalJob(jobId: string): Promise<JobRecord | null> {
  const record = getState().jobs.get(jobId);
  return record ? structuredClone(record) : null;
}

export async function upsertLocalJob(
  jobId: string,
  workerId: string,
  input: any,
  metadata: Record<string, any>,
  userId?: string
): Promise<void> {
  const state = getState();
  const now = new Date().toISOString();
  const existing = state.jobs.get(jobId);
  state.jobs.set(jobId, {
    jobId,
    workerId,
    status: existing?.status ?? 'queued',
    input: input ?? {},
    metadata: metadata ?? {},
    ...(existing?.output !== undefined ? { output: existing.output } : {}),
    ...(existing?.error !== undefined ? { error: existing.error } : {}),
    ...(existing?.internalJobs ? { internalJobs: existing.internalJobs } : {}),
    ...(userId ? { userId } : existing?.userId ? { userId: existing.userId } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(existing?.completedAt ? { completedAt: existing.completedAt } : {}),
  });
  schedulePersist();
}

export function createLocalJobStore(
  workerId: string,
  jobId: string,
  input: any,
  metadata: Record<string, any>,
  userId?: string
): JobStore {
  void workerId;
  void input;
  void metadata;
  void userId;
  return {
    update: async (update: JobStoreUpdate): Promise<void> => {
      const state = getState();
      const existing = state.jobs.get(jobId);
      if (!existing) return;
      const now = new Date().toISOString();

      const mergedMeta: Record<string, any> = { ...(existing.metadata ?? {}) };
      if (update.metadata) Object.assign(mergedMeta, update.metadata);
      if (update.progress !== undefined || update.progressMessage !== undefined) {
        mergedMeta.progress = update.progress;
        mergedMeta.progressMessage = update.progressMessage;
      }
      existing.metadata = mergedMeta;

      if (update.status !== undefined) {
        existing.status = update.error ? 'failed' : update.status;
        if (
          (update.status === 'completed' || update.status === 'failed') &&
          !existing.completedAt
        ) {
          existing.completedAt = now;
        }
      }
      if (update.output !== undefined) existing.output = update.output;
      if (update.error !== undefined) existing.error = update.error;
      existing.updatedAt = now;
      schedulePersist();
    },
    get: async () => loadLocalJob(jobId),
    appendInternalJob: async (entry) => {
      const state = getState();
      const existing = state.jobs.get(jobId);
      if (!existing) return;
      existing.internalJobs = [...(existing.internalJobs ?? []), entry];
      existing.updatedAt = new Date().toISOString();
      schedulePersist();
    },
    getJob: async (otherJobId: string) => loadLocalJob(otherJobId),
  };
}

/** All job records (dev server observability route). */
export function listLocalJobs(): JobRecord[] {
  return Array.from(getState().jobs.values()).map((r) => structuredClone(r));
}

/** Jobs for one worker, newest first (dev server /dev-store API). */
export function listLocalJobsByWorker(workerId: string): JobRecord[] {
  return listLocalJobs()
    .filter((r) => r.workerId === workerId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Drop keys whose value is undefined so a partial merge never erases fields. */
function definedEntries<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
}

/**
 * Shallow-merge a partial job record (upsert). Serves the dev server's
 * /dev-store API, which the app boilerplate's `local` adapter writes through
 * (setJob/updateJob) so console/webhook updates land in the same store the
 * workers use.
 */
export async function patchLocalJob(
  jobId: string,
  partial: Partial<JobRecord>
): Promise<JobRecord> {
  const state = getState();
  const now = new Date().toISOString();
  const existing = state.jobs.get(jobId);
  const merged: JobRecord = {
    status: 'queued',
    input: {},
    ...(existing ?? {}),
    ...definedEntries(partial as Record<string, unknown>),
    jobId,
    workerId: partial.workerId ?? existing?.workerId ?? '',
    createdAt: existing?.createdAt ?? partial.createdAt ?? now,
    updatedAt: now,
  } as JobRecord;
  if (
    (merged.status === 'completed' || merged.status === 'failed') &&
    !merged.completedAt
  ) {
    merged.completedAt = now;
  }
  state.jobs.set(jobId, merged);
  schedulePersist();
  return structuredClone(merged);
}

/** Standalone appendInternalJob (dev server /dev-store API). */
export async function appendLocalInternalJob(
  parentJobId: string,
  entry: { jobId: string; workerId: string; awaited?: boolean; delaySeconds?: number }
): Promise<void> {
  const state = getState();
  const existing = state.jobs.get(parentJobId);
  if (!existing) return;
  existing.internalJobs = [...(existing.internalJobs ?? []), entry];
  existing.updatedAt = new Date().toISOString();
  schedulePersist();
}

/**
 * Shallow-merge a partial queue job record (upsert). `steps`, when provided,
 * replaces the whole array — step-level merging is done by the dev server
 * route so this store stays a dumb record holder.
 */
export async function patchLocalQueueJob(
  queueJobId: string,
  partial: Partial<LocalQueueJobRecord>
): Promise<LocalQueueJobRecord> {
  const state = getState();
  const now = new Date().toISOString();
  const existing = state.queueJobs.get(queueJobId);
  const merged: LocalQueueJobRecord = {
    queueId: '',
    status: 'running',
    steps: [],
    ...(existing ?? {}),
    ...definedEntries(partial as Record<string, unknown>),
    id: queueJobId,
    createdAt: existing?.createdAt ?? partial.createdAt ?? now,
    updatedAt: now,
  } as LocalQueueJobRecord;
  state.queueJobs.set(queueJobId, merged);
  schedulePersist();
  return structuredClone(merged);
}

// === Queue job docs (mirrors queueJobStore redis backend semantics) ===

export async function upsertInitialLocalQueueJob(options: {
  queueJobId: string;
  queueId: string;
  firstWorkerId: string;
  firstWorkerJobId: string;
  metadata?: Record<string, any>;
  userId?: string;
}): Promise<void> {
  const { queueJobId, queueId, firstWorkerId, firstWorkerJobId, metadata, userId } = options;
  const state = getState();
  const now = new Date().toISOString();
  const existing = state.queueJobs.get(queueJobId);
  if (existing) {
    if (!existing.steps || existing.steps.length === 0) {
      existing.steps = [
        { workerId: firstWorkerId, workerJobId: firstWorkerJobId, status: 'queued' },
      ];
    }
    existing.updatedAt = now;
  } else {
    state.queueJobs.set(queueJobId, {
      id: queueJobId,
      queueId,
      status: 'running',
      steps: [{ workerId: firstWorkerId, workerJobId: firstWorkerJobId, status: 'queued' }],
      metadata: metadata ?? {},
      ...(userId ? { userId } : {}),
      createdAt: now,
      updatedAt: now,
    });
  }
  schedulePersist();
}

export async function updateLocalQueueJobStep(options: {
  queueJobId: string;
  stepIndex: number;
  workerId: string;
  workerJobId: string;
  status: 'running' | 'awaiting_approval' | 'completed' | 'failed';
  input?: unknown;
  output?: unknown;
  error?: { message: string };
}): Promise<void> {
  const { queueJobId, stepIndex, status, input, output, error } = options;
  const state = getState();
  const existing = state.queueJobs.get(queueJobId);
  if (!existing) return;
  const step = existing.steps?.[stepIndex];
  if (!step) return;
  const now = new Date().toISOString();

  step.status = status;
  if (input !== undefined) step.input = input;
  if (output !== undefined) step.output = output;
  if (error !== undefined) step.error = error;
  if (status === 'running') step.startedAt = step.startedAt ?? now;
  if (status === 'completed' || status === 'failed') {
    step.completedAt = step.completedAt ?? now;
  }

  existing.updatedAt = now;
  if (status === 'failed') {
    existing.status = 'failed';
    existing.completedAt = existing.completedAt ?? now;
  } else if (status === 'completed' && stepIndex === existing.steps.length - 1) {
    existing.status = 'completed';
    existing.completedAt = existing.completedAt ?? now;
  }
  schedulePersist();
}

export async function appendLocalQueueJobStep(options: {
  queueJobId: string;
  workerId: string;
  workerJobId: string;
}): Promise<void> {
  const { queueJobId, workerId, workerJobId } = options;
  const state = getState();
  const existing = state.queueJobs.get(queueJobId);
  if (!existing) return;
  existing.steps = existing.steps ?? [];
  existing.steps.push({ workerId, workerJobId, status: 'queued' });
  existing.updatedAt = new Date().toISOString();
  schedulePersist();
}

export async function getLocalQueueJob(
  queueJobId: string
): Promise<LocalQueueJobRecord | null> {
  const record = getState().queueJobs.get(queueJobId);
  return record ? structuredClone(record) : null;
}

/** All queue job docs (dev server observability route). */
export function listLocalQueueJobs(): LocalQueueJobRecord[] {
  return Array.from(getState().queueJobs.values()).map((r) => structuredClone(r));
}
