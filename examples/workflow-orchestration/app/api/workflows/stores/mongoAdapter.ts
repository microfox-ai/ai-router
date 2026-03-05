/**
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
      throw new Error(`Job ${jobId} not found`);
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
