/**
 * Workflow status store for tracking orchestration workflow status and metadata.
 *
 * One record per workflow (keyed by runId). executionId is stored on the same record.
 * Lookup by executionId uses getRunIdByExecutionId (Mongo: query by executionId;
 * memory: lightweight executionId→runId mapping). No separate mapping collection.
 *
 * Provides persistent storage for orchestration workflow state, including:
 * - Current status (pending, running, paused, completed, failed)
 * - Hook tokens when workflow is paused
 * - Step results and context
 * - Error information
 *
 * Supports multiple storage backends:
 * 1. In-memory (dev only): Map<string, WorkflowStatusRecord>
 * 2. MongoDB: Persistent, production-ready. Index { executionId: 1 } recommended for run-id lookups.
 *
 * Storage backend is determined by `microfox.config.ts` -> `studioSettings.database.type`:
 * - 'local' or 'memory': In-memory storage (default, dev only)
 * - 'mongodb': MongoDB storage (config or env: DATABASE_MONGODB_URI)
 *
 * MongoDB collection: config -> studioSettings.database.mongodb.workflowStatusCollection
 * (default: 'workflow_status'). Env fallback: DATABASE_MONGODB_WORKFLOW_STATUS_COLLECTION.
 *
 * Workflow status record structure:
 * {
 *   runId: string,
 *   executionId?: string,  // Client-provided; used for run-id API lookup
 *   status: 'pending' | 'running' | 'paused' | 'completed' | 'failed',
 *   hookToken?: string,  // Token when paused on hook
 *   result?: any,
 *   error?: { message: string, stack?: string },
 *   metadata?: Record<string, any>,
 *   createdAt: string,
 *   updatedAt: string,
 *   completedAt?: string
 * }
 */

