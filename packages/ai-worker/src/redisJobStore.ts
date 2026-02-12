import { Redis } from '@upstash/redis';
import type { JobStore, JobStoreUpdate, JobRecord } from './handler';

// Canonical: WORKER_* first, then UPSTASH_* / REDIS_* / WORKFLOW_* fallbacks
const redisUrl =
  process.env.WORKER_UPSTASH_REDIS_REST_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.UPSTASH_REDIS_URL;
const redisToken =
  process.env.WORKER_UPSTASH_REDIS_REST_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.UPSTASH_REDIS_TOKEN;
const jobKeyPrefix =
  process.env.WORKER_UPSTASH_REDIS_JOBS_PREFIX ||
  process.env.UPSTASH_REDIS_KEY_PREFIX ||
  process.env.REDIS_WORKER_JOB_PREFIX ||
  'worker:jobs:';
const defaultTtlSeconds = 60 * 60 * 24 * 7; // 7 days
const jobTtlSeconds =
  typeof process.env.WORKER_JOBS_TTL_SECONDS === 'string'
    ? parseInt(process.env.WORKER_JOBS_TTL_SECONDS, 10) || defaultTtlSeconds
    : typeof process.env.REDIS_WORKER_JOB_TTL_SECONDS === 'string'
      ? parseInt(process.env.REDIS_WORKER_JOB_TTL_SECONDS, 10) || defaultTtlSeconds
      : typeof process.env.WORKFLOW_JOBS_TTL_SECONDS === 'string'
        ? parseInt(process.env.WORKFLOW_JOBS_TTL_SECONDS, 10) || defaultTtlSeconds
        : defaultTtlSeconds;

let redisClient: Redis | null = null;

function getRedis(): Redis {
  if (!redisUrl || !redisToken) {
    throw new Error(
      'Upstash Redis configuration missing. Set WORKER_UPSTASH_REDIS_REST_URL and WORKER_UPSTASH_REDIS_REST_TOKEN (or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN).'
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

function jobKey(jobId: string): string {
  return `${jobKeyPrefix}${jobId}`;
}

/** Separate LIST key for internal job refs; each RPUSH is atomic so no race when appending multiple. */
function internalListKey(jobId: string): string {
  return `${jobKeyPrefix}${jobId}:internal`;
}

export function isRedisJobStoreConfigured(): boolean {
  return Boolean((redisUrl || '').trim() && (redisToken || '').trim());
}

/** Load a job by id (read-only). Used for idempotency check before processing. */
export async function loadJob(jobId: string): Promise<JobRecord | null> {
  const redis = getRedis();
  const key = jobKey(jobId);
  const data = await redis.hgetall<Record<string, string>>(key);
  if (!data || Object.keys(data).length === 0) return null;
  const parseJson = <T>(val?: string | null): T | undefined => {
    if (!val) return undefined;
    try {
      return JSON.parse(val) as T;
    } catch {
      return undefined;
    }
  };
  // Prefer atomic list key for internal jobs; fallback to hash field for old records
  const listKey = internalListKey(jobId);
  const listItems = await redis.lrange<string>(listKey, 0, -1);
  let internalJobs: Array<{ jobId: string; workerId: string }> | undefined;
  if (listItems && listItems.length > 0) {
    internalJobs = listItems.map((s) => {
      try {
        return JSON.parse(s) as { jobId: string; workerId: string };
      } catch {
        return null;
      }
    }).filter(Boolean) as Array<{ jobId: string; workerId: string }>;
  } else {
    internalJobs = parseJson<Array<{ jobId: string; workerId: string }>>(data.internalJobs);
  }
  const record: JobRecord = {
    jobId: data.jobId,
    workerId: data.workerId,
    status: (data.status as JobRecord['status']) || 'queued',
    input: parseJson<any>(data.input) ?? {},
    output: parseJson<any>(data.output),
    error: parseJson<any>(data.error),
    metadata: parseJson<Record<string, any>>(data.metadata) ?? {},
    internalJobs,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    completedAt: data.completedAt,
  };
  return record;
}

export function createRedisJobStore(
  workerId: string,
  jobId: string,
  input: any,
  metadata: Record<string, any>
): JobStore {
  return {
    update: async (update: JobStoreUpdate): Promise<void> => {
      const redis = getRedis();
      const key = jobKey(jobId);
      const now = new Date().toISOString();

      // Load existing to merge metadata/progress if needed
      const existing = await loadJob(jobId);
      const next: Partial<JobRecord> = {};

      // Start from existing metadata
      const mergedMeta: Record<string, any> = { ...(existing?.metadata ?? {}) };
      if (update.metadata) {
        Object.assign(mergedMeta, update.metadata);
      }
      if (update.progress !== undefined || update.progressMessage !== undefined) {
        mergedMeta.progress = update.progress;
        mergedMeta.progressMessage = update.progressMessage;
      }

      next.metadata = mergedMeta;
      if (update.status !== undefined) {
        next.status = update.error ? 'failed' : update.status;
        if ((update.status === 'completed' || update.status === 'failed') && !existing?.completedAt) {
          next.completedAt = now;
        }
      }
      if (update.output !== undefined) next.output = update.output;
      if (update.error !== undefined) next.error = update.error;

      const toSet: Record<string, string> = {};
      if (next.status) toSet['status'] = String(next.status);
      if (next.output !== undefined) toSet['output'] = JSON.stringify(next.output);
      if (next.error !== undefined) toSet['error'] = JSON.stringify(next.error);
      if (next.metadata !== undefined) toSet['metadata'] = JSON.stringify(next.metadata);
      if (next.completedAt) {
        toSet['completedAt'] = next.completedAt;
      }
      toSet['updatedAt'] = now;

      await redis.hset(key, toSet);
      if (jobTtlSeconds > 0) {
        await redis.expire(key, jobTtlSeconds);
      }
    },
    get: async () => {
      return loadJob(jobId);
    },
    appendInternalJob: async (entry) => {
      const redis = getRedis();
      const listKey = internalListKey(jobId);
      await redis.rpush(listKey, JSON.stringify(entry));
      const mainKey = jobKey(jobId);
      await redis.hset(mainKey, { updatedAt: new Date().toISOString() });
      if (jobTtlSeconds > 0) {
        await redis.expire(listKey, jobTtlSeconds);
        await redis.expire(mainKey, jobTtlSeconds);
      }
    },
    getJob: async (otherJobId: string) => {
      return loadJob(otherJobId);
    },
  };
}

export async function upsertRedisJob(
  jobId: string,
  workerId: string,
  input: any,
  metadata: Record<string, any>
): Promise<void> {
  const redis = getRedis();
  const key = jobKey(jobId);
  const now = new Date().toISOString();
  const doc: Partial<JobRecord> = {
    jobId,
    workerId,
    status: 'queued',
    input,
    metadata,
    createdAt: now,
    updatedAt: now,
  };
  const toSet: Record<string, string> = {
    jobId: jobId,
    workerId: workerId,
    status: doc.status!,
    input: JSON.stringify(doc.input ?? {}),
    metadata: JSON.stringify(doc.metadata ?? {}),
    createdAt: now,
    updatedAt: now,
  };
  await redis.hset(key, toSet);
  if (jobTtlSeconds > 0) {
    await redis.expire(key, jobTtlSeconds);
  }
}

