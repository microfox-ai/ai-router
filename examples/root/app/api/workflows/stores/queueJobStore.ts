/**
 * Queue job store for tracking multi-step queue execution.
 *
 * Stores a single record per queue run with steps array containing:
 * - workerId, workerJobId (worker_job id), status, input, output, startedAt, completedAt, error
 *
 * Uses MongoDB or Upstash Redis (same backend as worker_jobs), based on WORKER_DATABASE_TYPE.
 * Collection/key prefix: queue_jobs / worker:queue-jobs:
 */

import type { Collection } from 'mongodb';
import { Redis } from '@upstash/redis';
import { getWorkflowDb } from './mongoAdapter';

export interface QueueJobStep {
  workerId: string;
  workerJobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  input?: unknown;
  output?: unknown;
  error?: { message: string };
  startedAt?: string;
  completedAt?: string;
}

export interface QueueJobRecord {
  id: string;
  queueId: string;
  status: 'running' | 'completed' | 'failed' | 'partial';
  steps: QueueJobStep[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// === Backend selection ===

function getStoreType(): 'mongodb' | 'upstash-redis' {
  const t = (process.env.WORKER_DATABASE_TYPE || 'upstash-redis').toLowerCase();
  return t === 'mongodb' ? 'mongodb' : 'upstash-redis';
}

function preferMongo(): boolean {
  return getStoreType() === 'mongodb';
}

function preferRedis(): boolean {
  return getStoreType() !== 'mongodb';
}

// === MongoDB backend ===

function getQueueJobsCollectionName(): string {
  return process.env.MONGODB_QUEUE_JOBS_COLLECTION || 'queue_jobs';
}

async function getCollection(): Promise<Collection<QueueJobRecord & { _id: string }>> {
  const db = await getWorkflowDb();
  return db.collection<QueueJobRecord & { _id: string }>(getQueueJobsCollectionName());
}

// === Redis backend ===

const redisUrl =
  process.env.WORKER_UPSTASH_REDIS_REST_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.UPSTASH_REDIS_URL;
const redisToken =
  process.env.WORKER_UPSTASH_REDIS_REST_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.UPSTASH_REDIS_TOKEN;
const queueKeyPrefix =
  process.env.WORKER_UPSTASH_REDIS_QUEUE_PREFIX ||
  process.env.UPSTASH_REDIS_QUEUE_PREFIX ||
  'worker:queue-jobs:';

let redisClient: Redis | null = null;

function getRedis(): Redis {
  if (!redisUrl || !redisToken) {
    throw new Error(
      'Upstash Redis configuration missing for queue job store. Set WORKER_UPSTASH_REDIS_REST_URL and WORKER_UPSTASH_REDIS_REST_TOKEN (or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN).'
    );
  }
  if (!redisClient) {
    redisClient = new Redis({
      url: redisUrl,
      token: redisToken,
    });
  }
  return redisClient;
}

function queueKey(id: string): string {
  return `${queueKeyPrefix}${id}`;
}

/** Hash values from Upstash hgetall may be auto-parsed (array/object) or raw strings. */
function stepsFromHash(val: unknown): QueueJobStep[] {
  if (Array.isArray(val)) return val as QueueJobStep[];
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val) as QueueJobStep[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function metadataFromHash(val: unknown): Record<string, unknown> {
  if (val && typeof val === 'object' && !Array.isArray(val)) return val as Record<string, unknown>;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val) as Record<string, unknown>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

async function loadQueueJobRedis(queueJobId: string): Promise<QueueJobRecord | null> {
  const redis = getRedis();
  const key = queueKey(queueJobId);
  const data = await redis.hgetall(key);
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return null;
  const record: QueueJobRecord = {
    id: (data as Record<string, unknown>).id === undefined ? queueJobId : String((data as Record<string, unknown>).id),
    queueId: String((data as Record<string, unknown>).queueId ?? ''),
    status: (String((data as Record<string, unknown>).status ?? 'running') as QueueJobRecord['status']),
    steps: stepsFromHash((data as Record<string, unknown>).steps),
    metadata: metadataFromHash((data as Record<string, unknown>).metadata),
    createdAt: String((data as Record<string, unknown>).createdAt ?? new Date().toISOString()),
    updatedAt: String((data as Record<string, unknown>).updatedAt ?? new Date().toISOString()),
    completedAt: (data as Record<string, unknown>).completedAt != null ? String((data as Record<string, unknown>).completedAt) : undefined,
  };
  return record;
}

export async function createQueueJob(
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
      {
        workerId: firstStep.workerId,
        workerJobId: firstStep.workerJobId,
        status: 'queued',
      },
    ],
    metadata: metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };
  
  if (preferRedis()) {
    const redis = getRedis();
    const key = queueKey(id);
    const toSet: Record<string, string> = {
      id: record.id,
      queueId: record.queueId,
      status: record.status,
      steps: JSON.stringify(record.steps),
      metadata: JSON.stringify(record.metadata || {}),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
    await redis.hset(key, toSet);
    const ttlSeconds =
      typeof process.env.WORKER_QUEUE_JOBS_TTL_SECONDS === 'string'
        ? parseInt(process.env.WORKER_QUEUE_JOBS_TTL_SECONDS, 10) || 60 * 60 * 24 * 7
        : typeof process.env.WORKER_JOBS_TTL_SECONDS === 'string'
          ? parseInt(process.env.WORKER_JOBS_TTL_SECONDS, 10) || 60 * 60 * 24 * 7
          : 60 * 60 * 24 * 7; // 7 days default
    if (ttlSeconds > 0) {
      await redis.expire(key, ttlSeconds);
    }
    return;
  }
  
  const collection = await getCollection();
  await collection.updateOne(
    { _id: id },
    { $set: { ...record, _id: id } },
    { upsert: true }
  );
}

export async function updateQueueStep(
  queueJobId: string,
  stepIndex: number,
  update: {
    status?: 'queued' | 'running' | 'completed' | 'failed';
    input?: unknown;
    output?: unknown;
    error?: { message: string };
    startedAt?: string;
    completedAt?: string;
  }
): Promise<void> {
  const collection = await getCollection();
  const now = new Date().toISOString();
  const setKey = `steps.${stepIndex}`;
  const existing = await collection.findOne({ _id: queueJobId });
  if (!existing) {
    throw new Error(`Queue job ${queueJobId} not found`);
  }
  const step = existing.steps[stepIndex];
  if (!step) {
    throw new Error(`Queue job ${queueJobId} has no step at index ${stepIndex}`);
  }
  const mergedStep: QueueJobStep = {
    ...step,
    ...(update.status !== undefined && { status: update.status }),
    ...(update.input !== undefined && { input: update.input }),
    ...(update.output !== undefined && { output: update.output }),
    ...(update.error !== undefined && { error: update.error }),
    startedAt: update.startedAt ?? (update.status === 'running' ? now : step.startedAt),
    completedAt:
      update.completedAt ??
      (['completed', 'failed'].includes(update.status ?? '') ? now : step.completedAt),
  };
  const updateDoc: any = {
    $set: {
      [setKey]: mergedStep,
      updatedAt: now,
    },
  };
  if (update.status === 'failed') {
    updateDoc.$set.status = 'failed';
    if (!existing.completedAt) updateDoc.$set.completedAt = now;
  } else if (update.status === 'completed' && stepIndex === existing.steps.length - 1) {
    updateDoc.$set.status = 'completed';
    if (!existing.completedAt) updateDoc.$set.completedAt = now;
  }
  await collection.updateOne({ _id: queueJobId }, updateDoc);
}

export async function appendQueueStep(
  queueJobId: string,
  step: { workerId: string; workerJobId: string }
): Promise<void> {
  const collection = await getCollection();
  const now = new Date().toISOString();
  await collection.updateOne(
    { _id: queueJobId },
    {
      $push: {
        steps: {
          workerId: step.workerId,
          workerJobId: step.workerJobId,
          status: 'queued',
        },
      },
      $set: { updatedAt: now },
    }
  );
}

/**
 * Update queue job overall status (e.g. from webhook when queue run completes).
 */
export async function updateQueueJob(
  queueJobId: string,
  update: { status?: QueueJobRecord['status']; completedAt?: string }
): Promise<void> {
  const now = new Date().toISOString();
  if (preferRedis()) {
    const redis = getRedis();
    const key = queueKey(queueJobId);
    const existing = await loadQueueJobRedis(queueJobId);
    if (!existing) throw new Error(`Queue job ${queueJobId} not found`);
    const toSet: Record<string, string> = {
      status: update.status ?? existing.status,
      updatedAt: now,
    };
    if (update.completedAt !== undefined) toSet.completedAt = update.completedAt;
    await redis.hset(key, toSet);
    return;
  }
  const collection = await getCollection();
  const setDoc: Record<string, string> = { updatedAt: now };
  if (update.status !== undefined) setDoc.status = update.status;
  if (update.completedAt !== undefined) setDoc.completedAt = update.completedAt;
  await collection.updateOne({ _id: queueJobId }, { $set: setDoc });
}

export async function getQueueJob(queueJobId: string): Promise<QueueJobRecord | null> {
  if (preferRedis()) {
    return loadQueueJobRedis(queueJobId);
  }
  const collection = await getCollection();
  const doc = await collection.findOne({ _id: queueJobId });
  if (!doc) return null;
  const { _id, ...record } = doc;
  return { ...record, id: _id };
}

export async function listQueueJobs(
  queueId?: string,
  limit = 50
): Promise<QueueJobRecord[]> {
  if (preferRedis()) {
    // Redis: scan for keys matching prefix, then load each
    // Note: This is less efficient than MongoDB queries, but acceptable for small datasets
    const redis = getRedis();
    const pattern = queueKey('*');
    const keys: string[] = [];
    let cursor: number = 0;
    do {
      const result = await redis.scan(cursor, { match: pattern, count: 100 });
      cursor = typeof result[0] === 'number' ? result[0] : parseInt(String(result[0]), 10);
      keys.push(...(result[1] || []));
    } while (cursor !== 0);
    
    const jobs = await Promise.all(
      keys.map((key) => {
        const id = key.replace(queueKeyPrefix, '');
        return loadQueueJobRedis(id);
      })
    );
    const valid = jobs.filter((j): j is QueueJobRecord => j !== null);
    const filtered = queueId ? valid.filter((j) => j.queueId === queueId) : valid;
    return filtered
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }
  const collection = await getCollection();
  const filter = queueId ? { queueId } : {};
  const docs = await collection
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map((doc) => {
    const { _id, ...record } = doc;
    return { ...record, id: _id };
  });
}