export interface WorkflowStatusRecord {
  runId: string;
  executionId?: string;  // Unique execution ID (provided by client, stored at parent level)
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  hookToken?: string;  // Token when paused on hook
  result?: any;
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
interface WorkflowStatusStoreAdapter {
  setStatus(runId: string, data: Partial<WorkflowStatusRecord>): Promise<void>;
  getStatus(runId: string): Promise<WorkflowStatusRecord | null>;
  updateStatus(runId: string, data: Partial<WorkflowStatusRecord>): Promise<void>;
  getRunIdByExecutionId(executionId: string): Promise<string | null>;
}

// In-memory storage (dev only)
const memoryStore = new Map<string, WorkflowStatusRecord>();
const executionIdToRunId = new Map<string, string>();

const memoryAdapter: WorkflowStatusStoreAdapter = {
  async setStatus(runId: string, data: Partial<WorkflowStatusRecord>): Promise<void> {
    const now = new Date().toISOString();
    const documentRunId = data.runId !== undefined ? data.runId : runId;
    const existing = memoryStore.get(documentRunId);

    const hookToken = 'hookToken' in data ? data.hookToken : existing?.hookToken;

    const record: WorkflowStatusRecord = {
      runId: documentRunId,
      executionId: data.executionId !== undefined ? data.executionId : existing?.executionId,
      status: data.status || existing?.status || 'pending',
      hookToken,
      result: data.result !== undefined ? data.result : existing?.result,
      error: data.error !== undefined ? data.error : existing?.error,
      metadata: { ...existing?.metadata, ...data.metadata },
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      completedAt: data.completedAt || existing?.completedAt,
    };

    if (data.status && ['completed', 'failed'].includes(data.status) && !record.completedAt) {
      record.completedAt = now;
    }

    memoryStore.set(documentRunId, record);
    if (record.executionId) {
      executionIdToRunId.set(record.executionId, documentRunId);
    }
  },

  async getStatus(runId: string): Promise<WorkflowStatusRecord | null> {
    return memoryStore.get(runId) || null;
  },

  async updateStatus(runId: string, data: Partial<WorkflowStatusRecord>): Promise<void> {
    await this.setStatus(runId, data);
  },

  async getRunIdByExecutionId(executionId: string): Promise<string | null> {
    return executionIdToRunId.get(executionId) ?? null;
  },
};

// MongoDB adapter
async function getMongoCollection() {
  const { MongoClient } = await import('mongodb');
  const config = (await import('@/microfox.config')).StudioConfig;
  const uri = config.studioSettings.database.mongodb.uri;
  const dbName = config.studioSettings.database.mongodb.db || 'ai_router';
  const collectionName =
    config.studioSettings.database.mongodb.workflowStatusCollection ||
    process.env.DATABASE_MONGODB_WORKFLOW_STATUS_COLLECTION ||
    'workflow_status';

  if (!uri) {
    throw new Error('MongoDB URI not configured. Set DATABASE_MONGODB_URI or configure in microfox.config.ts');
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  return db.collection<WorkflowStatusRecord>(collectionName);
}

const mongoAdapter: WorkflowStatusStoreAdapter = {
  async setStatus(runId: string, data: Partial<WorkflowStatusRecord>): Promise<void> {
    try {
      const now = new Date().toISOString();
      const collection = await getMongoCollection();
      const documentRunId = data.runId !== undefined ? data.runId : runId;
      const existing = await collection.findOne({ runId: documentRunId });

      const hookToken = 'hookToken' in data ? data.hookToken : existing?.hookToken;

      const record: WorkflowStatusRecord = {
        runId: documentRunId,
        executionId: data.executionId !== undefined ? data.executionId : existing?.executionId,
        status: data.status || existing?.status || 'pending',
        hookToken,
        result: data.result !== undefined ? data.result : existing?.result,
        error: data.error !== undefined ? data.error : existing?.error,
        metadata: { ...existing?.metadata, ...data.metadata },
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        completedAt: data.completedAt || existing?.completedAt,
      };

      if (data.status && ['completed', 'failed'].includes(data.status) && !record.completedAt) {
        record.completedAt = now;
      }

      await collection.updateOne(
        { runId: documentRunId },
        { $set: record },
        { upsert: true }
      );
    } catch (error: any) {
      console.error('[WorkflowStatusStore] MongoDB setStatus error:', {
        runId,
        error: error?.message || String(error),
      });
      throw error;
    }
  },

  async getStatus(runId: string): Promise<WorkflowStatusRecord | null> {
    try {
      const collection = await getMongoCollection();
      const record = await collection.findOne({ runId });
      return record;
    } catch (error: any) {
      console.error('[WorkflowStatusStore] MongoDB getStatus error:', {
        runId,
        error: error?.message || String(error),
      });
      return null;
    }
  },

  async updateStatus(runId: string, data: Partial<WorkflowStatusRecord>): Promise<void> {
    await this.setStatus(runId, data);
  },

  async getRunIdByExecutionId(executionId: string): Promise<string | null> {
    try {
      const collection = await getMongoCollection();
      const record = await collection.findOne({ executionId });
      return record?.runId ?? null;
    } catch (error: any) {
      console.error('[WorkflowStatusStore] MongoDB getRunIdByExecutionId error:', {
        executionId,
        error: error?.message || String(error),
      });
      return null;
    }
  },
};

// Get storage adapter based on config
function getStorageAdapter(): WorkflowStatusStoreAdapter {
  const config = require('@/microfox.config').StudioConfig;
  const dbType = config.studioSettings.database.type || 'local';

  switch (dbType) {
    case 'mongodb':
      return mongoAdapter;
    case 'local':
    case 'memory':
    default:
      return memoryAdapter;
  }
}

// Export store functions
export const workflowStatusStore = {
  /**
   * Set or create workflow status record
   */
  async setStatus(runId: string, data: Partial<WorkflowStatusRecord>): Promise<void> {
    try {
      const adapter = getStorageAdapter();
      await adapter.setStatus(runId, data);
    } catch (error: any) {
      console.error('[WorkflowStatusStore] Error setting status:', {
        runId,
        error: error?.message || String(error),
      });
      // Don't throw - status store updates shouldn't fail the workflow
    }
  },

  /**
   * Get workflow status record
   */
  async getStatus(runId: string): Promise<WorkflowStatusRecord | null> {
    try {
      const adapter = getStorageAdapter();
      return await adapter.getStatus(runId);
    } catch (error: any) {
      console.error('[WorkflowStatusStore] Error getting status:', {
        runId,
        error: error?.message || String(error),
      });
      return null;
    }
  },

  /**
   * Update workflow status record (alias for setStatus)
   */
  async updateStatus(runId: string, data: Partial<WorkflowStatusRecord>): Promise<void> {
    await this.setStatus(runId, data);
  },

  /**
   * Get runId by executionId (for run-id lookup API). Uses executionId on main record
   * (Mongo) or a lightweight executionId→runId mapping (memory).
   */
  async getRunIdByExecutionId(executionId: string): Promise<string | null> {
    try {
      const adapter = getStorageAdapter();
      return await adapter.getRunIdByExecutionId(executionId);
    } catch (error: any) {
      console.error('[WorkflowStatusStore] Error getRunIdByExecutionId:', {
        executionId,
        error: error?.message || String(error),
      });
      return null;
    }
  },
};
