/**
 * Job store for tracking worker job status and results.
 *
 * Always uses MongoDB. Workers run on AWS Lambda and update jobs via the API;
 * in-memory storage is not shared across processes, so a persistent store is required.
 *
 * Configure via `microfox.config.ts` -> `studioSettings.database.mongodb` or env:
 * - DATABASE_MONGODB_URI or MONGODB_URI (required)
 * - DATABASE_MONGODB_DB or MONGODB_DB (default: 'ai_router')
 * - workerJobsCollection (default: 'worker_jobs'). Env: DATABASE_MONGODB_WORKER_JOBS_COLLECTION.
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
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// Storage adapter interface
interface JobStoreAdapter {
  setJob(jobId: string, data: Partial<JobRecord>): Promise<void>;
  getJob(jobId: string): Promise<JobRecord | null>;
  updateJob(jobId: string, data: Partial<JobRecord>): Promise<void>;
  listJobsByWorker(workerId: string): Promise<JobRecord[]>;
}

// Job store always uses MongoDB (workers run on Lambda; no in-memory fallback).
function getStorageAdapter(): JobStoreAdapter {
  try {
    const { mongoJobStore } = require('./mongoAdapter');
    console.log('[JobStore] Using MongoDB adapter');
    return mongoJobStore;
  } catch (error: any) {
    const msg = error?.message || String(error);
    console.error('[JobStore] MongoDB adapter required (workers run on Lambda).', { error: msg });
    throw new Error(
      'Job store requires MongoDB. Set DATABASE_MONGODB_URI (or MONGODB_URI) and ensure the MongoDB adapter can connect. ' +
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
