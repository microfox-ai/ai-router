/**
 * The dev HTTP server: exposes the same core-group surface a deployed stack has
 * (POST /workers/trigger, GET /workers/config, GET /docs.json,
 * POST /queues/{id}/start — same request/response shapes, same WORKERS_API_KEY
 * auth rule), plus dev conveniences: GET /jobs/{jobId}, GET /jobs, GET /dlq,
 * GET /health. Existing clients (triggerWorker, useWorkflowJob, curl scripts)
 * work by pointing WORKER_BASE_URL at this server.
 */

import * as crypto from 'crypto';
import { Hono } from 'hono';
import type { SQSMessageBody } from '@microfox/ai-worker/handler';
import { loadJobRecordById, getJobStoreKind } from '@microfox/ai-worker/handler';
import { getQueueJob, upsertInitialQueueJob } from '@microfox/ai-worker/queueJobStore';
import {
  listLocalJobs,
  listLocalQueueJobs,
  getLocalQueueJob,
  loadLocalJob,
  patchLocalJob,
  appendLocalInternalJob,
  listLocalJobsByWorker,
  patchLocalQueueJob,
  type LocalQueueJobRecord,
  type LocalQueueJobStep,
} from '@microfox/ai-worker';
import type { DevRegistry } from './registry.js';
import type { DevQueueEngine } from './queueEngine.js';

export interface DevServerOptions {
  registry: DevRegistry;
  engine: DevQueueEngine;
  port: number;
  startedAt: number;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Same rule as the deployed handlers: public unless WORKERS_API_KEY (or legacy alias) is set. */
function checkTriggerAuth(providedKey: string | undefined): boolean {
  const apiKey = process.env.WORKERS_API_KEY || process.env.WORKERS_TRIGGER_API_KEY;
  if (!apiKey) return true;
  return timingSafeEqualStr(providedKey || '', apiKey);
}

function newJobId(): string {
  return 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2, 11);
}

/** Expand a job's internalJobs into a run tree (depth-capped against cycles). */
async function buildJobTree(jobId: string, depth = 0): Promise<Record<string, unknown> | null> {
  const job = await loadJobRecordById(jobId);
  if (!job) return null;
  let children: unknown[] | undefined;
  if (depth < 5 && job.internalJobs && job.internalJobs.length > 0) {
    children = await Promise.all(
      job.internalJobs.map(async (child) => ({
        ...child,
        job: await buildJobTree(child.jobId, depth + 1),
      }))
    );
  }
  return { ...job, ...(children ? { children } : {}) };
}

