/**
 * MongoDB-backed job store for Lambda workers.
 * Updates jobs directly in MongoDB; never uses HTTP/origin URL.
 *
 * Env: MONGODB_WORKER_URI (or MONGODB_URI), MONGODB_WORKER_DB (or MONGODB_DB),
 * MONGODB_WORKER_JOBS_COLLECTION (default: worker_jobs).
 */

import { MongoClient, type Collection } from 'mongodb';
import type { JobStore, JobStoreUpdate } from './handler';

const uri = process.env.MONGODB_WORKER_URI || process.env.DATABASE_MONGODB_URI || process.env.MONGODB_URI;
const dbName =
  process.env.MONGODB_WORKER_DB ||
  process.env.MONGODB_DB ||
  'worker';
const collectionName =
  process.env.MONGODB_WORKER_JOBS_COLLECTION || 'worker_jobs';

type InternalJobEntry = { jobId: string; workerId: string };

type Doc = {
  _id: string;
  jobId: string;
  workerId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  input: any;
  output?: any;
  error?: { message: string; stack?: string; name?: string };
  metadata?: Record<string, any>;
  internalJobs?: InternalJobEntry[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

let clientPromise: Promise<MongoClient> | null = null;

function getClient(): Promise<MongoClient> {
  if (!uri) {
    throw new Error(
      'MongoDB URI required for job store. Set DATABASE_MONGODB_URI or MONGODB_URI.'
    );
  }
  if (!clientPromise) {
    clientPromise = new MongoClient(uri, {
      maxPoolSize: 10,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 10_000,
    }).connect();
  }
  return clientPromise;
}

async function getCollection(): Promise<Collection<Doc>> {
  const client = await getClient();
  return client.db(dbName).collection<Doc>(collectionName);
}

/**
 * Load a job by id (read-only). Used for idempotency check before processing.
 */
export async function getJobById(jobId: string): Promise<{
  jobId: string;
  workerId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  input: any;
  output?: any;
  error?: { message: string; stack?: string };
  metadata?: Record<string, any>;
  internalJobs?: Array<{ jobId: string; workerId: string }>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
} | null> {
  try {
    const coll = await getCollection();
    const doc = await coll.findOne({ _id: jobId });
    if (!doc) return null;
    const { _id, ...r } = doc;
    return r as any;
  } catch (e: any) {
    console.error('[Worker] MongoDB getJobById failed:', {
      jobId,
      error: e?.message ?? String(e),
    });
    return null;
  }
}

/**
 * Create a JobStore that reads/writes directly to MongoDB.
 * Caller must ensure the job exists (upsert on first use).
 */
export function createMongoJobStore(
  workerId: string,
  jobId: string,
  input: any,
  metadata: Record<string, any>
): JobStore {
  return {
    update: async (update: JobStoreUpdate): Promise<void> => {
      try {
        const coll = await getCollection();
        const now = new Date().toISOString();
        const existing = await coll.findOne({ _id: jobId });

        let metadataUpdate: Record<string, any> = { ...(existing?.metadata ?? {}) };
        if (update.metadata) {
          Object.assign(metadataUpdate, update.metadata);
        }
        if (update.progress !== undefined || update.progressMessage !== undefined) {
          metadataUpdate.progress = update.progress;
          metadataUpdate.progressMessage = update.progressMessage;
        }

        const set: Partial<Doc> = {
          updatedAt: now,
          metadata: metadataUpdate,
        };
        if (update.status !== undefined) {
          set.status = update.status;
          if (['completed', 'failed'].includes(update.status) && !existing?.completedAt) {
            set.completedAt = now;
          }
        }
        if (update.output !== undefined) set.output = update.output;
        if (update.error !== undefined) set.error = update.error;

        if (existing) {
          await coll.updateOne({ _id: jobId }, { $set: set });
        } else {
          const doc: Doc = {
            _id: jobId,
            jobId,
            workerId,
            status: (update.status as Doc['status']) ?? 'queued',
            input: input ?? {},
            output: update.output,
            error: update.error,
            metadata: metadataUpdate,
            createdAt: now,
            updatedAt: now,
            completedAt: set.completedAt,
          };
          if (doc.status === 'completed' || doc.status === 'failed') {
            doc.completedAt = doc.completedAt ?? now;
          }
          await coll.updateOne({ _id: jobId }, { $set: doc }, { upsert: true });
        }
      } catch (e: any) {
        console.error('[Worker] MongoDB job store update failed:', {
          jobId,
          workerId,
          error: e?.message ?? String(e),
        });
      }
    },
    get: async () => {
      try {
        const coll = await getCollection();
        const doc = await coll.findOne({ _id: jobId });
        if (!doc) return null;
        const { _id, ...r } = doc;
        return r as any;
      } catch (e: any) {
        console.error('[Worker] MongoDB job store get failed:', {
          jobId,
          workerId,
          error: e?.message ?? String(e),
        });
        return null;
      }
    },
    appendInternalJob: async (entry: { jobId: string; workerId: string }): Promise<void> => {
      try {
        const coll = await getCollection();
        await coll.updateOne(
          { _id: jobId },
          { $push: { internalJobs: entry } }
        );
      } catch (e: any) {
        console.error('[Worker] MongoDB job store appendInternalJob failed:', {
          jobId,
          workerId,
          error: e?.message ?? String(e),
        });
      }
    },
    getJob: async (otherJobId: string): Promise<{
      jobId: string;
      workerId: string;
      status: 'queued' | 'running' | 'completed' | 'failed';
      input: any;
      output?: any;
      error?: { message: string; stack?: string };
      metadata?: Record<string, any>;
      internalJobs?: Array<{ jobId: string; workerId: string }>;
      createdAt: string;
      updatedAt: string;
      completedAt?: string;
    } | null> => {
      try {
        const coll = await getCollection();
        const doc = await coll.findOne({ _id: otherJobId });
        if (!doc) return null;
        const { _id, ...r } = doc;
        return r as any;
      } catch (e: any) {
        console.error('[Worker] MongoDB job store getJob failed:', {
          otherJobId,
          error: e?.message ?? String(e),
        });
        return null;
      }
    },
  };
}

/**
 * Upsert initial job record in MongoDB (queued).
 * Call this when the Lambda starts processing a message.
 */
export async function upsertJob(
  jobId: string,
  workerId: string,
  input: any,
  metadata: Record<string, any>
): Promise<void> {
  const coll = await getCollection();
  const now = new Date().toISOString();
  await coll.updateOne(
    { _id: jobId },
    {
      $set: {
        _id: jobId,
        jobId,
        workerId,
        status: 'queued',
        input: input ?? {},
        metadata: metadata ?? {},
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
}

export function isMongoJobStoreConfigured(): boolean {
  return Boolean(uri?.trim());
}
