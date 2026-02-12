/**
 * Upstash Redis adapter for workflow/worker job store.
 *
 * Uses a hash-per-job model with key-level TTL for fast lookups by jobId.
 *
 * Configuration (from microfox.config.ts or env vars):
 * - workflowSettings.jobStore.redis; env: WORKER_UPSTASH_REDIS_REST_URL, WORKER_UPSTASH_REDIS_REST_TOKEN,
 *   WORKER_UPSTASH_REDIS_JOBS_PREFIX (default: worker:jobs:), WORKER_JOBS_TTL_SECONDS
 */

import { Redis } from '@upstash/redis';
import type { JobRecord, InternalJobEntry } from './jobStore';

let redisClient: Redis | null = null;
let redisUrl: string | undefined;
let redisToken: string | undefined;
let jobKeyPrefix: string = 'worker:jobs:';
const defaultTtlSeconds = 60 * 60 * 24 * 7; // 7 days

function loadConfig() {
  try {
    // Prefer config from microfox.config.ts if present
    const config = require('@/microfox.config').StudioConfig as {
      workflowSettings?: {
        jobStore?: {
          redis?: {
            url?: string;
            token?: string;
            keyPrefix?: string;
            ttlSeconds?: number;
          };
        };
      };
    };
    const redisCfg = config?.workflowSettings?.jobStore?.redis;
    redisUrl = redisCfg?.url || redisUrl;
    redisToken = redisCfg?.token || redisToken;
    if (redisCfg?.keyPrefix) {
      jobKeyPrefix = redisCfg.keyPrefix;
    }
  } catch {
    // Config optional; fall back to env vars
  }

  redisUrl =
    redisUrl ||
    process.env.WORKER_UPSTASH_REDIS_REST_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.UPSTASH_REDIS_URL;
  redisToken =
    redisToken ||
    process.env.WORKER_UPSTASH_REDIS_REST_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.UPSTASH_REDIS_TOKEN;
  jobKeyPrefix =
    jobKeyPrefix ||
    process.env.WORKER_UPSTASH_REDIS_JOBS_PREFIX ||
    process.env.UPSTASH_REDIS_KEY_PREFIX ||
    'worker:jobs:';
}

