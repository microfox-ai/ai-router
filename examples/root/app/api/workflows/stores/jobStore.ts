/**
 * Job store for tracking worker job status and results.
 * 
 * Provides persistent storage for worker job state.
 * 
 * Supports multiple storage backends:
 * 1. In-memory (dev only): Map<string, JobRecord>
 * 2. MongoDB: Persistent, production-ready
 * 3. Upstash Redis: Persistent, fast, serverless-friendly
 * 4. Supabase: PostgreSQL with real-time subscriptions (TODO)
 * 
 * Storage backend is determined by `microfox.config.ts` -> `studioSettings.database.type`:
 * - 'local' or 'memory': In-memory storage (default, dev only)
 * - 'mongodb': MongoDB storage (config or env: DATABASE_MONGODB_URI)
 * - 'upstash-redis': Upstash Redis storage (config or env: UPSTASH_REDIS_URL, UPSTASH_REDIS_TOKEN)
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

// In-memory job store adapter (for development)
const memoryJobStoreMap = new Map<string, JobRecord>();
const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const memoryJobStore: JobStoreAdapter = {
  async setJob(jobId: string, data: Partial<JobRecord>): Promise<void> {
    const now = new Date().toISOString();
    const existing = memoryJobStoreMap.get(jobId);
    
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

    if (data.status && ['completed', 'failed'].includes(data.status) && !record.completedAt) {
      record.completedAt = now;
    }

    memoryJobStoreMap.set(jobId, record);

    // Schedule cleanup after TTL
    if (existing) {
      clearTimeout((existing as any)._ttlTimeout);
    }
    (record as any)._ttlTimeout = setTimeout(() => {
      memoryJobStoreMap.delete(jobId);
    }, JOB_TTL_MS);
  },

  async getJob(jobId: string): Promise<JobRecord | null> {
    const record = memoryJobStoreMap.get(jobId);
    if (!record) {
      return null;
    }
    const { _ttlTimeout, ...cleanRecord } = record as any;
    return cleanRecord as JobRecord;
  },

  async updateJob(jobId: string, data: Partial<JobRecord>): Promise<void> {
    const existing = await memoryJobStore.getJob(jobId);
    if (!existing) {
      throw new Error(`Job ${jobId} not found`);
    }
    await memoryJobStore.setJob(jobId, data);
  },

  async listJobsByWorker(workerId: string): Promise<JobRecord[]> {
    const jobs: JobRecord[] = [];
    for (const record of memoryJobStoreMap.values()) {
      if (record.workerId === workerId) {
        const { _ttlTimeout, ...cleanRecord } = record as any;
        jobs.push(cleanRecord);
      }
    }
    jobs.sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return bTime - aTime;
    });
    return jobs;
  },
};

// Get storage adapter based on config
function getStorageAdapter(): JobStoreAdapter {
  try {
    // Try to get config (may not be available in all contexts)
    const config = require('@/microfox.config').StudioConfig;
    const dbType = config?.studioSettings?.database?.type || process.env.DATABASE_TYPE || 'local';
    
    if (dbType === 'mongodb') {
      // Dynamically import MongoDB adapter
      const { mongoJobStore } = require('./mongoAdapter');
      return mongoJobStore;
    }
    
    if (dbType === 'upstash-redis') {
      // Dynamically import Upstash Redis adapter
      const { upstashRedisJobStore } = require('./upstashRedisAdapter');
      return upstashRedisJobStore;
    }
  } catch (error) {
    // Config not available or adapter not configured, fall back to memory
  }
  
  // Default to in-memory storage
  return memoryJobStore;
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
  const adapter = getAdapter();
  await adapter.setJob(jobId, data);
}

/**
 * Get a job record.
 */
export async function getJob(jobId: string): Promise<JobRecord | null> {
  const adapter = getAdapter();
  return adapter.getJob(jobId);
}

/**
 * Update a job record.
 */
export async function updateJob(jobId: string, data: Partial<JobRecord>): Promise<void> {
  const adapter = getAdapter();
  await adapter.updateJob(jobId, data);
  
  // If status changed to completed/failed and output exists, notify Upstash workflow
  // This allows Upstash workflows in await mode to continue
  if (data.status && ['completed', 'failed'].includes(data.status) && data.output !== undefined) {
    try {
      // Try to notify Upstash workflow if available
      const { getWorkflowConfig } = await import('@microfox/ai-router');
      const config = getWorkflowConfig();
      
      if (config.provider === 'upstash') {
        const { Client } = await import('@upstash/workflow');
        const client = new Client({
          token: config.adapters.upstash?.token || '',
        });
        
        // Notify with jobId as eventId
        await client.notify({
          eventId: jobId,
          eventData: { status: data.status, output: data.output, error: data.error },
        });
      }
    } catch (error) {
      // Silently fail if Upstash not available or notification fails
      // This is optional functionality
    }
  }
}

/**
 * List jobs by worker ID.
 */
export async function listJobsByWorker(workerId: string): Promise<JobRecord[]> {
  const adapter = getAdapter();
  return adapter.listJobsByWorker(workerId);
}
