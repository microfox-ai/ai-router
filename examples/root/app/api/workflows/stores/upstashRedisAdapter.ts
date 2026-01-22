/**
 * Upstash Redis adapter for job store.
 * 
 * Provides persistent storage for worker job state using Upstash Redis.
 * 
 * Configuration (from microfox.config.ts or env vars):
 * - studioSettings.database.upstashRedis.url or UPSTASH_REDIS_REST_URL: Redis REST URL
 * - studioSettings.database.upstashRedis.token or UPSTASH_REDIS_REST_TOKEN: Redis REST token
 * - studioSettings.database.upstashRedis.keyPrefix: Key prefix (default: 'workflow:jobs:')
 * 
 * Environment variables (fallback):
 * - UPSTASH_REDIS_REST_URL: Redis REST URL (required)
 * - UPSTASH_REDIS_REST_TOKEN: Redis REST token (required)
 * - UPSTASH_REDIS_KEY_PREFIX: Key prefix (default: 'workflow:jobs:')
 */

'use server';

import { Redis } from '@upstash/redis';
import type { JobRecord } from './jobStore';

let redisClient: Redis | null = null;

function getRedisClient(): Redis {
  if (redisClient) {
    return redisClient;
  }

  // Try to get config from microfox.config.ts first, fallback to env vars
  let url: string | undefined;
  let token: string | undefined;
  let keyPrefix = 'workflow:jobs:';

  try {
    const config = require('@/microfox.config').StudioConfig;
    const dbConfig = config?.studioSettings?.database;
    
    if (dbConfig?.upstashRedis) {
      url = dbConfig.upstashRedis.url;
      token = dbConfig.upstashRedis.token;
      keyPrefix = dbConfig.upstashRedis.keyPrefix || keyPrefix;
    }
  } catch (error) {
    // Config not available, use env vars
  }

  // Fallback to environment variables (support both naming conventions)
  url = url || process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_URL;
  token = token || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_TOKEN;
  keyPrefix = process.env.UPSTASH_REDIS_KEY_PREFIX || keyPrefix;

  if (!url || !token) {
    throw new Error(
      'Missing Upstash Redis configuration. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN ' +
      'in environment variables or configure in microfox.config.ts -> studioSettings.database.upstashRedis'
    );
  }

  redisClient = new Redis({
    url,
    token,
  });

  return redisClient;
}

function getKeyPrefix(): string {
  try {
    const config = require('@/microfox.config').StudioConfig;
    return config?.studioSettings?.database?.upstashRedis?.keyPrefix || process.env.UPSTASH_REDIS_KEY_PREFIX || 'workflow:jobs:';
  } catch {
    return process.env.UPSTASH_REDIS_KEY_PREFIX || 'workflow:jobs:';
  }
}

function getKey(jobId: string): string {
  return `${getKeyPrefix()}${jobId}`;
}

function getWorkerIndexKey(workerId: string): string {
  return `${getKeyPrefix()}worker:${workerId}`;
}

/**
 * Upstash Redis storage adapter for job store.
 */
export const upstashRedisJobStore = {
  async setJob(jobId: string, data: Partial<JobRecord>): Promise<void> {
    const redis = getRedisClient();
    const now = new Date().toISOString();
    const key = getKey(jobId);
    
    // Get existing record
    const existingStr = await redis.get<string>(key);
    const existing: JobRecord | null = existingStr ? JSON.parse(existingStr) : null;
    
    const record: JobRecord = {
      jobId,
      workerId: data.workerId || existing?.workerId || '',
      status: data.status || existing?.status || 'queued',
      input: data.input !== undefined ? data.input : existing?.input || {},
      output: data.output !== undefined ? data.output : existing?.output,
      error: data.error !== undefined ? data.error : existing?.error,
      metadata: { ...existing?.metadata, ...data.metadata },
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      completedAt: data.completedAt || existing?.completedAt,
    };

    // Set completedAt if status changed to completed/failed
    if (data.status && ['completed', 'failed'].includes(data.status) && !record.completedAt) {
      record.completedAt = now;
    }

    // Store job record
    await redis.set(key, JSON.stringify(record), { ex: 7 * 24 * 60 * 60 }); // 7 days TTL

    // Update worker index (sorted set for efficient querying)
    const workerIndexKey = getWorkerIndexKey(record.workerId);
    const score = new Date(record.createdAt).getTime();
    await redis.zadd(workerIndexKey, { score, member: jobId });
    await redis.expire(workerIndexKey, 7 * 24 * 60 * 60); // 7 days TTL
  },

  async getJob(jobId: string): Promise<JobRecord | null> {
    const redis = getRedisClient();
    const key = getKey(jobId);
    const recordStr = await redis.get<string>(key);
    
    if (!recordStr) {
      return null;
    }

    return JSON.parse(recordStr) as JobRecord;
  },

  async updateJob(jobId: string, data: Partial<JobRecord>): Promise<void> {
    const redis = getRedisClient();
    const key = getKey(jobId);
    const existingStr = await redis.get<string>(key);
    
    if (!existingStr) {
      throw new Error(`Job ${jobId} not found`);
    }

    const existing: JobRecord = JSON.parse(existingStr);
    const now = new Date().toISOString();
    
    const updated: JobRecord = {
      ...existing,
      ...data,
      updatedAt: now,
    };

    // Set completedAt if status changed to completed/failed
    if (data.status && ['completed', 'failed'].includes(data.status) && !existing.completedAt) {
      updated.completedAt = now;
    }

    // Update job record
    await redis.set(key, JSON.stringify(updated), { ex: 7 * 24 * 60 * 60 }); // 7 days TTL
  },

  async listJobsByWorker(workerId: string): Promise<JobRecord[]> {
    const redis = getRedisClient();
    const workerIndexKey = getWorkerIndexKey(workerId);
    
    // Get all job IDs for this worker (sorted by creation time, descending)
    const jobIds = await redis.zrange<string[]>(workerIndexKey, 0, -1, { rev: true });
    
    if (!jobIds || jobIds.length === 0) {
      return [];
    }

    // Fetch all job records
    const keys = jobIds.map((id: string) => getKey(id));
    const records = await redis.mget<Array<string | null>>(keys);
    
    // Parse and filter out nulls
    const jobs: JobRecord[] = [];
    for (let i = 0; i < records.length; i++) {
      const recordStr = records[i];
      if (recordStr) {
        try {
          const record = JSON.parse(recordStr) as JobRecord;
          if (record.workerId === workerId) {
            jobs.push(record);
          }
        } catch (error) {
          // Skip invalid records
        }
      }
    }

    // Sort by createdAt (descending - newest first)
    jobs.sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return bTime - aTime;
    });

    return jobs;
  },
};