export function createDevApp(options: DevServerOptions): Hono {
  const { registry, engine, port, startedAt } = options;
  const app = new Hono();

  app.get('/health', (c) =>
    c.json({
      ok: true,
      stage: 'dev',
      store: getJobStoreKind(),
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      reloadGeneration: registry.generation,
      workers: registry.workers.length,
      queues: registry.queues.length,
      queueStats: engine.stats(),
    })
  );

  // Mirrors the deployed /workers/trigger contract (jsonResponse shapes included).
  app.post('/workers/trigger', async (c) => {
    if (!checkTriggerAuth(c.req.header('x-workers-trigger-key'))) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const rawBody = await c.req.text();
    let parsedBody: any = undefined;
    if (rawBody) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = undefined;
      }
    }

    const workerId: unknown = (parsedBody && parsedBody.workerId) || c.req.query('workerId');
    if (!workerId || typeof workerId !== 'string') {
      return c.json(
        { error: 'workerId is required (query param workerId or JSON body workerId)' },
        400
      );
    }

    // Deployed behavior for an unknown worker is a 404 from GetQueueUrl; locally
    // there is no handler to run, so reject with the equivalent shape.
    if (!registry.getWorker(workerId)) {
      return c.json(
        {
          error: 'Queue does not exist or not accessible',
          queueName: `local-${workerId}`,
          message: `No worker "${workerId}" found locally. Known: ${registry.workers.map((w) => w.id).join(', ') || '(none)'}`,
        },
        404
      );
    }

    let messageBody: string | undefined;
    if (parsedBody && typeof parsedBody.messageBody === 'string') {
      messageBody = parsedBody.messageBody;
    } else if (parsedBody && parsedBody.body !== undefined) {
      messageBody =
        typeof parsedBody.body === 'string' ? parsedBody.body : JSON.stringify(parsedBody.body);
    } else if (rawBody) {
      messageBody = rawBody;
    }
    if (!messageBody) {
      return c.json({ error: 'body/messageBody is required' }, 400);
    }

    let sqsBody: SQSMessageBody;
    try {
      sqsBody = JSON.parse(messageBody) as SQSMessageBody;
    } catch {
      return c.json({ error: 'message body must be JSON (an SQS message body object)' }, 400);
    }
    if (!sqsBody.jobId) sqsBody.jobId = newJobId();
    if (!sqsBody.workerId) sqsBody.workerId = workerId;
    if (!sqsBody.timestamp) sqsBody.timestamp = new Date().toISOString();

    const messageId = engine.enqueue(workerId, sqsBody);
    console.log('[workers-trigger] [INFO] message ENQUEUED (local)', {
      workerId,
      jobId: sqsBody.jobId,
      messageId,
    });
    return c.json({
      ok: true,
      workerId,
      stage: 'dev',
      queueName: `local-${workerId}`,
      queueUrl: `local://${workerId}`,
      messageId,
    });
  });

  // Mirrors the deployed /workers/config response shape.
  app.get('/workers/config', async (c) => {
    const apiKey = process.env.WORKERS_API_KEY || process.env.WORKERS_CONFIG_API_KEY;
    if (apiKey) {
      const provided = c.req.header('x-workers-config-key') || '';
      if (!timingSafeEqualStr(provided, apiKey)) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
    }
    const workers: Record<string, { queueUrl: string; region: string; group: string }> = {};
    for (const w of registry.workers) {
      workers[w.id] = { queueUrl: `local://${w.id}`, region: 'local', group: w.group || 'default' };
    }
    const schemas = await registry.getWorkerSchemas();
    return c.json({
      version: '1.0.0',
      stage: 'dev',
      region: 'local',
      workers,
      schemas,
      queues: registry.queues.map((q) => ({ id: q.id, steps: q.steps, schedule: q.schedule })),
    });
  });

  // Mirrors the deployed docs.json (static OpenAPI describing this surface).
  app.get('/docs.json', (c) =>
    c.json({
      openapi: '3.0.3',
      info: {
        title: 'AI Worker Service (local dev)',
        version: '1.0.0',
        description:
          'Local dev server started by `ai-worker dev` — same surface as the deployed core group.',
      },
      servers: [{ url: `http://localhost:${port}` }],
      paths: {
        '/docs.json': { get: { operationId: 'getDocs', summary: 'Get OpenAPI schema' } },
        '/workers/config': {
          get: { operationId: 'getWorkersConfig', summary: 'Get workers config (queue urls map)' },
        },
        '/workers/trigger': {
          post: {
            operationId: 'triggerWorker',
            summary: 'Trigger a worker by sending a raw SQS message body',
          },
        },
        ...Object.fromEntries(
          registry.queues.map((q) => [
            `/queues/${q.id}/start`,
            {
              post: { operationId: `startQueue_${q.id}`, summary: `Start queue "${q.id}"` },
            },
          ])
        ),
        '/jobs/{jobId}': {
          get: { operationId: 'getJob', summary: 'Get a job run tree (dev only)' },
        },
        '/dlq': { get: { operationId: 'getDlq', summary: 'Local dead-letter queue (dev only)' } },
        '/health': { get: { operationId: 'health', summary: 'Dev server health' } },
      },
      'x-service': { serviceName: 'local-dev', stage: 'dev', region: 'local' },
    })
  );

  // Mirrors the deployed queue starter HTTP path.
  app.post('/queues/:queueId/start', async (c) => {
    if (!checkTriggerAuth(c.req.header('x-workers-trigger-key'))) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const queueId = c.req.param('queueId');
    await registry.ensureQueueConfigs();
    const queue = registry.getQueue(queueId);
    const firstWorkerId = queue?.steps?.[0]?.workerId;
    if (!queue || !firstWorkerId) {
      return c.json(
        {
          error: `Unknown queue "${queueId}". Known: ${registry.queues.map((q) => q.id).join(', ') || '(none)'}`,
        },
        404
      );
    }

    let body: {
      input?: any;
      initialInput?: any;
      jobId?: string;
      metadata?: any;
      context?: any;
      webhookUrl?: string;
    } = {};
    try {
      const raw = await c.req.text();
      if (raw) body = JSON.parse(raw);
    } catch {
      // tolerate empty/invalid body like the deployed starter
    }

    const jobId = (body.jobId && String(body.jobId).trim()) || newJobId();
    const rawInput = body.input != null ? body.input : body.initialInput;
    const initialInput = rawInput != null && typeof rawInput === 'object' ? rawInput : {};
    const context = body.context && typeof body.context === 'object' ? body.context : {};
    const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
    if (metadata.__trigger === undefined) {
      metadata.__trigger = { type: 'external', at: new Date().toISOString() };
    }

    try {
      await upsertInitialQueueJob({
        queueJobId: jobId,
        queueId,
        firstWorkerId,
        firstWorkerJobId: jobId,
        metadata,
      });
      const queueContext = { id: queueId, stepIndex: 0, initialInput, queueJobId: jobId };
      const messageBody: SQSMessageBody = {
        workerId: firstWorkerId,
        jobId,
        input: { ...initialInput, __workerQueue: queueContext },
        context,
        metadata: { ...metadata, __workerQueue: queueContext },
        ...(typeof body.webhookUrl === 'string' ? { webhookUrl: body.webhookUrl } : {}),
        timestamp: new Date().toISOString(),
      };
      engine.enqueue(firstWorkerId, messageBody);
      console.log('[queue] Dispatched first worker (local)', {
        queueId,
        jobId,
        workerId: firstWorkerId,
      });
      return c.json({ queueId, jobId, status: 'queued' });
    } catch (err: any) {
      return c.json({ error: err?.message || String(err) }, 500);
    }
  });

  // Dev convenience: run tree for a job (+ queue doc when the job is part of a queue).
  app.get('/jobs/:jobId', async (c) => {
    const jobId = c.req.param('jobId');
    const job = await buildJobTree(jobId);
    // Queue starter uses the queueJobId as the first worker's jobId, so try both:
    // the job's own __workerQueue context, then the raw id as a queueJobId.
    const queueCtx =
      (job?.input as any)?.__workerQueue ?? (job?.metadata as any)?.__workerQueue;
    // On the local store return the FULL queue doc (incl. step input — the parked
    // HITL pending input lives there); real stores expose the standard projection.
    const loadQueueDoc =
      getJobStoreKind() === 'local' ? getLocalQueueJob : getQueueJob;
    const queueJob =
      (queueCtx?.queueJobId ? await loadQueueDoc(queueCtx.queueJobId) : null) ??
      (await loadQueueDoc(jobId));
    if (!job && !queueJob) {
      return c.json({ error: `No job or queue job found for "${jobId}"` }, 404);
    }
    return c.json({ job, queueJob });
  });

  // Dev convenience: list everything in the local store (local store only).
  app.get('/jobs', (c) => {
    if (getJobStoreKind() !== 'local') {
      return c.json(
        {
          error:
            'Job listing is only available with the local store (WORKER_DATABASE_TYPE=local). Your dev server is using a real store — query it directly.',
        },
        400
      );
    }
    const jobs = listLocalJobs().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const queueJobs = listLocalQueueJobs().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return c.json({ jobs, queueJobs });
  });

  app.get('/dlq', (c) => c.json({ count: engine.dlq.length, messages: engine.dlq }));

  // === /dev-store — store API for the app boilerplate's `local` adapter ===
  // The Next.js app runs in a separate process, so when the dev server uses the
  // local store the app's job/queue routes read AND write through these
  // endpoints instead of Redis/Mongo. Same auth rule as /workers/trigger.
  const requireLocalStore = (c: any): Response | null => {
    if (!checkTriggerAuth(c.req.header('x-workers-trigger-key'))) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    if (getJobStoreKind() !== 'local') {
      return c.json(
        {
          error:
            'The /dev-store API is only served when the dev server uses the local store (WORKER_DATABASE_TYPE=local). This server is using a real store — point your app at it directly.',
        },
        400
      );
    }
    return null;
  };

  app.get('/dev-store/jobs/:jobId', async (c) => {
    const denied = requireLocalStore(c);
    if (denied) return denied;
    const job = await loadLocalJob(c.req.param('jobId'));
    return job ? c.json(job) : c.json({ error: 'not found' }, 404);
  });

  // Upsert + shallow merge — serves both setJob (full record) and updateJob (partial).
  app.put('/dev-store/jobs/:jobId', async (c) => {
    const denied = requireLocalStore(c);
    if (denied) return denied;
    const partial = await c.req.json().catch(() => null);
    if (!partial || typeof partial !== 'object') {
      return c.json({ error: 'JSON body required' }, 400);
    }
    return c.json(await patchLocalJob(c.req.param('jobId'), partial));
  });

  app.post('/dev-store/jobs/:jobId/internal-jobs', async (c) => {
    const denied = requireLocalStore(c);
    if (denied) return denied;
    const entry = await c.req.json().catch(() => null);
    if (!entry?.jobId || !entry?.workerId) {
      return c.json({ error: 'jobId and workerId required' }, 400);
    }
    await appendLocalInternalJob(c.req.param('jobId'), entry);
    return c.json({ ok: true });
  });

  app.get('/dev-store/jobs', (c) => {
    const denied = requireLocalStore(c);
    if (denied) return denied;
    const workerId = c.req.query('workerId');
    return c.json(workerId ? listLocalJobsByWorker(workerId) : listLocalJobs());
  });

  app.get('/dev-store/queue-jobs/:queueJobId', async (c) => {
    const denied = requireLocalStore(c);
    if (denied) return denied;
    const record = await getLocalQueueJob(c.req.param('queueJobId'));
    return record ? c.json(record) : c.json({ error: 'not found' }, 404);
  });

  // Upsert + shallow merge (steps array replaced when provided) — serves
  // createQueueJob (full record) and updateQueueJob (status/completedAt).
  app.put('/dev-store/queue-jobs/:queueJobId', async (c) => {
    const denied = requireLocalStore(c);
    if (denied) return denied;
    const partial = await c.req.json().catch(() => null);
    if (!partial || typeof partial !== 'object') {
      return c.json({ error: 'JSON body required' }, 400);
    }
    return c.json(await patchLocalQueueJob(c.req.param('queueJobId'), partial));
  });

  app.post('/dev-store/queue-jobs/:queueJobId/steps', async (c) => {
    const denied = requireLocalStore(c);
    if (denied) return denied;
    const step = await c.req.json().catch(() => null);
    if (!step?.workerId || !step?.workerJobId) {
      return c.json({ error: 'workerId and workerJobId required' }, 400);
    }
    const queueJobId = c.req.param('queueJobId');
    const existing = await getLocalQueueJob(queueJobId);
    if (!existing) return c.json({ error: `Queue job ${queueJobId} not found` }, 404);
    existing.steps.push({
      workerId: step.workerId,
      workerJobId: step.workerJobId,
      status: 'queued',
    });
    await patchLocalQueueJob(queueJobId, { steps: existing.steps });
    return c.json({ ok: true });
  });

  // Step merge + queue-status rollup — mirrors the boilerplate updateQueueStep semantics.
  app.put('/dev-store/queue-jobs/:queueJobId/steps/:stepIndex', async (c) => {
    const denied = requireLocalStore(c);
    if (denied) return denied;
    const update = await c.req.json().catch(() => null);
    if (!update || typeof update !== 'object') {
      return c.json({ error: 'JSON body required' }, 400);
    }
    const queueJobId = c.req.param('queueJobId');
    const stepIndex = parseInt(c.req.param('stepIndex'), 10);
    const existing = await getLocalQueueJob(queueJobId);
    if (!existing) return c.json({ error: `Queue job ${queueJobId} not found` }, 404);
    const step = existing.steps[stepIndex];
    if (!step) {
      return c.json({ error: `Queue job ${queueJobId} has no step at index ${stepIndex}` }, 404);
    }
    const now = new Date().toISOString();
    const mergedStep: LocalQueueJobStep = {
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
    const rollup: Partial<LocalQueueJobRecord> = { steps };
    if (update.status === 'failed') {
      rollup.status = 'failed';
      if (!existing.completedAt) rollup.completedAt = now;
    } else if (update.status === 'completed' && stepIndex === steps.length - 1) {
      rollup.status = 'completed';
      if (!existing.completedAt) rollup.completedAt = now;
    }
    await patchLocalQueueJob(queueJobId, rollup);
    return c.json({ ok: true });
  });

  app.get('/dev-store/queue-jobs', (c) => {
    const denied = requireLocalStore(c);
    if (denied) return denied;
    const queueId = c.req.query('queueId');
    const limit = parseInt(c.req.query('limit') || '50', 10) || 50;
    const records = listLocalQueueJobs()
      .filter((r) => !queueId || r.queueId === queueId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);
    return c.json(records);
  });

  app.get('/', (c) =>
    c.text(
      [
        'ai-worker dev server',
        '',
        'POST /workers/trigger        trigger a worker (same shape as deployed)',
        'GET  /workers/config         worker/queue map + input schemas',
        'GET  /docs.json              OpenAPI',
        'POST /queues/{id}/start      start a queue run',
        'GET  /jobs/{jobId}           job run tree (+ queue doc)',
        'GET  /jobs                   all local jobs (local store only)',
        'GET  /dlq                    local dead-letter queue',
        'GET  /health                 server status',
      ].join('\n')
    )
  );

  return app;
}
