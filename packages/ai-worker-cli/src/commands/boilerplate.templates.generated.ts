/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Boilerplate templates synced from examples/root by scripts/sync-boilerplate.mjs.
 * To change a template, edit the source file in examples/root and run:
 *
 *   npm run sync-boilerplate   (from packages/ai-worker-cli)
 */

export const TEMPLATES: Record<string, string> = {
  "auth.ts": `import * as crypto from 'node:crypto';
import type { NextRequest } from 'next/server';

/**
 * Returns the ID of the currently authenticated user for the given request.
 *
 * Replace this stub with your actual auth logic, for example:
 *   - Parse a JWT from the Authorization header
 *   - Read a session cookie (e.g. NextAuth, Clerk, Supabase)
 *   - Call your auth provider's SDK
 *
 * Returning \`undefined\` means no userId is attached to the worker job.
 *
 * @example with NextAuth
 * \`\`\`ts
 * import { getServerSession } from 'next-auth';
 * import { authOptions } from '@/app/api/auth/[...nextauth]/route';
 * export async function getClientId(req: NextRequest): Promise<string | undefined> {
 *   const session = await getServerSession(authOptions);
 *   return session?.user?.id;
 * }
 * \`\`\`
 */
export async function getClientId(_req: NextRequest): Promise<string | undefined> {
  // TODO: implement your auth logic here
  return "test-static-user";
}

/** Constant-time string comparison (avoids leaking the secret via timing). */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export type WorkflowAuthResult =
  | { ok: true; userId?: string; via: 'user' | 'internal' | 'public' }
  | { ok: false; status: number; error: string };

/**
 * Authorizes a **mutating** workflow request (trigger / update / webhook / approve / job).
 *
 * SECURITY: these routes mutate job + queue state and, for HITL approval,
 * dispatch the next pipeline step with reviewer-supplied input. They MUST NOT be
 * open to anonymous callers in production. A request is authorized when ANY of:
 *
 *   1. \`getClientId(req)\` resolves a user  → a real end-user session. **You must
 *      implement getClientId above for this to ever succeed.**
 *   2. It carries the internal shared secret (\`x-workflow-secret\` header equal to
 *      \`WORKFLOW_INTERNAL_SECRET\`, or \`WORKERS_API_KEY\` as a fallback so a single shared
 *      secret can cover both surfaces) → trusted Lambda→app callbacks (webhook/update).
 *      The deployed worker runtime sends this header when the env var is set.
 *   3. \`WORKFLOW_ALLOW_PUBLIC === 'true'\` → explicit opt-out for local demos. Logs a
 *      warning. **Never set this in production.**
 *
 * Otherwise the request is rejected with 401.
 */
export async function authorizeWorkflowRequest(
  req: NextRequest
): Promise<WorkflowAuthResult> {
  const userId = await getClientId(req);
  if (userId) return { ok: true, userId, via: 'user' };

  // Use a dedicated WORKFLOW_INTERNAL_SECRET if set, otherwise reuse WORKERS_API_KEY so a
  // single shared secret can gate both the deployed endpoints and these callback routes.
  const secret = process.env.WORKFLOW_INTERNAL_SECRET || process.env.WORKERS_API_KEY;
  if (secret && secret.trim()) {
    const provided =
      req.headers.get('x-workflow-secret') ||
      req.headers.get('X-Workflow-Secret') ||
      '';
    if (timingSafeEqualStr(provided, secret.trim())) {
      return { ok: true, via: 'internal' };
    }
  }

  if (process.env.WORKFLOW_ALLOW_PUBLIC === 'true') {
    console.warn(
      '[workflow-auth] Request allowed without authentication (WORKFLOW_ALLOW_PUBLIC=true). ' +
        'Do not use this in production — implement getClientId() and/or set WORKFLOW_INTERNAL_SECRET.'
    );
    return { ok: true, via: 'public' };
  }

  return {
    ok: false,
    status: 401,
    error:
      'Unauthorized. Implement getClientId() in app/api/workflows/auth.ts, send the ' +
      'x-workflow-secret header (WORKFLOW_INTERNAL_SECRET or WORKERS_API_KEY) for internal ' +
      'callbacks, or set WORKFLOW_ALLOW_PUBLIC=true for local development.',
  };
}
`,

  "stores/jobStore.ts": `/**
 * Job store for tracking worker job status and results.
 *
 * Always uses MongoDB. Workers run on AWS Lambda and update jobs via the API;
 * in-memory storage is not shared across processes, so a persistent store is required.
 *
 * Configure via \`microfox.config.ts\` -> \`workflowSettings.jobStore\` or env:
 * - WORKER_DATABASE_TYPE: 'mongodb' | 'upstash-redis' (default: upstash-redis),
 *   or 'local' in development to proxy to a running \`ai-worker dev\` server
 * - DATABASE_MONGODB_URI or MONGODB_URI (required for mongodb)
 * - DATABASE_MONGODB_DB or MONGODB_DB; MONGODB_WORKER_JOBS_COLLECTION (default: worker_jobs)
 * - WORKER_UPSTASH_REDIS_* / WORKER_JOBS_TTL_SECONDS for Redis
 *
 * Job record structure:
 * {
 *   jobId: string,
 *   workerId: string,
 *   status: 'queued' | 'running' | 'completed' | 'failed',
 *   input: any,
 *   output?: any,
 *   error?: { message: string, stack?: string },
 *   metadata?: Record<string, any>,
 *   createdAt: string,
 *   updatedAt: string,
 *   completedAt?: string
 * }
 */

export interface InternalJobEntry {
  jobId: string;
  workerId: string;
  /** Whether the parent awaited this child (dispatchWorker await:true) or fired it and moved on.
   * Written by the @microfox/ai-worker runtime; surfaced in run traces to distinguish the two. */
  awaited?: boolean;
  /** SQS DelaySeconds the parent set on a fire-and-forget dispatch, if any. */
  delaySeconds?: number;
}

export interface JobRecord {
  jobId: string;
  workerId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  input: any;
  output?: any;
  error?: {
    message: string;
    stack?: string;
  };
  metadata?: Record<string, any>;
  internalJobs?: InternalJobEntry[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// Storage adapter interface
interface JobStoreAdapter {
  setJob(jobId: string, data: Partial<JobRecord>): Promise<void>;
  getJob(jobId: string): Promise<JobRecord | null>;
  updateJob(jobId: string, data: Partial<JobRecord>): Promise<void>;
  appendInternalJob(parentJobId: string, entry: InternalJobEntry): Promise<void>;
  listJobsByWorker(workerId: string): Promise<JobRecord[]>;
}

// Job store can use MongoDB or Upstash Redis (workers run on Lambda; no in-memory fallback).
function getStorageAdapter(): JobStoreAdapter {
  try {
    // Prefer workflowSettings.jobStore.type from microfox.config.ts; env fallback: WORKER_DATABASE_TYPE
    let jobStoreType: string | undefined;
    try {
      const config = require('@/microfox.config').StudioConfig as {
        workflowSettings?: { jobStore?: { type?: string } };
      };
      jobStoreType = config?.workflowSettings?.jobStore?.type;
    } catch {
      // Config missing or not resolvable; fall back to env
    }
    jobStoreType = jobStoreType || process.env.WORKER_DATABASE_TYPE || 'upstash-redis';
    const normalized = jobStoreType.toLowerCase();

    // DEV ONLY: workers run in-process under \`ai-worker dev\` with its local
    // file-persisted store; reads/writes proxy to the dev server over HTTP.
    if (normalized === 'local') {
      const { localDevJobStore } = require('./localDevAdapter');
      console.log('[JobStore] Ready (local ai-worker dev server via WORKER_BASE_URL)');
      return localDevJobStore;
    }

    if (normalized === 'upstash-redis' || normalized === 'redis') {
      const { redisJobStore } = require('./redisAdapter');
      console.log('[JobStore] Ready (Upstash Redis)');
      return redisJobStore;
    }

    const { mongoJobStore } = require('./mongoAdapter');
    console.log('[JobStore] Ready (MongoDB)');
    return mongoJobStore;
  } catch (error: any) {
    const msg = error?.message || String(error);
    console.error('[JobStore] Job store adapter required (workers run on Lambda).', { error: msg });
    throw new Error(
      'Job store requires a persistent backend. Set workflowSettings.jobStore.type or WORKER_DATABASE_TYPE to "mongodb" or "upstash-redis", and set the corresponding connection settings. ' +
        \`Details: \${msg}\`
    );
  }
}

// Lazy-loaded storage adapter
let storageAdapter: JobStoreAdapter | null = null;
function getAdapter(): JobStoreAdapter {
  if (!storageAdapter) {
    storageAdapter = getStorageAdapter();
  }
  return storageAdapter;
}

/**
 * Store a job record.
 */
export async function setJob(jobId: string, data: Partial<JobRecord>): Promise<void> {
  try {
    const adapter = getAdapter();
    await adapter.setJob(jobId, data);
  } catch (error: any) {
    console.error('[JobStore] Error setting job:', {
      jobId,
      error: error?.message || String(error),
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
    throw error;
  }
}

/**
 * Get a job record.
 */
export async function getJob(jobId: string): Promise<JobRecord | null> {
  try {
    const adapter = getAdapter();
    return await adapter.getJob(jobId);
  } catch (error: any) {
    console.error('[JobStore] Error getting job:', {
      jobId,
      error: error?.message || String(error),
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
    throw error;
  }
}

/**
 * Update a job record.
 */
export async function updateJob(jobId: string, data: Partial<JobRecord>): Promise<void> {
  try {
    const adapter = getAdapter();
    await adapter.updateJob(jobId, data);
  } catch (error: any) {
    console.error('[JobStore] Error updating job:', {
      jobId,
      updates: Object.keys(data),
      error: error?.message || String(error),
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
    throw error;
  }
}

/**
 * Append an internal (child) job to a parent job's internalJobs list.
 * Used when a worker dispatches another worker (ctx.dispatchWorker).
 */
export async function appendInternalJob(
  parentJobId: string,
  entry: InternalJobEntry
): Promise<void> {
  try {
    const adapter = getAdapter();
    await adapter.appendInternalJob(parentJobId, entry);
  } catch (error: any) {
    console.error('[JobStore] Error appending internal job:', {
      parentJobId,
      entry,
      error: error?.message || String(error),
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
    throw error;
  }
}

/**
 * List jobs by worker ID.
 */
export async function listJobsByWorker(workerId: string): Promise<JobRecord[]> {
  try {
    const adapter = getAdapter();
    return await adapter.listJobsByWorker(workerId);
  } catch (error: any) {
    console.error('[JobStore] Error listing jobs by worker:', {
      workerId,
      error: error?.message || String(error),
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
    throw error;
  }
}
`,

  "stores/mongoAdapter.ts": `/**
 * MongoDB adapter for job store.
 *
 * Provides persistent storage for worker job state using MongoDB.
 *
 * Configuration (from microfox.config.ts or env vars):
 * - workflowSettings.jobStore.mongodb.uri or DATABASE_MONGODB_URI/MONGODB_URI: MongoDB connection string
 * - workflowSettings.jobStore.mongodb.db or DATABASE_MONGODB_DB/MONGODB_DB: Database name (default: 'ai_router')
 *
 * Collection name: config -> workflowSettings.jobStore.mongodb.workerJobsCollection
 * (default: 'worker_jobs'). Env: MONGODB_WORKER_JOBS_COLLECTION then DATABASE_MONGODB_WORKER_JOBS_COLLECTION.
 */

import { MongoClient, type Db, type Collection } from 'mongodb';
import type { JobRecord, InternalJobEntry } from './jobStore';

declare global {
  // eslint-disable-next-line no-var
  var __workflowMongoClientPromise: Promise<MongoClient> | undefined;
}

function getMongoUri(): string {
  // Try to get from config first, fallback to env vars
  let uri: string | undefined;
  try {
    const config = require('@/microfox.config').StudioConfig as {
      workflowSettings?: { jobStore?: { mongodb?: { uri?: string } } };
    };
    uri = config?.workflowSettings?.jobStore?.mongodb?.uri;
  } catch (error) {
    // Config not available, use env vars
  }
  
  uri = uri || process.env.DATABASE_MONGODB_URI || process.env.MONGODB_URI;
  
  if (!uri) {
    throw new Error(
      'Missing MongoDB connection string. Set workflowSettings.jobStore.mongodb.uri in microfox.config.ts or environment variable DATABASE_MONGODB_URI or MONGODB_URI.'
    );
  }
  return uri;
}

function getMongoDbName(): string {
  // Try to get from config first, fallback to env vars
  let dbName: string | undefined;
  try {
    const config = require('@/microfox.config').StudioConfig as {
      workflowSettings?: { jobStore?: { mongodb?: { db?: string } } };
    };
    dbName = config?.workflowSettings?.jobStore?.mongodb?.db;
  } catch (error) {
    // Config not available, use env vars
  }
  
  return dbName || process.env.DATABASE_MONGODB_DB || process.env.MONGODB_DB || 'ai_router';
}

function getWorkerJobsCollection(): string {
  let collection: string | undefined;
  try {
    const config = require('@/microfox.config').StudioConfig as {
      workflowSettings?: { jobStore?: { mongodb?: { workerJobsCollection?: string } } };
    };
    collection = config?.workflowSettings?.jobStore?.mongodb?.workerJobsCollection;
  } catch {
    // Config not available
  }
  return (
    collection ||
    process.env.MONGODB_WORKER_JOBS_COLLECTION ||
    process.env.DATABASE_MONGODB_WORKER_JOBS_COLLECTION ||
    'worker_jobs'
  );
}

async function getMongoClient(): Promise<MongoClient> {
  const uri = getMongoUri();

  // Reuse a single client across hot reloads / lambda invocations when possible.
  if (!globalThis.__workflowMongoClientPromise) {
    const client = new MongoClient(uri, {
      // Keep defaults conservative; works on both local dev and Lambda.
      maxPoolSize: 10,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 10_000,
    });
    globalThis.__workflowMongoClientPromise = client.connect();
  }

  return globalThis.__workflowMongoClientPromise;
}

async function getMongoDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(getMongoDbName());
}

/** Export for queue job store (shared MongoDB connection). */
export async function getWorkflowDb(): Promise<Db> {
  return getMongoDb();
}

async function getCollection(): Promise<Collection<JobRecord & { _id: string }>> {
  const db = await getMongoDb();
  return db.collection<JobRecord & { _id: string }>(getWorkerJobsCollection());
}

/**
 * MongoDB storage adapter for job store.
 */
export const mongoJobStore = {
  async setJob(jobId: string, data: Partial<JobRecord>): Promise<void> {
    const now = new Date().toISOString();
    const collection = await getCollection();
    
    const existing = await collection.findOne({ _id: jobId });
    
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

    await collection.updateOne(
      { _id: jobId },
      {
        $set: {
          ...record,
          _id: jobId,
        },
      },
      { upsert: true }
    );
  },

  async getJob(jobId: string): Promise<JobRecord | null> {
    const collection = await getCollection();
    const doc = await collection.findOne({ _id: jobId });
    
    if (!doc) {
      return null;
    }

    // Convert MongoDB document to JobRecord (remove _id, use jobId)
    const { _id, ...record } = doc;
    return record as JobRecord;
  },

  async updateJob(jobId: string, data: Partial<JobRecord>): Promise<void> {
    const collection = await getCollection();
    const existing = await collection.findOne({ _id: jobId });
    
    if (!existing) {
      throw new Error(\`Job \${jobId} not found\`);
    }

    const now = new Date().toISOString();
    const update: any = {
      $set: {
        updatedAt: now,
      },
    };

    if (data.status !== undefined) {
      update.$set.status = data.status;
      if (['completed', 'failed'].includes(data.status) && !existing.completedAt) {
        update.$set.completedAt = now;
      }
    }
    if (data.output !== undefined) {
      update.$set.output = data.output;
    }
    if (data.error !== undefined) {
      update.$set.error = data.error;
    }
    if (data.metadata !== undefined) {
      update.$set.metadata = { ...existing.metadata, ...data.metadata };
    }

    await collection.updateOne({ _id: jobId }, update);
  },

  async appendInternalJob(parentJobId: string, entry: InternalJobEntry): Promise<void> {
    const collection = await getCollection();
    const now = new Date().toISOString();
    await collection.updateOne(
      { _id: parentJobId },
      {
        $push: { internalJobs: entry },
        $set: { updatedAt: now },
      }
    );
  },

  async listJobsByWorker(workerId: string): Promise<JobRecord[]> {
    const collection = await getCollection();
    const docs = await collection
      .find({ workerId })
      .sort({ createdAt: -1 })
      .toArray();

    return docs.map((doc) => {
      const { _id, ...record } = doc;
      return record as JobRecord;
    });
  },
};
`,

  "stores/redisAdapter.ts": `/**
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
  return \`\${jobKeyPrefix}\${jobId}\`;
}

/** Separate LIST key for internal job refs; each RPUSH is atomic so no race when appending multiple. */
function internalListKey(jobId: string): string {
  return \`\${jobKeyPrefix}\${jobId}:internal\`;
}

function workerIndexKey(workerId: string): string {
  // Secondary index: worker -> set of jobIds
  return \`\${jobKeyPrefix}by-worker:\${workerId}\`;
}

function getJobTtlSeconds(): number {
  const raw =
    process.env.WORKER_JOBS_TTL_SECONDS || process.env.WORKFLOW_JOBS_TTL_SECONDS;
  if (!raw) return defaultTtlSeconds;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultTtlSeconds;
}

/** Hash values from Upstash hgetall may be auto-parsed (object/array) or raw strings. */
function valueFromHash<T>(val: unknown): T | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'object') return val as T;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function stringFromHash(val: unknown): string {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  return String(val);
}

/** Build a JobRecord from a Redis hash + its \`:internal\` list items. Shared by the single-job
 * read and the pipelined bulk read (listJobsByWorker) so both parse identically. */
function recordFromHash(
  jobId: string,
  data: Record<string, unknown> | null | undefined,
  listItems: unknown[] | null | undefined
): JobRecord | null {
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return null;

  // Prefer atomic list key for internal jobs; fallback to hash field for old records
  let internalJobs: InternalJobEntry[] | undefined;
  if (listItems && listItems.length > 0) {
    internalJobs = listItems
      .map((s) => {
        try {
          return (typeof s === 'string' ? JSON.parse(s) : s) as InternalJobEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is InternalJobEntry => e != null);
  } else {
    internalJobs = valueFromHash<InternalJobEntry[]>(data.internalJobs);
  }

  return {
    jobId: stringFromHash(data.jobId) || jobId,
    workerId: stringFromHash(data.workerId),
    status: (stringFromHash(data.status) as JobRecord['status']) || 'queued',
    input: valueFromHash<any>(data.input) ?? {},
    output: valueFromHash<any>(data.output),
    error: valueFromHash<JobRecord['error']>(data.error),
    metadata: valueFromHash<Record<string, any>>(data.metadata) ?? {},
    internalJobs,
    createdAt: stringFromHash(data.createdAt),
    updatedAt: stringFromHash(data.updatedAt),
    completedAt: data.completedAt != null ? stringFromHash(data.completedAt) : undefined,
  };
}

async function loadJob(jobId: string): Promise<JobRecord | null> {
  const redis = getRedis();
  const data = (await redis.hgetall(jobKey(jobId))) as Record<string, unknown> | null;
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return null;
  const listItems = (await redis.lrange(internalListKey(jobId), 0, -1)) ?? [];
  return recordFromHash(jobId, data, listItems);
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
      throw new Error(\`Job \${jobId} not found\`);
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
    if (jobIds.length === 0) return [];

    // Pipeline the hash + internal-list reads into 2 round-trips instead of 2×N sequential calls
    // (the naive loop was O(N) REST requests — slow for a worker with many jobs).
    const hashPipe = redis.pipeline();
    const listPipe = redis.pipeline();
    for (const jobId of jobIds) {
      hashPipe.hgetall(jobKey(jobId));
      listPipe.lrange(internalListKey(jobId), 0, -1);
    }
    const [hashes, lists] = await Promise.all([
      hashPipe.exec() as Promise<Array<Record<string, unknown> | null>>,
      listPipe.exec() as Promise<Array<unknown[] | null>>,
    ]);

    const jobs: JobRecord[] = [];
    jobIds.forEach((jobId, i) => {
      const rec = recordFromHash(jobId, hashes[i], lists[i]);
      if (rec) jobs.push(rec);
    });
    // Most recent first
    jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return jobs;
  },
};
`,

  "stores/queueJobStore.ts": `/**
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
  status: 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'failed';
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

function getStoreType(): 'mongodb' | 'upstash-redis' | 'local' {
  const t = (process.env.WORKER_DATABASE_TYPE || 'upstash-redis').toLowerCase();
  if (t === 'mongodb') return 'mongodb';
  if (t === 'local') return 'local';
  return 'upstash-redis';
}

/** DEV ONLY: proxy reads/writes to a running \`ai-worker dev\` server (WORKER_BASE_URL). */
function preferLocal(): boolean {
  return getStoreType() === 'local';
}

function preferMongo(): boolean {
  return getStoreType() === 'mongodb';
}

function preferRedis(): boolean {
  return getStoreType() === 'upstash-redis';
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
  return \`\${queueKeyPrefix}\${id}\`;
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
  if (preferLocal()) {
    const { createQueueJobLocal } = require('./localDevAdapter');
    return createQueueJobLocal(id, queueId, firstStep, metadata);
  }
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
    status?: 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'failed';
    input?: unknown;
    output?: unknown;
    error?: { message: string };
    startedAt?: string;
    completedAt?: string;
  }
): Promise<void> {
  if (preferLocal()) {
    const { updateQueueStepLocal } = require('./localDevAdapter');
    return updateQueueStepLocal(queueJobId, stepIndex, update);
  }
  if (preferRedis()) {
    const redis = getRedis();
    const key = queueKey(queueJobId);
    const existing = await loadQueueJobRedis(queueJobId);
    if (!existing) {
      throw new Error(\`Queue job \${queueJobId} not found\`);
    }
    const step = existing.steps[stepIndex];
    if (!step) {
      throw new Error(\`Queue job \${queueJobId} has no step at index \${stepIndex}\`);
    }
    const now = new Date().toISOString();
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
    const steps = [...existing.steps];
    steps[stepIndex] = mergedStep;
    const toSet: Record<string, string> = {
      steps: JSON.stringify(steps),
      updatedAt: now,
    };
    if (update.status === 'failed') {
      toSet.status = 'failed';
      if (!existing.completedAt) toSet.completedAt = now;
    } else if (update.status === 'completed' && stepIndex === steps.length - 1) {
      toSet.status = 'completed';
      if (!existing.completedAt) toSet.completedAt = now;
    }
    await redis.hset(key, toSet);
    return;
  }

  const collection = await getCollection();
  const now = new Date().toISOString();
  const setKey = \`steps.\${stepIndex}\`;
  const existing = await collection.findOne({ _id: queueJobId });
  if (!existing) {
    throw new Error(\`Queue job \${queueJobId} not found\`);
  }
  const step = existing.steps[stepIndex];
  if (!step) {
    throw new Error(\`Queue job \${queueJobId} has no step at index \${stepIndex}\`);
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
  if (preferLocal()) {
    const { appendQueueStepLocal } = require('./localDevAdapter');
    return appendQueueStepLocal(queueJobId, step);
  }
  if (preferRedis()) {
    const redis = getRedis();
    const key = queueKey(queueJobId);
    const existing = await loadQueueJobRedis(queueJobId);
    if (!existing) {
      throw new Error(\`Queue job \${queueJobId} not found\`);
    }
    const steps = [...(existing.steps || []), {
      workerId: step.workerId,
      workerJobId: step.workerJobId,
      status: 'queued' as const,
    }];
    await redis.hset(key, {
      steps: JSON.stringify(steps),
      updatedAt: new Date().toISOString(),
    });
    return;
  }

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
  if (preferLocal()) {
    const { updateQueueJobLocal } = require('./localDevAdapter');
    return updateQueueJobLocal(queueJobId, update);
  }
  const now = new Date().toISOString();
  if (preferRedis()) {
    const redis = getRedis();
    const key = queueKey(queueJobId);
    const existing = await loadQueueJobRedis(queueJobId);
    if (!existing) throw new Error(\`Queue job \${queueJobId} not found\`);
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
  if (preferLocal()) {
    const { getQueueJobLocal } = require('./localDevAdapter');
    return getQueueJobLocal(queueJobId);
  }
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
  if (preferLocal()) {
    const { listQueueJobsLocal } = require('./localDevAdapter');
    return listQueueJobsLocal(queueId, limit);
  }
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
`,

  "stores/localDevAdapter.ts": `/**
 * Local dev-server store adapter (\`WORKER_DATABASE_TYPE=local\`).
 *
 * When workers run under \`ai-worker dev\` with the local file-persisted store,
 * job state lives inside the dev server process — this app cannot read it from
 * Redis/Mongo. This adapter proxies every read AND write to the dev server's
 * \`/dev-store/*\` HTTP API (single source of truth), using the same base URL
 * (\`WORKER_BASE_URL\`, e.g. http://localhost:4100) and API key the trigger
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
    process.env.WORKERS_TRIGGER_API_URL?.replace(/\\/workers\\/trigger\\/?$/, '');
  if (!base) {
    throw new Error(
      'WORKER_DATABASE_TYPE=local requires WORKER_BASE_URL to point at your \`ai-worker dev\` server (e.g. http://localhost:4100).'
    );
  }
  return base.replace(/\\/+$/, '');
}

let warnedProduction = false;

async function devStoreFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<{ status: number; data: T | null }> {
  if (process.env.NODE_ENV === 'production' && !warnedProduction) {
    warnedProduction = true;
    console.warn(
      '[localDevAdapter] WORKER_DATABASE_TYPE=local is active in a production build — this store only works against a local \`ai-worker dev\` server.'
    );
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = process.env.WORKERS_API_KEY || process.env.WORKERS_TRIGGER_API_KEY;
  if (key) headers['x-workers-trigger-key'] = key;

  const response = await fetch(\`\${devServerBaseUrl()}\${path}\`, {
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
      \`Dev store request failed: \${init?.method ?? 'GET'} \${path} -> \${response.status}\${text ? \` \${text}\` : ''}. Is \\\`ai-worker dev\\\` running at \${devServerBaseUrl()}?\`
    );
  }
  return { status: response.status, data: (await response.json()) as T };
}

// === JobStoreAdapter surface (see jobStore.ts) ===

export const localDevJobStore = {
  async setJob(jobId: string, data: Partial<JobRecord>): Promise<void> {
    await devStoreFetch(\`/dev-store/jobs/\${encodeURIComponent(jobId)}\`, {
      method: 'PUT',
      body: data,
    });
  },
  async getJob(jobId: string): Promise<JobRecord | null> {
    const { data } = await devStoreFetch<JobRecord>(
      \`/dev-store/jobs/\${encodeURIComponent(jobId)}\`
    );
    return data;
  },
  async updateJob(jobId: string, data: Partial<JobRecord>): Promise<void> {
    await devStoreFetch(\`/dev-store/jobs/\${encodeURIComponent(jobId)}\`, {
      method: 'PUT',
      body: data,
    });
  },
  async appendInternalJob(parentJobId: string, entry: InternalJobEntry): Promise<void> {
    await devStoreFetch(\`/dev-store/jobs/\${encodeURIComponent(parentJobId)}/internal-jobs\`, {
      method: 'POST',
      body: entry,
    });
  },
  async listJobsByWorker(workerId: string): Promise<JobRecord[]> {
    const { data } = await devStoreFetch<JobRecord[]>(
      \`/dev-store/jobs?workerId=\${encodeURIComponent(workerId)}\`
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
  await devStoreFetch(\`/dev-store/queue-jobs/\${encodeURIComponent(id)}\`, {
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
    \`/dev-store/queue-jobs/\${encodeURIComponent(queueJobId)}/steps/\${stepIndex}\`,
    { method: 'PUT', body: update }
  );
  if (status === 404) {
    throw new Error(\`Queue job \${queueJobId} not found (or no step at index \${stepIndex})\`);
  }
}

export async function appendQueueStepLocal(
  queueJobId: string,
  step: { workerId: string; workerJobId: string }
): Promise<void> {
  const { status } = await devStoreFetch(
    \`/dev-store/queue-jobs/\${encodeURIComponent(queueJobId)}/steps\`,
    { method: 'POST', body: step }
  );
  if (status === 404) {
    throw new Error(\`Queue job \${queueJobId} not found\`);
  }
}

export async function updateQueueJobLocal(
  queueJobId: string,
  update: { status?: QueueJobRecord['status']; completedAt?: string }
): Promise<void> {
  await devStoreFetch(\`/dev-store/queue-jobs/\${encodeURIComponent(queueJobId)}\`, {
    method: 'PUT',
    body: update,
  });
}

export async function getQueueJobLocal(queueJobId: string): Promise<QueueJobRecord | null> {
  const { data } = await devStoreFetch<QueueJobRecord>(
    \`/dev-store/queue-jobs/\${encodeURIComponent(queueJobId)}\`
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
    \`/dev-store/queue-jobs?\${params.toString()}\`
  );
  return data ?? [];
}
`,

  "registry/workers.ts": `/**
 * Worker registry system.
 *
 * Uses only the GET /workers/config API as the source of truth.
 * No directory scanning, no dynamic imports, no .worker.ts loading.
 *
 * - getWorker(workerId): returns a synthetic WorkerAgent that dispatches via POST /workers/trigger
 * - listWorkers(): returns worker IDs from the config API response
 * - getQueueRegistry(): returns QueueRegistry from config (for dispatchQueue)
 */

import {
  defaultMapChainContinueFromPrevious,
  defaultMapChainPassthrough,
  resolveWorkersConfigKey,
  resolveWorkersTriggerKey,
  type ChainContext,
  type LoopContext,
  type SmartRetryConfig,
  type WorkerAgent,
  type WorkerQueueRegistry,
} from '@microfox/ai-worker';

/** Queue step config (matches WorkerQueueStep from @microfox/ai-worker). */
export interface QueueStepConfig {
  workerId: string;
  delaySeconds?: number;
  requiresApproval?: boolean;
  hasChain?: boolean;
  hasResume?: boolean;
  hasLoop?: boolean;
  hitl?: unknown;
  retry?: SmartRetryConfig;
}

/** Queue config from workers/config API (matches WorkerQueueConfig structure). */
export interface QueueConfig {
  id: string;
  steps: QueueStepConfig[];
  schedule?: string | { rate: string; enabled?: boolean; input?: Record<string, any> };
}

export interface WorkersConfig {
  version?: string;
  stage?: string;
  region?: string;
  workers: Record<string, { queueUrl: string; region: string }>;
  /** JSON Schemas for each worker's input, keyed by worker ID. Embedded at CLI build time. */
  schemas?: Record<string, unknown>;
  queues?: QueueConfig[];
}

let configCache: WorkersConfig | null = null;

function getConfigBaseUrl(): string {
  const raw =
    process.env.WORKERS_CONFIG_API_URL ||
    process.env.WORKER_BASE_URL;
  if (!raw?.trim()) {
    throw new Error(
      'WORKERS_CONFIG_API_URL or WORKER_BASE_URL is required for the worker registry. ' +
        'Set it to the base URL of your workers service (e.g. https://xxx.execute-api.us-east-1.amazonaws.com/prod).'
    );
  }
  const base = raw.trim().replace(/\\/+$/, '');
  if (base.endsWith('/workers/config')) {
    return base.replace(/\\/workers\\/config\\/?$/, '');
  }
  return base;
}

function getConfigUrl(): string {
  return \`\${getConfigBaseUrl()}/workers/config\`;
}

function getTriggerUrl(): string {
  return \`\${getConfigBaseUrl()}/workers/trigger\`;
}

/**
 * Fetch and cache workers config from GET /workers/config.
 */
export async function fetchWorkersConfig(): Promise<WorkersConfig> {
  if (configCache) {
    return configCache;
  }
  const configUrl = getConfigUrl();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = resolveWorkersConfigKey();
  if (apiKey) {
    headers['x-workers-config-key'] = apiKey;
  }
  const res = await fetch(configUrl, { method: 'GET', headers });
  if (!res.ok) {
    throw new Error(
      \`[WorkerRegistry] GET \${configUrl} failed: \${res.status} \${res.statusText}\`
    );
  }
  const data = (await res.json()) as WorkersConfig;
  if (!data?.workers || typeof data.workers !== 'object') {
    throw new Error(
      '[WorkerRegistry] Invalid config: expected { workers: { [id]: { queueUrl, region } } }'
    );
  }
  configCache = data;
  const workerIds = Object.keys(data.workers);
  const queueIds = data.queues?.map((q) => q.id) ?? [];
  console.log('[WorkerRegistry] Config loaded', { workers: workerIds.length, queues: queueIds });
  return data;
}

/**
 * Build a synthetic WorkerAgent that dispatches via POST /workers/trigger.
 */
function createSyntheticAgent(workerId: string): WorkerAgent<any, any> {
  return {
    id: workerId,
    dispatch: async (input: any, options: any) => {
      const jobId =
        options?.jobId ||
        \`job-\${Date.now()}-\${Math.random().toString(36).slice(2, 11)}\`;
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
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const key = resolveWorkersTriggerKey();
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
          \`Failed to trigger worker "\${workerId}": \${response.status} \${response.statusText}\${text ? \` - \${text}\` : ''}\`
        );
      }
      const data = (await response.json().catch(() => ({}))) as any;
      const messageId = data?.messageId ? String(data.messageId) : \`trigger-\${jobId}\`;
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

type QueueModuleMap = Record<string, { default?: { steps?: Array<{ chain?: unknown; resume?: unknown; hitl?: unknown; loop?: { shouldContinue?: unknown } }> } }>;

/** Webpack require.context – auto-discovers app/ai/queues/*.queue.ts (Next.js). */
function getQueueModuleContext(): { keys(): string[]; (key: string): unknown } | null {
  try {
    if (typeof require === 'undefined') return null;
    const ctx = (require as unknown as { context: (dir: string, sub: boolean, re: RegExp) => { keys(): string[]; (k: string): unknown } }).context(
      '@/app/ai/queues',
      false,
      /\\.queue\\.ts$/
    );
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Auto-discover queue modules from app/ai/queues/*.queue.ts.
 * Uses require.context when available (Next.js/webpack).
 */
function buildQueueModules(): QueueModuleMap {
  const ctx = getQueueModuleContext();
  if (!ctx) return {};
  const out: QueueModuleMap = {};
  for (const key of ctx.keys()) {
    const mod = ctx(key) as { default?: { id?: string } };
    const id = mod?.default?.id;
    if (id && typeof id === 'string') {
      out[id] = mod as QueueModuleMap[string];
    }
  }
  return out;
}

const queueModules = buildQueueModules();

function resolveModuleStep(queueId: string, stepIndex: number) {
  return queueModules[queueId]?.default?.steps?.[stepIndex];
}

function resolveStepHitl(queueId: string, stepIndex: number, stepFromConfig: QueueStepConfig | undefined): unknown {
  return resolveModuleStep(queueId, stepIndex)?.hitl ?? stepFromConfig?.hitl;
}

/**
 * Returns a registry compatible with dispatchQueue. Queue definitions come from
 * GET /workers/config; chain/resume functions are resolved from app/ai/queues/*.queue.ts
 * automatically (no manual registration per queue).
 */
export async function getQueueRegistry(): Promise<WorkerQueueRegistry> {
  const config = await fetchWorkersConfig();
  const queues: QueueConfig[] = config.queues ?? [];

  const registry = {
    getQueueById(queueId: string) {
      return queues.find((q) => q.id === queueId);
    },
    getStepAt(queueId: string, stepIndex: number) {
      const queue = queues.find((q) => q.id === queueId);
      const step = queue?.steps?.[stepIndex];
      const hitl = resolveStepHitl(queueId, stepIndex, step);
      // Resolve retry config from the local queue module (not from API config).
      const moduleStep = resolveModuleStep(queueId, stepIndex);
      const retry = (moduleStep as any)?.retry as SmartRetryConfig | undefined;
      return step
        ? {
            workerId: step.workerId,
            requiresApproval: step.requiresApproval,
            hasChain: step.hasChain,
            hasResume: step.hasResume,
            ...(hitl !== undefined ? { hitl } : {}),
            ...(retry !== undefined ? { retry } : {}),
          }
        : undefined;
    },
    invokeChain(queueId: string, stepIndex: number, context: ChainContext): unknown {
      const moduleStep = resolveModuleStep(queueId, stepIndex);
      const chain = moduleStep?.chain;
      if (typeof chain === 'function') return (chain as (c: ChainContext) => unknown)(context);
      if (chain === 'passthrough') return defaultMapChainPassthrough(context);
      if (chain === 'continueFromPrevious') return defaultMapChainContinueFromPrevious(context);
      const { initialInput, previousOutputs } = context;
      return previousOutputs.length > 0 ? previousOutputs[previousOutputs.length - 1].output : initialInput;
    },
    invokeResume(queueId: string, stepIndex: number, context: { initialInput: unknown; previousOutputs: unknown[]; reviewerInput: unknown; pendingInput: Record<string, unknown> }): unknown {
      const moduleStep = resolveModuleStep(queueId, stepIndex);
      const resume = moduleStep?.resume;
      if (typeof resume === 'function') return (resume as (c: typeof context) => unknown)(context);
      return { ...context.pendingInput, ...(context.reviewerInput !== null && typeof context.reviewerInput === 'object' ? context.reviewerInput as object : {}) };
    },
    invokeLoop(queueId: string, stepIndex: number, context: LoopContext): boolean {
      const moduleStep = resolveModuleStep(queueId, stepIndex);
      const shouldContinue = moduleStep?.loop?.shouldContinue;
      if (typeof shouldContinue === 'function') return !!(shouldContinue as (c: LoopContext) => boolean)(context);
      return false;
    },
  };
  return registry as WorkerQueueRegistry;
}

/** A Zod-like schema (anything exposing safeParse), used for runtime validation. */
export interface ParsableSchema {
  safeParse(input: unknown): { success: true; data: unknown } | { success: false; error: unknown };
}

/**
 * Resolves the HITL reviewer-input Zod schema (\`hitl.inputSchema\`) for a queue step
 * from the local \`app/ai/queues/*.queue.ts\` modules. Returns null when the step has no
 * HITL schema. Used to validate reviewer-supplied input before it is dispatched into the
 * next pipeline step (SEC-5). Resolves locally (no network) since Zod schemas don't
 * survive the JSON workers/config round-trip.
 */
export function getStepHitlInputSchema(queueId: string, stepIndex: number): ParsableSchema | null {
  const hitl = resolveModuleStep(queueId, stepIndex)?.hitl as
    | { inputSchema?: unknown }
    | undefined;
  const schema = hitl?.inputSchema;
  if (schema && typeof (schema as ParsableSchema).safeParse === 'function') {
    return schema as ParsableSchema;
  }
  return null;
}

/**
 * Returns the JSON Schema for a worker's input, or null if not available.
 * Schema is embedded in the workers-config response at CLI build time — no dynamic imports needed.
 */
export async function getWorkerSchema(workerId: string): Promise<unknown | null> {
  const config = await fetchWorkersConfig();
  return config.schemas?.[workerId] ?? null;
}

/**
 * Clear the in-memory config cache (e.g. for tests or refresh).
 */
export function clearConfigCache(): void {
  configCache = null;
}
`,

  "workers/[...slug]/route.ts": `import { NextRequest, NextResponse } from 'next/server';
import { dispatchWorker } from '@microfox/ai-worker';
import { authorizeWorkflowRequest } from '../../auth';

/**
 * Worker execution endpoint.
 *
 * POST /api/workflows/workers/:workerId - Execute a worker (calls trigger API directly; no registry).
 * GET /api/workflows/workers/:workerId/:jobId - Get worker job status
 * POST /api/workflows/workers/:workerId/webhook - Webhook callback for completion notifications
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  let slug: string[] = [];
  try {
    const { slug: slugParam } = await params;
    slug = slugParam || [];
    const [workerId, action] = slug;

    // Every mutating worker route requires a user session, the internal shared
    // secret (Lambda callbacks), or an explicit public opt-out.
    const auth = await authorizeWorkflowRequest(req);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const userId = auth.userId;

    // Handle webhook endpoint
    if (action === 'webhook') {
      return handleWebhook(req, workerId);
    }

    // Handle job store update endpoint (POST /api/workflows/workers/:workerId/update)
    if (action === 'update') {
      return handleJobUpdate(req, workerId);
    }

    // Create job record (POST /api/workflows/workers/:workerId/job) – used before polling when trigger-only
    if (action === 'job') {
      return handleCreateJob(req, workerId);
    }

    if (!workerId) {
      return NextResponse.json(
        { error: 'Worker ID is required' },
        { status: 400 }
      );
    }

    let body;
    try {
      body = await req.json();
    } catch (parseError: any) {
      console.error('[Worker] Failed to parse request body:', {
        workerId,
        error: parseError?.message || String(parseError),
      });
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { input, await: shouldAwait = false, jobId: providedJobId } = body;

    console.log('[Worker] Dispatching worker:', {
      workerId,
      shouldAwait,
      hasInput: !!input,
    });

    // Webhook optional. Job updates use MongoDB only; never pass jobStoreUrl.
    const webhookBase = process.env.WORKFLOW_WEBHOOK_BASE_URL;
    const webhookUrl =
      shouldAwait && typeof webhookBase === 'string' && webhookBase
        ? \`\${webhookBase.replace(/\\/+$/, '')}/api/workflows/workers/\${workerId}/webhook\`
        : undefined;

    // Use a single jobId end-to-end (Next job store + SQS/Lambda job store).
    // If caller provides jobId, respect it; otherwise generate one.
    const jobId =
      (typeof providedJobId === 'string' && providedJobId.trim()
        ? providedJobId.trim()
        : \`job-\${Date.now()}-\${Math.random().toString(36).slice(2, 11)}\`);

    // Store initial job record
    const { setJob } = await import('../../stores/jobStore');
    try {
      await setJob(jobId, {
        jobId,
        workerId,
        status: 'queued',
        input: input || {},
        metadata: { source: 'workflow-orchestration' },
      });
      console.log('[Worker] Initial job record created:', {
        jobId,
        workerId,
      });
    } catch (setJobError: any) {
      console.error('[Worker] Failed to create initial job record:', {
        jobId,
        workerId,
        error: setJobError?.message || String(setJobError),
      });
      // Continue even if job store fails - worker dispatch can still proceed
    }

    // Dispatch via trigger API (no registry). Unknown workerId will fail at trigger API.
    let dispatchResult;
    try {
      dispatchResult = await dispatchWorker(
        workerId,
        (input || {}) as Record<string, unknown>,
        {
          jobId,
          ...(webhookUrl ? { webhookUrl } : {}),
          ...(userId ? { userId } : {}),
          metadata: { source: 'workflow-orchestration' },
        }
      );
      console.log('[Worker] Worker dispatched successfully:', {
        jobId: dispatchResult.jobId,
        workerId,
        messageId: dispatchResult.messageId,
      });
    } catch (dispatchError: any) {
      console.error('[Worker] Failed to dispatch worker:', {
        workerId,
        error: dispatchError?.message || String(dispatchError),
        stack: process.env.NODE_ENV === 'development' ? dispatchError?.stack : undefined,
      });
      return NextResponse.json(
        { error: \`Failed to dispatch worker: \${dispatchError?.message || String(dispatchError)}\` },
        { status: 502 }
      );
    }

    const finalJobId = dispatchResult.jobId || jobId;

    if (shouldAwait) {
      // For await mode, return job info and let caller poll status
      // The webhook handler will update the job when complete
      // For Vercel workflow: Use polling with setTimeout/setInterval
      // Workers are fire-and-forget only
      return NextResponse.json(
        {
          jobId: finalJobId,
          status: 'queued',
          message: 'Worker job queued. Use GET /api/workflows/workers/:workerId/:jobId to check status, or wait for webhook.',
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        jobId: finalJobId,
        status: dispatchResult.status || 'queued',
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[Worker] Error in POST handler:', {
      workerId: slug[0],
      error: error?.message || String(error),
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
    return NextResponse.json(
      { 
        error: error?.message || String(error),
        stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
      },
      { status: 500 }
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  let slug: string[] = [];
  try {
    const { slug: slugParam } = await params;
    slug = slugParam || [];
    const [workerId, jobIdOrAction] = slug;

    if (!workerId) {
      return NextResponse.json(
        { error: 'Worker ID is required' },
        { status: 400 }
      );
    }

    // GET /api/workflows/workers/:workerId/schema — return JSON schema of worker input
    if (jobIdOrAction === 'schema') {
      return handleGetSchema(workerId);
    }

    // GET /api/workflows/workers/:workerId/history — list all jobs for a worker
    if (jobIdOrAction === 'history') {
      const { listJobsByWorker } = await import('../../stores/jobStore');
      const jobs = await listJobsByWorker(workerId);
      // Sort newest first
      const sorted = [...jobs].sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });
      return NextResponse.json({ jobs: sorted }, { status: 200 });
    }

    const jobId = jobIdOrAction;

    if (!jobId) {
      return NextResponse.json(
        { error: 'Worker ID and job ID are required' },
        { status: 400 }
      );
    }

    console.log('[Worker] Getting job status:', {
      jobId,
      workerId,
    });

    // Get job status from job store
    const { getJob } = await import('../../stores/jobStore');
    let job;
    try {
      job = await getJob(jobId);
    } catch (getJobError: any) {
      console.error('[Worker] Error getting job from store:', {
        jobId,
        workerId,
        error: getJobError?.message || String(getJobError),
      });
      return NextResponse.json(
        { error: \`Failed to get job: \${getJobError?.message || String(getJobError)}\` },
        { status: 500 }
      );
    }
    
    if (!job) {
      console.warn('[Worker] Job not found:', {
        jobId,
        workerId,
      });
      return NextResponse.json(
        { error: \`Job "\${jobId}" not found\` },
        { status: 404 }
      );
    }
    
    console.log('[Worker] Job status retrieved:', {
      jobId,
      workerId,
      status: job.status,
    });
    
    return NextResponse.json(
      {
        jobId: job.jobId,
        workerId: job.workerId,
        status: job.status,
        output: job.output,
        error: job.error,
        metadata: job.metadata,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[Worker] Error in GET handler:', {
      workerId: slug[0],
      jobId: slug[1],
      error: error?.message || String(error),
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
    return NextResponse.json(
      { 
        error: error?.message || String(error),
        stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * Return the JSON Schema for a worker's input.
 * Schema is embedded in the workers-config response at CLI build time — no dynamic imports.
 * GET /api/workflows/workers/:workerId/schema
 */
async function handleGetSchema(workerId: string) {
  const { getWorkerSchema } = await import('../../registry/workers');
  const schema = await getWorkerSchema(workerId);
  if (!schema) {
    return NextResponse.json({ error: \`No schema found for worker "\${workerId}"\` }, { status: 404 });
  }
  return NextResponse.json(schema, { status: 200 });
}

/**
 * Create job record before polling (trigger-only flow).
 * POST /api/workflows/workers/:workerId/job
 * Body: { jobId, input }
 */
async function handleCreateJob(req: NextRequest, workerId: string) {
  try {
    if (!workerId) {
      return NextResponse.json({ error: 'Worker ID is required' }, { status: 400 });
    }
    const body = await req.json();
    const { jobId, input } = body;
    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required in request body' }, { status: 400 });
    }
    const { setJob } = await import('../../stores/jobStore');
    await setJob(jobId, {
      jobId,
      workerId,
      status: 'queued',
      input: input ?? {},
      metadata: { source: 'workflow-orchestration' },
    });
    console.log('[Worker] Job created:', { jobId, workerId });
    return NextResponse.json({ message: 'Job created', jobId, workerId }, { status: 200 });
  } catch (error: any) {
    console.error('[Worker] Error creating job:', { workerId, error: error?.message || String(error) });
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}

/**
 * Handle job store update from worker context.
 * POST /api/workflows/workers/:workerId/update
 */
async function handleJobUpdate(req: NextRequest, workerId: string) {
  try {
    if (!workerId) {
      return NextResponse.json(
        { error: 'Worker ID is required' },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { jobId, status, metadata, output, error } = body;

    if (!jobId) {
      return NextResponse.json(
        { error: 'jobId is required in request body' },
        { status: 400 }
      );
    }

    const { updateJob, setJob, getJob } = await import('../../stores/jobStore');
    const existing = await getJob(jobId);

    // Upsert: create job if missing (e.g. workflow triggered via /workers/trigger directly)
    if (!existing) {
      await setJob(jobId, {
        jobId,
        workerId,
        status: status ?? 'queued',
        input: {},
        metadata: metadata ?? {},
        output,
        error,
      });
      return NextResponse.json(
        { message: 'Job created and updated successfully', jobId, workerId },
        { status: 200 }
      );
    }

    const updateData: any = {};
    if (status !== undefined) updateData.status = status;
    if (metadata !== undefined) updateData.metadata = { ...existing.metadata, ...metadata };
    if (output !== undefined) updateData.output = output;
    if (error !== undefined) updateData.error = error;

    await updateJob(jobId, updateData);
    
    console.log('[Worker] Job updated:', { jobId, workerId, updates: Object.keys(updateData) });
    
    return NextResponse.json(
      { message: 'Job updated successfully', jobId, workerId },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[Worker] Error updating job:', {
      workerId,
      error: error?.message || String(error),
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}

/**
 * Handle webhook callback for worker completion.
 * POST /api/workflows/workers/:workerId/webhook
 * 
 * This endpoint receives completion notifications from workers.
 * It updates the job store with the final status before returning.
 * Webhook is only called if webhookUrl was provided during dispatch.
 */
async function handleWebhook(req: NextRequest, workerId: string) {
  try {
    if (!workerId) {
      return NextResponse.json(
        { error: 'Worker ID is required' },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { jobId, status, output, error, metadata } = body;

    if (!jobId) {
      return NextResponse.json(
        { error: 'jobId is required in webhook payload' },
        { status: 400 }
      );
    }

    // Update job store with completion status (before any further processing)
    const { updateJob } = await import('../../stores/jobStore');
    
    const jobStatus = status === 'success' ? 'completed' : 'failed';
    
    try {
      // Update job with completion status
      await updateJob(jobId, {
        jobId,
        workerId,
        status: jobStatus,
        output,
        error,
        completedAt: new Date().toISOString(),
        metadata: metadata || {},
      });
      
      console.log('[Worker] Webhook received and job updated:', {
        jobId,
        workerId,
        status: jobStatus,
      });
    } catch (updateError: any) {
      console.error('[Worker] Failed to update job store from webhook:', {
        jobId,
        workerId,
        error: updateError?.message || String(updateError),
        stack: process.env.NODE_ENV === 'development' ? updateError?.stack : undefined,
      });
      // Continue even if job store update fails - webhook was received
    }
    
    return NextResponse.json(
      { message: 'Webhook received', jobId, workerId, status: jobStatus },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[Worker] Error handling webhook:', {
      workerId,
      error: error?.message || String(error),
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
`,

  "queues/[...slug]/route.ts": `import { NextRequest, NextResponse } from 'next/server';
import { dispatchQueue, dispatchWorker } from '@microfox/ai-worker';
import { authorizeWorkflowRequest } from '../../auth';
import {
  getQueueJob,
  listQueueJobs,
  updateQueueJob,
  updateQueueStep,
  appendQueueStep,
} from '../../stores/queueJobStore';
export const dynamic = 'force-dynamic';

const LOG = '[Queues]';

/**
 * Queue execution endpoint.
 *
 * POST /api/workflows/queues/:queueId - Trigger a queue (calls queue-start API; no registry).
 * GET  /api/workflows/queues/:queueId/:jobId - Get queue job status
 * GET  /api/workflows/queues - List queue jobs (query: queueId?, limit?)
 * POST /api/workflows/queues/:queueId/update - Update queue job step (for Lambda/callers)
 * POST /api/workflows/queues/:queueId/webhook - Webhook for queue completion
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  let slug: string[] = [];
  try {
    const { slug: slugParam } = await params;
    slug = slugParam ?? [];
    const [queueId, action] = slug;

    // SECURITY: every mutating queue route requires a user session, the internal
    // shared secret (Lambda callbacks), or an explicit public opt-out.
    const auth = await authorizeWorkflowRequest(req);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const userId = auth.userId;

    if (action === 'update') {
      return handleQueueJobUpdate(req, queueId);
    }
    if (action === 'webhook') {
      return handleQueueWebhook(req, queueId);
    }
    if (action === 'approve') {
      return handleQueueApprove(req, queueId);
    }

    if (!queueId) {
      return NextResponse.json(
        { error: 'Queue ID is required. Use POST /api/workflows/queues/:queueId to trigger a queue.' },
        { status: 400 }
      );
    }

    let body: { input?: unknown; metadata?: Record<string, unknown>; jobId?: string } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const { input = {}, metadata, jobId: providedJobId } = body;

    const result = await dispatchQueue(queueId, input as Record<string, unknown>, {
      metadata: metadata ?? { source: 'queues-api' },
      ...(typeof providedJobId === 'string' && providedJobId.trim() ? { jobId: providedJobId.trim() } : {}),
      ...(userId ? { userId } : {}),
    });

    console.log(\`\${LOG} Queue triggered\`, {
      queueId: result.queueId,
      jobId: result.jobId,
      messageId: result.messageId,
    });

    return NextResponse.json(
      {
        jobId: result.jobId,
        status: result.status,
        messageId: result.messageId,
        queueId: result.queueId,
        queueJobUrl: \`/api/workflows/queues/\${queueId}/\${result.jobId}\`,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(\`\${LOG} POST error:\`, err.message, err.stack);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  let slug: string[] = [];
  try {
    const { slug: slugParam } = await params;
    slug = slugParam ?? [];
    const [queueId, jobId] = slug;

    // List: GET /api/workflows/queues or GET /api/workflows/queues?queueId=...&limit=...
    if (slug.length === 0 || (slug.length === 1 && !jobId)) {
      const { searchParams } = new URL(req.url);
      const filterQueueId = searchParams.get('queueId') ?? (slug[0] || undefined);
      const limit = Math.min(
        100,
        Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10) || 50)
      );
      const jobs = await listQueueJobs(filterQueueId, limit);
      return NextResponse.json({ jobs });
    }

    // Get one: GET /api/workflows/queues/:queueId/:jobId
    if (!queueId || !jobId) {
      return NextResponse.json(
        { error: 'Queue ID and job ID are required for GET. Use GET /api/workflows/queues/:queueId/:jobId' },
        { status: 400 }
      );
    }

    const job = await getQueueJob(jobId);
    if (!job) {
      return NextResponse.json({ error: 'Queue job not found' }, { status: 404 });
    }
    if (job.queueId !== queueId) {
      return NextResponse.json({ error: 'Queue job does not belong to this queue' }, { status: 400 });
    }

    return NextResponse.json(job);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(\`\${LOG} GET error:\`, err.message);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}

async function handleQueueJobUpdate(req: NextRequest, queueId: string) {
  if (!queueId) {
    return NextResponse.json({ error: 'Queue ID is required' }, { status: 400 });
  }
  const body = await req.json();
  const { queueJobId, jobId, action, stepIndex, workerJobId, workerId, output, error, input } = body;
  const id = queueJobId ?? jobId;
  if (!id) {
    return NextResponse.json(
      { error: 'queueJobId or jobId is required in request body' },
      { status: 400 }
    );
  }

  if (action === 'append') {
    if (!workerId || !workerJobId) {
      return NextResponse.json(
        { error: 'append requires workerId and workerJobId' },
        { status: 400 }
      );
    }
    await appendQueueStep(id, { workerId, workerJobId });
    console.log(\`\${LOG} Step appended\`, { queueJobId: id, workerId, workerJobId });
    return NextResponse.json({ ok: true, action: 'append' });
  }

  if (action === 'start') {
    if (typeof stepIndex !== 'number' || !workerJobId) {
      return NextResponse.json(
        { error: 'start requires stepIndex and workerJobId' },
        { status: 400 }
      );
    }
    await updateQueueStep(id, stepIndex, {
      status: 'running',
      startedAt: new Date().toISOString(),
      ...(input !== undefined && { input }),
    });
    console.log(\`\${LOG} Step started\`, { queueJobId: id, stepIndex, workerJobId });
    return NextResponse.json({ ok: true, action: 'start' });
  }

  if (action === 'complete') {
    if (typeof stepIndex !== 'number' || !workerJobId) {
      return NextResponse.json(
        { error: 'complete requires stepIndex and workerJobId' },
        { status: 400 }
      );
    }
    await updateQueueStep(id, stepIndex, {
      status: 'completed',
      output,
      completedAt: new Date().toISOString(),
    });
    console.log(\`\${LOG} Step completed\`, { queueJobId: id, stepIndex, workerJobId });
    return NextResponse.json({ ok: true, action: 'complete' });
  }

  if (action === 'awaiting_approval') {
    if (typeof stepIndex !== 'number' || !workerJobId) {
      return NextResponse.json(
        { error: 'awaiting_approval requires stepIndex and workerJobId' },
        { status: 400 }
      );
    }
    await updateQueueStep(id, stepIndex, {
      status: 'awaiting_approval',
      ...(input !== undefined && { input }),
    });
    console.log(\`\${LOG} Step awaiting approval\`, { queueJobId: id, stepIndex, workerJobId });
    return NextResponse.json({ ok: true, action: 'awaiting_approval' });
  }

  if (action === 'fail') {
    if (typeof stepIndex !== 'number' || !workerJobId) {
      return NextResponse.json(
        { error: 'fail requires stepIndex and workerJobId' },
        { status: 400 }
      );
    }
    await updateQueueStep(id, stepIndex, {
      status: 'failed',
      error: error ?? { message: 'Unknown error' },
      completedAt: new Date().toISOString(),
    });
    console.log(\`\${LOG} Step failed\`, { queueJobId: id, stepIndex, workerJobId });
    return NextResponse.json({ ok: true, action: 'fail' });
  }

  return NextResponse.json(
    { error: \`Unknown action: \${action}. Use start|awaiting_approval|complete|fail|append\` },
    { status: 400 }
  );
}

/**
 * Prototype + runtime endpoint for HITL queue approval/rejection.
 * POST /api/workflows/queues/:queueId/approve
 */
async function handleQueueApprove(req: NextRequest, queueId: string) {
  if (!queueId) {
    return NextResponse.json({ error: 'Queue ID is required' }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const {
    queueJobId,
    jobId,
    stepIndex,
    decision = 'approve',
    input,
    comment,
    reviewerId,
  } = body ?? {};

  const id = queueJobId ?? jobId;
  if (!id) {
    return NextResponse.json(
      { error: 'queueJobId or jobId is required in request body' },
      { status: 400 }
    );
  }

  const queueJob = await getQueueJob(id);
  if (!queueJob) {
    return NextResponse.json({ error: 'Queue job not found' }, { status: 404 });
  }
  if (queueJob.queueId !== queueId) {
    return NextResponse.json({ error: 'Queue job does not belong to this queue' }, { status: 400 });
  }

  const targetStepIndex =
    typeof stepIndex === 'number'
      ? stepIndex
      : queueJob.steps.findIndex((s) => s.status === 'awaiting_approval');
  if (targetStepIndex < 0) {
    return NextResponse.json(
      { error: 'No awaiting_approval step found for this queue job' },
      { status: 400 }
    );
  }

  const targetStep = queueJob.steps[targetStepIndex];
  if (!targetStep) {
    return NextResponse.json({ error: 'Invalid stepIndex' }, { status: 400 });
  }
  if (targetStep.status !== 'awaiting_approval') {
    if (
      decision === 'approve' &&
      (targetStep.status === 'running' || targetStep.status === 'completed')
    ) {
      return NextResponse.json({
        ok: true,
        idempotent: true,
        decision: 'approve',
        queueJobId: id,
        queueId,
        stepIndex: targetStepIndex,
        workerId: targetStep.workerId,
        workerJobId: targetStep.workerJobId,
        status: targetStep.status,
      });
    }
    if (decision === 'reject' && targetStep.status === 'failed') {
      return NextResponse.json({
        ok: true,
        idempotent: true,
        decision: 'reject',
        queueJobId: id,
        queueId,
        stepIndex: targetStepIndex,
        status: 'failed',
      });
    }
    return NextResponse.json(
      { error: \`Step \${targetStepIndex} is not awaiting approval\` },
      { status: 400 }
    );
  }

  if (decision === 'reject') {
    await updateQueueStep(id, targetStepIndex, {
      status: 'failed',
      error: { message: comment || 'Rejected by reviewer' },
      completedAt: new Date().toISOString(),
    });
    return NextResponse.json({
      ok: true,
      decision,
      queueJobId: id,
      queueId,
      stepIndex: targetStepIndex,
      status: 'failed',
    });
  }

  const pendingInput =
    targetStep.input && typeof targetStep.input === 'object'
      ? (targetStep.input as Record<string, unknown>)
      : {};
  let reviewerInput =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};

  // SEC-5: validate reviewer-supplied input against the step's HITL schema BEFORE it is
  // dispatched into the next pipeline step. Without this, an approver could inject arbitrary
  // fields into the resumed worker's input.
  try {
    const { getStepHitlInputSchema } = await import('../../registry/workers');
    const schema = getStepHitlInputSchema(queueId, targetStepIndex);
    if (schema) {
      const parsed = schema.safeParse(reviewerInput);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Reviewer input failed HITL schema validation', details: parsed.error },
          { status: 400 }
        );
      }
      // Use the validated/coerced value (strips unknown keys when the schema does).
      reviewerInput = parsed.data as Record<string, unknown>;
    }
  } catch (validationSetupError: unknown) {
    const e = validationSetupError instanceof Error ? validationSetupError : new Error(String(validationSetupError));
    console.error(\`\${LOG} HITL schema validation could not run:\`, e.message);
    // Fail closed: if we intended to validate but couldn't load the schema resolver, reject.
    return NextResponse.json(
      { error: 'Unable to validate reviewer input' },
      { status: 500 }
    );
  }

  const decisionMeta = {
    decision: 'approve' as const,
    reviewerId: reviewerId ?? null,
    comment: comment ?? null,
    reviewedAt: new Date().toISOString(),
  };

  /** Forward pending domain input + HITL envelope; \`resume\` runs in the worker runtime (not here). */
  const dispatchInput = {
    ...pendingInput,
    __hitlInput: reviewerInput,
    __hitlDecision: decisionMeta,
  };
  const stepInputForStore = dispatchInput;

  // Write step status BEFORE dispatching so the Lambda cannot start and append/overwrite
  // the steps array before this read-modify-write completes (race condition fix).
  await updateQueueStep(id, targetStepIndex, {
    status: 'running',
    startedAt: new Date().toISOString(),
    input: stepInputForStore,
  });

  await dispatchWorker(targetStep.workerId, dispatchInput, {
    jobId: targetStep.workerJobId,
    metadata: {
      source: 'queue-hitl-approve',
      queueId,
      queueJobId: id,
      stepIndex: targetStepIndex,
      reviewerId: reviewerId ?? null,
    },
  });

  return NextResponse.json({
    ok: true,
    decision: 'approve',
    queueJobId: id,
    queueId,
    stepIndex: targetStepIndex,
    workerId: targetStep.workerId,
    workerJobId: targetStep.workerJobId,
    status: 'running',
  });
}

/**
 * Handle webhook callback for queue completion.
 * POST /api/workflows/queues/:queueId/webhook
 *
 * When a webhook URL is provided at dispatch time, the worker/runtime calls this
 * instead of updating the job store directly. This handler updates the queue job
 * store with the final status (same outcome as when no webhook: store reflects completion).
 */
async function handleQueueWebhook(req: NextRequest, queueId: string) {
  try {
    if (!queueId) {
      return NextResponse.json({ error: 'Queue ID is required' }, { status: 400 });
    }

    const body = await req.json();
    const { queueJobId, jobId, status, output, error, metadata } = body;
    const id = queueJobId ?? jobId;
    if (!id) {
      return NextResponse.json(
        { error: 'queueJobId or jobId is required in webhook payload' },
        { status: 400 }
      );
    }

    const jobStatus = status === 'success' ? 'completed' : 'failed';

    try {
      await updateQueueJob(id, {
        status: jobStatus,
        completedAt: new Date().toISOString(),
      });
      console.log(\`\${LOG} Webhook received and queue job updated:\`, {
        queueJobId: id,
        queueId,
        status: jobStatus,
      });
    } catch (updateError: unknown) {
      const err = updateError instanceof Error ? updateError : new Error(String(updateError));
      console.error(\`\${LOG} Failed to update queue job from webhook:\`, {
        queueJobId: id,
        queueId,
        error: err.message,
      });
      // Still return 200 so the caller does not retry; store update can be retried elsewhere if needed
    }

    return NextResponse.json(
      { message: 'Webhook received', queueId, queueJobId: id, status: jobStatus },
      { status: 200 }
    );
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(\`\${LOG} Error handling queue webhook:\`, { queueId, error: err.message });
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
`,

  "../../../hooks/useWorkflowJob.ts": `'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type WorkflowJobStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'partial';

export interface WorkerJobResult {
  jobId: string;
  workerId: string;
  status: string;
  output?: unknown;
  error?: { message: string; stack?: string };
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
}

export interface QueueJobStep {
  workerId: string;
  workerJobId: string;
  status: string;
  input?: unknown;
  output?: unknown;
  error?: { message: string };
  startedAt?: string;
  completedAt?: string;
}

export interface QueueJobResult {
  id: string;
  queueId: string;
  status: string;
  steps: QueueJobStep[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/**
 * Experimental HITL contract for prototype-only DX validation.
 * NOTE: Runtime architecture is not implemented yet; this shape is intentionally rough.
 */
export interface QueueHitlTask {
  taskId: string;
  queueJobId: string;
  queueId: string;
  stepIndex: number;
  workerId: string;
  status: 'awaiting_input' | 'approved' | 'rejected' | 'expired';
  progress?: {
    completedSteps: number;
    totalSteps: number;
    percent: number;
  };
  previousOutputs?: Array<{
    stepIndex: number;
    workerId: string;
    output: unknown;
  }>;
  uiSpec?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  contextSnapshot?: Record<string, unknown>;
}

export type QueueHitlDecisionPayload = {
  decision: 'approve' | 'reject';
  input?: Record<string, unknown>;
  comment?: string;
  reviewerId?: string;
};

export type WorkflowJobOutput = WorkerJobResult | QueueJobResult;

export interface UseWorkflowJobBaseOptions {
  /** Base URL for API calls (default: '' for relative, or set window.location.origin) */
  baseUrl?: string;
  /** Poll interval in ms (default: 2000) */
  pollIntervalMs?: number;
  /** Stop polling after this many ms (default: 300000 = 5 min) */
  pollTimeoutMs?: number;
  /** Start polling automatically after trigger (default: true) */
  autoPoll?: boolean;
  /** Called when job reaches completed (or queue: completed/partial) */
  onComplete?: (result: WorkflowJobOutput) => void;
  /** Called when job fails or trigger/poll errors */
  onError?: (error: Error) => void;
  /** If false, trigger is a no-op and auto-poll is skipped (default: true) */
  enabled?: boolean;
}

export interface UseWorkflowJobWorkerOptions extends UseWorkflowJobBaseOptions {
  type: 'worker';
  workerId: string;
}

export interface UseWorkflowJobQueueOptions extends UseWorkflowJobBaseOptions {
  type: 'queue';
  queueId: string;
  /** Optional metadata for queue trigger */
  metadata?: Record<string, unknown>;
}

export type UseWorkflowJobOptions =
  | UseWorkflowJobWorkerOptions
  | UseWorkflowJobQueueOptions;

const TERMINAL_STATUSES = ['completed', 'failed', 'partial'];

function getBaseUrl(baseUrl?: string): string {
  if (baseUrl !== undefined && baseUrl !== '') return baseUrl;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

export interface UseWorkflowJobReturn {
  /** Trigger the worker or queue. Pass input for the job. */
  trigger: (input?: Record<string, unknown>) => Promise<void>;
  /** Current job/queue job id (after trigger) */
  jobId: string | null;
  /** Current status: idle | queued | running | completed | failed | partial */
  status: WorkflowJobStatus;
  /** Last job output (worker or queue job object) */
  output: WorkflowJobOutput | null;
  /** Error from trigger or from job failure */
  error: Error | null;
  /** True while the trigger request is in flight */
  loading: boolean;
  /** True while polling for job status */
  polling: boolean;
  /** Reset state so you can trigger again */
  reset: () => void;
  /**
   * Prototype helper: derived HITL task from queue output when a step is awaiting approval.
   * Undefined when not in HITL wait state.
   */
  hitlTask?: QueueHitlTask | null;
  /**
   * Prototype helper: submit approval/rejection and optional reviewer input.
   * API path is provisional and may change with final architecture.
   */
  submitHitlDecision?: (payload: QueueHitlDecisionPayload) => Promise<void>;
}

export function useWorkflowJob(
  options: UseWorkflowJobWorkerOptions
): UseWorkflowJobReturn & { output: WorkerJobResult | null };
export function useWorkflowJob(
  options: UseWorkflowJobQueueOptions
): UseWorkflowJobReturn & { output: QueueJobResult | null };
export function useWorkflowJob(
  options: UseWorkflowJobOptions
): UseWorkflowJobReturn {
  const {
    baseUrl: baseUrlOpt,
    pollIntervalMs = 2000,
    pollTimeoutMs = 300_000,
    autoPoll = true,
    onComplete,
    onError,
    enabled = true,
  } = options;

  const baseUrl = getBaseUrl(baseUrlOpt);
  const prefix = baseUrl ? baseUrl.replace(/\\/+$/, '') : '';
  const api = (path: string) => \`\${prefix}/api/workflows\${path}\`;

  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<WorkflowJobStatus>('idle');
  const [output, setOutput] = useState<WorkflowJobOutput | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);

  const deriveHitlTask = useCallback((job: QueueJobResult | null): QueueHitlTask | null => {
    if (!job || !Array.isArray(job.steps)) return null;
    const waitingStepIndex = job.steps.findIndex((s) => s.status === 'awaiting_approval');
    if (waitingStepIndex < 0) return null;
    const waitingStep = job.steps[waitingStepIndex];
    const previousOutputs = job.steps
      .slice(0, waitingStepIndex)
      .map((s, idx) => ({ stepIndex: idx, workerId: s.workerId, output: s.output }));
    const completedSteps = job.steps.filter((s) => s.status === 'completed').length;
    const totalSteps = job.steps.length;
    const percent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
    const meta = (job.metadata ?? {}) as Record<string, any>;

    return {
      taskId: String(meta.hitlTaskId ?? \`\${job.id}:\${waitingStepIndex}\`),
      queueJobId: job.id,
      queueId: job.queueId,
      stepIndex: waitingStepIndex,
      workerId: waitingStep.workerId,
      status: 'awaiting_input',
      progress: { completedSteps, totalSteps, percent },
      previousOutputs,
      uiSpec: (waitingStep.input as any)?.hitl?.uiSpec ?? meta.hitlUiSpec ?? {},
      inputSchema: (waitingStep.input as any)?.hitl?.inputSchema ?? meta.hitlInputSchema ?? {},
      contextSnapshot: (waitingStep.input as any)?.hitl?.contextSnapshot ?? meta.hitlContextSnapshot ?? {},
    };
  }, []);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setPolling(false);
  }, []);

  const reset = useCallback(() => {
    clearPolling();
    setJobId(null);
    setStatus('idle');
    setOutput(null);
    setError(null);
    setLoading(false);
    setPolling(false);
  }, [clearPolling]);

  const trigger = useCallback(
    async (input?: Record<string, unknown>) => {
      if (!enabled) return;

      setError(null);
      setOutput(null);
      setLoading(true);

      try {
        if (options.type === 'worker') {
          const res = await fetch(api(\`/workers/\${options.workerId}\`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: input ?? {}, await: false }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error ?? \`HTTP \${res.status}\`);
          const id = data.jobId ?? null;
          if (!id) throw new Error('No jobId in response');
          setJobId(id);
          setStatus('queued');
          setLoading(false);

          if (autoPoll) {
            setPolling(true);
            const deadline = Date.now() + pollTimeoutMs;
            let intervalId: ReturnType<typeof setInterval> | null = null;
            const terminalHitRef = { current: false };
            const timeoutId = setTimeout(() => {
              if (intervalId != null) clearInterval(intervalId);
              if (timeoutRef.current === timeoutId) timeoutRef.current = null;
              if (intervalRef.current === intervalId) intervalRef.current = null;
              setPolling(false);
              setError(new Error('Poll timeout'));
              setStatus('failed');
            }, pollTimeoutMs);
            timeoutRef.current = timeoutId;

            const clearThisPolling = () => {
              if (intervalId != null) {
                clearInterval(intervalId);
                if (intervalRef.current === intervalId) intervalRef.current = null;
              }
              clearTimeout(timeoutId);
              if (timeoutRef.current === timeoutId) timeoutRef.current = null;
              setPolling(false);
            };

            const poll = async () => {
              if (!mountedRef.current) return;
              try {
                const r = await fetch(
                  api(\`/workers/\${options.workerId}/\${id}\`)
                );
                const job = await r.json();
                if (!r.ok) {
                  if (Date.now() >= deadline) {
                    clearThisPolling();
                    setError(new Error('Poll timeout'));
                    setStatus('failed');
                    onError?.(new Error('Poll timeout'));
                  }
                  return;
                }
                setStatus((job.status as WorkflowJobStatus) ?? 'running');
                setOutput(job as WorkerJobResult);
                if (job.status === 'completed') {
                  terminalHitRef.current = true;
                  clearThisPolling();
                  onComplete?.(job as WorkerJobResult);
                } else if (job.status === 'failed') {
                  terminalHitRef.current = true;
                  clearThisPolling();
                  const err = new Error(
                    job?.error?.message ?? 'Job failed'
                  );
                  setError(err);
                  setStatus('failed');
                  onError?.(err);
                } else if (Date.now() >= deadline) {
                  clearThisPolling();
                  setError(new Error('Poll timeout'));
                  onError?.(new Error('Poll timeout'));
                }
              } catch (e) {
                if (mountedRef.current) {
                  clearThisPolling();
                  const err = e instanceof Error ? e : new Error(String(e));
                  setError(err);
                  setStatus('failed');
                  onError?.(err);
                }
              }
            };
            await poll();
            if (terminalHitRef.current) return;
            intervalId = setInterval(() => void poll(), pollIntervalMs);
            intervalRef.current = intervalId;
          }
        } else {
          const body: Record<string, unknown> = {
            input: input ?? {},
          };
          if (options.metadata) body.metadata = options.metadata;
          const res = await fetch(api(\`/queues/\${options.queueId}\`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error ?? \`HTTP \${res.status}\`);
          const id = data.jobId ?? null;
          if (!id) throw new Error('No jobId in response');
          setJobId(id);
          setStatus('queued');
          setLoading(false);

          if (autoPoll) {
            setPolling(true);
            // Deadline resets on each awaiting_approval poll — timeout only counts
            // active processing time, not time spent waiting for human decisions.
            let deadline = Date.now() + pollTimeoutMs;
            let intervalId: ReturnType<typeof setInterval> | null = null;
            const terminalHitRef = { current: false };

            const clearThisPolling = () => {
              if (intervalId != null) {
                clearInterval(intervalId);
                if (intervalRef.current === intervalId) intervalRef.current = null;
              }
              if (timeoutRef.current != null) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
              }
              setPolling(false);
            };

            const poll = async () => {
              if (!mountedRef.current) return;
              try {
                const r = await fetch(
                  api(\`/queues/\${options.queueId}/\${id}\`)
                );
                const job = await r.json();
                if (!r.ok) {
                  if (Date.now() >= deadline) {
                    clearThisPolling();
                    setError(new Error('Poll timeout'));
                    setStatus('failed');
                  }
                  return;
                }
                const st = (job.status as string) ?? 'running';
                setStatus(st as WorkflowJobStatus);
                setOutput(job as QueueJobResult);
                if (TERMINAL_STATUSES.includes(st)) {
                  terminalHitRef.current = true;
                  clearThisPolling();
                  onComplete?.(job as QueueJobResult);
                  if (st === 'failed') {
                    setError(new Error('Queue job failed'));
                    onError?.(new Error('Queue job failed'));
                  }
                } else if (st === 'awaiting_approval') {
                  // Reset the deadline while waiting for human input — the timeout
                  // should only count active processing time, not human decision time.
                  deadline = Date.now() + pollTimeoutMs;
                } else if (Date.now() >= deadline) {
                  clearThisPolling();
                  setError(new Error('Poll timeout'));
                  setStatus('failed');
                }
              } catch (e) {
                if (mountedRef.current) {
                  clearThisPolling();
                  const err = e instanceof Error ? e : new Error(String(e));
                  setError(err);
                  setStatus('failed');
                  onError?.(err);
                }
              }
            };
            await poll();
            if (terminalHitRef.current) return;
            intervalId = setInterval(() => void poll(), pollIntervalMs);
            intervalRef.current = intervalId;
          }
        }
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        setStatus('failed');
        setLoading(false);
        onError?.(err);
      }
    },
    [
      enabled,
      options,
      api,
      autoPoll,
      pollIntervalMs,
      pollTimeoutMs,
      onComplete,
      onError,
      clearPolling,
    ]
  );

  const submitHitlDecision = useCallback(
    async (payload: QueueHitlDecisionPayload) => {
      if (options.type !== 'queue' || !jobId) {
        throw new Error('submitHitlDecision is only available for queue jobs');
      }
      const response = await fetch(api(\`/queues/\${options.queueId}/approve\`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queueJobId: jobId,
          ...payload,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error ?? \`Failed to submit HITL decision (\${response.status})\`);
      }
    },
    [options, jobId, api]
  );

  const hitlTask =
    options.type === 'queue'
      ? deriveHitlTask((output && 'steps' in output ? (output as QueueJobResult) : null))
      : null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearPolling();
    };
  }, [clearPolling]);

  return {
    trigger,
    jobId,
    status,
    output,
    error,
    loading,
    polling,
    reset,
    ...(options.type === 'queue'
      ? {
          hitlTask,
          submitHitlDecision,
        }
      : {}),
  };
}
`,
};