function getRedis(): Redis {
  if (!redisClient) {
    loadConfig();
    if (!redisUrl || !redisToken) {
      throw new Error(
        'Missing Upstash Redis configuration. Set workflowSettings.jobStore.redis in microfox.config.ts or WORKER_UPSTASH_REDIS_REST_URL / WORKER_UPSTASH_REDIS_REST_TOKEN (or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).'
      );
    }
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

function workerIndexKey(workerId: string): string {
  // Secondary index: worker -> set of jobIds
  return `${jobKeyPrefix}by-worker:${workerId}`;
}

function getJobTtlSeconds(): number {
  const raw =
    process.env.WORKER_JOBS_TTL_SECONDS || process.env.WORKFLOW_JOBS_TTL_SECONDS;
  if (!raw) return defaultTtlSeconds;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultTtlSeconds;
}

async function loadJob(jobId: string): Promise<JobRecord | null> {
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
  const listItems = (await redis.lrange(listKey, 0, -1)) ?? [];
  let internalJobs: InternalJobEntry[] | undefined;
  if (listItems.length > 0) {
    internalJobs = listItems
      .map((s) => {
        try {
          return JSON.parse(s) as InternalJobEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is InternalJobEntry => e != null);
  } else {
    internalJobs = parseJson<InternalJobEntry[]>(data.internalJobs);
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

export const redisJobStore = {
  async setJob(jobId: string, data: Partial<JobRecord>): Promise<void> {
    const redis = getRedis();
    const key = jobKey(jobId);
    const now = new Date().toISOString();

    const existing = await loadJob(jobId);

    const record: JobRecord = {
      jobId,
      workerId: data.workerId || existing?.workerId || '',
      status: data.status || existing?.status || 'queued',
      input: data.input !== undefined ? data.input : existing?.input || {},
      output: data.output !== undefined ? data.output : existing?.output,
      error: data.error !== undefined ? data.error : existing?.error,
      metadata: { ...(existing?.metadata || {}), ...(data.metadata || {}) },
      internalJobs: existing?.internalJobs,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      completedAt: data.completedAt || existing?.completedAt,
    };

    if (data.status && ['completed', 'failed'].includes(data.status) && !record.completedAt) {
      record.completedAt = now;
    }

    const toSet: Record<string, string> = {
      jobId: record.jobId,
      workerId: record.workerId,
      status: record.status,
      input: JSON.stringify(record.input ?? {}),
      metadata: JSON.stringify(record.metadata ?? {}),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
    if (record.output !== undefined) {
      toSet.output = JSON.stringify(record.output);
    }
    if (record.error !== undefined) {
      toSet.error = JSON.stringify(record.error);
    }
    if (record.internalJobs) {
      toSet.internalJobs = JSON.stringify(record.internalJobs);
    }
    if (record.completedAt) {
      toSet.completedAt = record.completedAt;
    }

    await redis.hset(key, toSet);
    const ttl = getJobTtlSeconds();
    if (ttl > 0) {
      await redis.expire(key, ttl);
    }

    // Maintain secondary index per worker
    if (record.workerId) {
      await redis.sadd(workerIndexKey(record.workerId), jobId);
    }
  },

  async getJob(jobId: string): Promise<JobRecord | null> {
    return loadJob(jobId);
  },

  async updateJob(jobId: string, data: Partial<JobRecord>): Promise<void> {
    const redis = getRedis();
    const key = jobKey(jobId);
    const existing = await loadJob(jobId);
    if (!existing) {
      throw new Error(`Job ${jobId} not found`);
    }

    const now = new Date().toISOString();
    const update: Partial<JobRecord> = {
      updatedAt: now,
    };

    if (data.status !== undefined) {
      update.status = data.status;
      if (['completed', 'failed'].includes(data.status) && !existing.completedAt) {
        update.completedAt = now;
      }
    }
    if (data.output !== undefined) {
      update.output = data.output;
    }
    if (data.error !== undefined) {
      update.error = data.error;
    }
    if (data.metadata !== undefined) {
      update.metadata = { ...(existing.metadata || {}), ...data.metadata };
    }

    const toSet: Record<string, string> = {
      updatedAt: now,
    };
    if (update.status !== undefined) {
      toSet.status = update.status;
    }
    if (update.output !== undefined) {
      toSet.output = JSON.stringify(update.output);
    }
    if (update.error !== undefined) {
      toSet.error = JSON.stringify(update.error);
    }
    if (update.metadata !== undefined) {
      toSet.metadata = JSON.stringify(update.metadata);
    }
    if (update.completedAt) {
      toSet.completedAt = update.completedAt;
    }

    await redis.hset(key, toSet);
    const ttl = getJobTtlSeconds();
    if (ttl > 0) {
      await redis.expire(key, ttl);
    }
  },

  async appendInternalJob(parentJobId: string, entry: InternalJobEntry): Promise<void> {
    const redis = getRedis();
    const listKey = internalListKey(parentJobId);
    await redis.rpush(listKey, JSON.stringify(entry));
    const mainKey = jobKey(parentJobId);
    await redis.hset(mainKey, { updatedAt: new Date().toISOString() });
    const ttl = getJobTtlSeconds();
    if (ttl > 0) {
      await redis.expire(listKey, ttl);
      await redis.expire(mainKey, ttl);
    }
  },

  async listJobsByWorker(workerId: string): Promise<JobRecord[]> {
    const redis = getRedis();
    const indexKey = workerIndexKey(workerId);
    const jobIds = (await redis.smembers(indexKey)) ?? [];
    const jobs: JobRecord[] = [];
    for (const jobId of jobIds) {
      const job = await loadJob(jobId);
      if (job) {
        jobs.push(job);
      }
    }
    // Most recent first
    jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return jobs;
  },
};

