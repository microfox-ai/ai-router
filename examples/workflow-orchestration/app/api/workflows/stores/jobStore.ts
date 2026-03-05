/**
 * Job store for tracking worker job status and results.
 *
 * Always uses MongoDB. Workers run on AWS Lambda and update jobs via the API;
 * in-memory storage is not shared across processes, so a persistent store is required.
 *
 * Configure via `microfox.config.ts` -> `workflowSettings.jobStore` or env:
 * - WORKER_DATABASE_TYPE: 'mongodb' | 'upstash-redis' (default: upstash-redis)
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
        `Details: ${msg}`
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
