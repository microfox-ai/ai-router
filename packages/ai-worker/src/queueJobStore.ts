/**
 * Queue job store for worker queues (MongoDB or Upstash Redis).
 *
 * Mirrors the worker_jobs pattern but optimized for queues:
 * - MongoDB: collection `queue_jobs` (configurable via MONGODB_QUEUE_JOBS_COLLECTION)
 * - Upstash Redis: JSON blob per queue job with compact step entries
 *
 * This module is runtime-only (used by Lambda workers). Next.js APIs can read
 * the same collections/keys to show queue progress.
 */

import type { Redis } from '@upstash/redis';
import { Redis as UpstashRedis } from '@upstash/redis';
import { MongoClient, type Collection } from 'mongodb';

type QueueJobStep = {
  workerId: string;
  workerJobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  input?: unknown;
  output?: unknown;
  error?: { message: string };
  startedAt?: string;
  completedAt?: string;
};

type QueueJobDoc = {
  _id: string; // queueJobId
  id: string;
  queueId: string;
  status: 'running' | 'completed' | 'failed' | 'partial';
  steps: QueueJobStep[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};


// === Mongo backend (shares connection pattern with mongoJobStore) ===

const mongoUri = process.env.DATABASE_MONGODB_URI || process.env.MONGODB_URI;
const mongoDbName =
  process.env.DATABASE_MONGODB_DB ||
  process.env.MONGODB_DB ||
  'mediamake';
const mongoQueueCollectionName =
  process.env.MONGODB_QUEUE_JOBS_COLLECTION || 'queue_jobs';

let mongoClientPromise: Promise<MongoClient> | null = null;

async function getMongoClient(): Promise<MongoClient> {
  if (!mongoUri) {
    throw new Error(
      'MongoDB URI required for queue job store. Set DATABASE_MONGODB_URI or MONGODB_URI.'
    );
  }
  if (!mongoClientPromise) {
    mongoClientPromise = new MongoClient(mongoUri, {
      maxPoolSize: 10,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 10_000,
    }).connect();
  }
  return mongoClientPromise;
}

async function getMongoQueueCollection(): Promise<Collection<QueueJobDoc>> {
  const client = await getMongoClient();
  return client.db(mongoDbName).collection<QueueJobDoc>(mongoQueueCollectionName);
}

// === Redis backend (Upstash) ===

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

const defaultTtlSeconds = 60 * 60 * 24 * 7; // 7 days
const queueJobTtlSeconds =
  typeof process.env.WORKER_QUEUE_JOBS_TTL_SECONDS === 'string'
    ? parseInt(process.env.WORKER_QUEUE_JOBS_TTL_SECONDS, 10) || defaultTtlSeconds
    : typeof process.env.WORKER_JOBS_TTL_SECONDS === 'string'
      ? parseInt(process.env.WORKER_JOBS_TTL_SECONDS, 10) || defaultTtlSeconds
      : defaultTtlSeconds;

let redisClient: Redis | null = null;

function getRedis(): Redis {
  if (!redisUrl || !redisToken) {
    throw new Error(
      'Upstash Redis configuration missing for queue job store. Set WORKER_UPSTASH_REDIS_REST_URL and WORKER_UPSTASH_REDIS_REST_TOKEN (or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN).'
    );
  }
  if (!redisClient) {
    redisClient = new UpstashRedis({
      url: redisUrl,
      token: redisToken,
    });
  }
  return redisClient;
}

function queueKey(id: string): string {
  return `${queueKeyPrefix}${id}`;
}

type QueueJobRecord = Omit<QueueJobDoc, '_id'>;

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
  const d = data as Record<string, unknown>;
  const record: QueueJobRecord = {
    id: (d.id === undefined ? queueJobId : String(d.id)) as string,
    queueId: String(d.queueId ?? ''),
    status: (String(d.status ?? 'running') as QueueJobRecord['status']),
    steps: stepsFromHash(d.steps),
    metadata: metadataFromHash(d.metadata),
    createdAt: String(d.createdAt ?? new Date().toISOString()),
    updatedAt: String(d.updatedAt ?? new Date().toISOString()),
    completedAt: d.completedAt != null ? String(d.completedAt) : undefined,
  };
  return record;
}

