'use server';

import type { Collection, WithId } from 'mongodb';
import { getMongoDb } from './mongo';

export type WorkerJobStatus = 'queued' | 'running' | 'success' | 'error';

export type WorkerJobError = {
  message: string;
  name?: string;
  stack?: string;
};

export type WorkerJobDoc = {
  _id: string; // jobId
  workerId: string;
  status: WorkerJobStatus;
  progressPct: number; // 0..100
  input?: unknown;
  metadata?: Record<string, unknown>;
  logs: Array<{ at: string; message: string }>;
  output?: unknown;
  error?: WorkerJobError;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

function nowIso() {
  return new Date().toISOString();
}

function getCollectionName(): string {
  return process.env.DATABASE_MONGODB_COLLECTION || 'ai_worker_jobs';
}

async function col(): Promise<Collection<WorkerJobDoc>> {
  const db = await getMongoDb();
  return db.collection<WorkerJobDoc>(getCollectionName());
}

function toJobError(error: unknown): WorkerJobError {
  if (error && typeof error === 'object') {
    const e = error as any;
    return {
      message: String(e.message || 'Unknown error'),
      name: e.name ? String(e.name) : undefined,
      stack: e.stack ? String(e.stack) : undefined,
    };
  }
  return { message: String(error || 'Unknown error') };
}

export async function createJob(params: {
  jobId: string;
  workerId: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
}) {
  const { jobId, workerId, input, metadata } = params;
  const ts = nowIso();
  const c = await col();

  await c.updateOne(
    { _id: jobId },
    {
      $setOnInsert: {
        _id: jobId,
        workerId,
        status: 'queued',
        progressPct: 0,
        input,
        metadata,
        logs: [],
        createdAt: ts,
      },
      $set: {
        updatedAt: ts,
      },
    },
    { upsert: true }
  );
}

export async function appendLog(jobId: string, message: string) {
  const ts = nowIso();
  const c = await col();
  await c.updateOne(
    { _id: jobId },
    {
      $set: { updatedAt: ts },
      $push: { logs: { at: ts, message } },
    }
  );
}

export async function markRunning(jobId: string) {
  const ts = nowIso();
  const c = await col();
  await c.updateOne(
    { _id: jobId },
    {
      $set: { status: 'running', startedAt: ts, updatedAt: ts },
      $max: { progressPct: 1 },
    }
  );
}

export async function setProgress(jobId: string, progressPct: number, log?: string) {
  const ts = nowIso();
  const c = await col();
  const pct = Math.max(0, Math.min(100, Math.round(progressPct)));

  const update: any = {
    $set: { updatedAt: ts },
    $max: { progressPct: pct },
  };

  if (log) {
    update.$push = { logs: { at: ts, message: log } };
  }

  await c.updateOne({ _id: jobId }, update);
}

export async function markSuccess(jobId: string, output: unknown) {
  const ts = nowIso();
  const c = await col();
  await c.updateOne(
    { _id: jobId },
    {
      $set: {
        status: 'success',
        progressPct: 100,
        output,
        finishedAt: ts,
        updatedAt: ts,
      },
      $unset: { error: '' },
    }
  );
}

export async function markError(jobId: string, error: unknown) {
  const ts = nowIso();
  const c = await col();
  await c.updateOne(
    { _id: jobId },
    {
      $set: {
        status: 'error',
        error: toJobError(error),
        finishedAt: ts,
        updatedAt: ts,
      },
    }
  );
}

export async function getJob(jobId: string): Promise<WithId<WorkerJobDoc> | null> {
  const c = await col();
  return c.findOne({ _id: jobId });
}