async function saveQueueJobRedis(record: QueueJobRecord): Promise<void> {
  const redis = getRedis();
  const key = queueKey(record.id);
  const now = new Date().toISOString();
  const toSet: Record<string, string> = {
    id: record.id,
    queueId: record.queueId,
    status: record.status,
    steps: JSON.stringify(record.steps || []),
    metadata: JSON.stringify(record.metadata || {}),
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now,
  };
  if (record.completedAt) {
    toSet.completedAt = record.completedAt;
  }
  await redis.hset(key, toSet);
  if (queueJobTtlSeconds > 0) {
    await redis.expire(key, queueJobTtlSeconds);
  }
}

// === Backend selection ===

function getStoreType(): 'mongodb' | 'upstash-redis' {
  const t = (process.env.WORKER_DATABASE_TYPE || 'upstash-redis').toLowerCase();
  return t === 'mongodb' ? 'mongodb' : 'upstash-redis';
}

function preferMongo(): boolean {
  return getStoreType() === 'mongodb' && Boolean(mongoUri?.trim());
}

function preferRedis(): boolean {
  return getStoreType() !== 'mongodb' && Boolean((redisUrl || '').trim() && (redisToken || '').trim());
}

// === Public API used from handler.ts ===

export async function upsertInitialQueueJob(options: {
  queueJobId: string;
  queueId: string;
  firstWorkerId: string;
  firstWorkerJobId: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  const { queueJobId, queueId, firstWorkerId, firstWorkerJobId, metadata } = options;
  const now = new Date().toISOString();

  if (preferMongo()) {
    const coll = await getMongoQueueCollection();
    const existing = await coll.findOne({ _id: queueJobId });
    if (existing) {
      const steps = existing.steps ?? [];
      if (steps.length === 0) {
        steps.push({
          workerId: firstWorkerId,
          workerJobId: firstWorkerJobId,
          status: 'queued',
        });
      }
      await coll.updateOne(
        { _id: queueJobId },
        {
          $set: {
            steps,
            updatedAt: now,
          },
        }
      );
    } else {
      const doc: QueueJobDoc = {
        _id: queueJobId,
        id: queueJobId,
        queueId,
        status: 'running',
        steps: [
          {
            workerId: firstWorkerId,
            workerJobId: firstWorkerJobId,
            status: 'queued',
          },
        ],
        metadata: metadata ?? {},
        createdAt: now,
        updatedAt: now,
      };
      await coll.updateOne(
        { _id: queueJobId },
        { $set: doc },
        { upsert: true }
      );
    }
    return;
  }

  if (preferRedis()) {
    const existing = await loadQueueJobRedis(queueJobId);
    if (existing) {
      // Ensure we have at least one step
      if (!existing.steps || existing.steps.length === 0) {
        existing.steps = [
          {
            workerId: firstWorkerId,
            workerJobId: firstWorkerJobId,
            status: 'queued',
          },
        ];
      }
      existing.updatedAt = now;
      await saveQueueJobRedis(existing);
    } else {
      const record: QueueJobRecord = {
        id: queueJobId,
        queueId,
        status: 'running',
        steps: [
          {
            workerId: firstWorkerId,
            workerJobId: firstWorkerJobId,
            status: 'queued',
          },
        ],
        metadata: metadata ?? {},
        createdAt: now,
        updatedAt: now,
      };
      await saveQueueJobRedis(record);
    }
  }
}

export async function updateQueueJobStepInStore(options: {
  queueJobId: string;
  queueId?: string;
  stepIndex: number;
  workerId: string;
  workerJobId: string;
  status: 'running' | 'completed' | 'failed';
  input?: unknown;
  output?: unknown;
  error?: { message: string };
}): Promise<void> {
  const { queueJobId, stepIndex, status, input, output, error } = options;
  const now = new Date().toISOString();

  if (preferMongo()) {
    const coll = await getMongoQueueCollection();
    const existing = await coll.findOne({ _id: queueJobId });
    if (!existing) return;
    const step = existing.steps[stepIndex];
    if (!step) return;

    const mergedStep: QueueJobStep = {
      ...step,
      status,
      ...(input !== undefined && { input }),
      ...(output !== undefined && { output }),
      ...(error !== undefined && { error }),
      startedAt: step.startedAt ?? (status === 'running' ? now : step.startedAt),
      completedAt:
        step.completedAt ??
        (status === 'completed' || status === 'failed' ? now : step.completedAt),
    };

    const setDoc: Partial<QueueJobDoc> & { steps: QueueJobStep[] } = {
      steps: existing.steps,
      updatedAt: now,
    };
    setDoc.steps[stepIndex] = mergedStep;
    if (status === 'failed') {
      setDoc.status = 'failed';
      if (!existing.completedAt) setDoc.completedAt = now;
    } else if (status === 'completed' && stepIndex === existing.steps.length - 1) {
      setDoc.status = 'completed';
      if (!existing.completedAt) setDoc.completedAt = now;
    }

    await coll.updateOne(
      { _id: queueJobId },
      {
        $set: setDoc,
      }
    );
    return;
  }

  if (preferRedis()) {
    const existing = await loadQueueJobRedis(queueJobId);
    if (!existing) {
      // No queue job; nothing to update
      return;
    }
    const steps = existing.steps || [];
    const step = steps[stepIndex];
    if (!step) {
      return;
    }
    step.status = status;
    if (input !== undefined) step.input = input;
    if (output !== undefined) step.output = output;
    if (error !== undefined) step.error = error;
    if (status === 'running') {
      step.startedAt = step.startedAt ?? now;
    }
    if (status === 'completed' || status === 'failed') {
      step.completedAt = step.completedAt ?? now;
    }

    existing.steps = steps;
    existing.updatedAt = now;
    if (status === 'failed') {
      existing.status = 'failed';
      existing.completedAt = existing.completedAt ?? now;
    } else if (status === 'completed' && stepIndex === steps.length - 1) {
      existing.status = 'completed';
      existing.completedAt = existing.completedAt ?? now;
    }
    await saveQueueJobRedis(existing);
  }
}

export async function appendQueueJobStepInStore(options: {
  queueJobId: string;
  queueId?: string;
  workerId: string;
  workerJobId: string;
}): Promise<void> {
  const { queueJobId, workerId, workerJobId } = options;
  const now = new Date().toISOString();

  if (preferMongo()) {
    const coll = await getMongoQueueCollection();
    await coll.updateOne(
      { _id: queueJobId },
      {
        $push: {
          steps: {
            workerId,
            workerJobId,
            status: 'queued',
          } as QueueJobStep,
        },
        $set: { updatedAt: now },
      }
    );
    return;
  }

  if (preferRedis()) {
    const existing = await loadQueueJobRedis(queueJobId);
    if (!existing) return;
    const steps = existing.steps || [];
    steps.push({
      workerId,
      workerJobId,
      status: 'queued',
    });
    existing.steps = steps;
    existing.updatedAt = now;
    await saveQueueJobRedis(existing);
  }
}

/**
 * Load a queue job by ID (for mapping context: previous step outputs).
 * Used by wrapHandlerForQueue when invoking mapInputFromPrev with previousOutputs.
 */
export async function getQueueJob(queueJobId: string): Promise<{
  id: string;
  queueId: string;
  status: string;
  steps: Array<{ workerId: string; workerJobId: string; status: string; output?: unknown }>;
} | null> {
  if (preferMongo()) {
    const coll = await getMongoQueueCollection();
    const doc = await coll.findOne({ _id: queueJobId });
    if (!doc) return null;
    return {
      id: doc.id ?? queueJobId,
      queueId: doc.queueId,
      status: doc.status,
      steps: (doc.steps ?? []).map((s: QueueJobStep) => ({
        workerId: s.workerId,
        workerJobId: s.workerJobId,
        status: s.status,
        output: s.output,
      })),
    };
  }
  if (preferRedis()) {
    const record = await loadQueueJobRedis(queueJobId);
    if (!record) return null;
    return {
      id: record.id,
      queueId: record.queueId,
      status: record.status,
      steps: (record.steps ?? []).map((s) => ({
        workerId: s.workerId,
        workerJobId: s.workerJobId,
        status: s.status,
        output: s.output,
      })),
    };
  }
  return null;
}

