import { NextRequest, NextResponse } from 'next/server';
import { dispatchQueue } from '@microfox/ai-worker';
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

    if (action === 'update') {
      return handleQueueJobUpdate(req, queueId);
    }
    if (action === 'webhook') {
      return handleQueueWebhook(req, queueId);
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
    });

    console.log(`${LOG} Queue triggered`, {
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
        queueJobUrl: `/api/workflows/queues/${queueId}/${result.jobId}`,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`${LOG} POST error:`, err.message, err.stack);
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
    console.error(`${LOG} GET error:`, err.message);
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
    console.log(`${LOG} Step appended`, { queueJobId: id, workerId, workerJobId });
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
    console.log(`${LOG} Step started`, { queueJobId: id, stepIndex, workerJobId });
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
    console.log(`${LOG} Step completed`, { queueJobId: id, stepIndex, workerJobId });
    return NextResponse.json({ ok: true, action: 'complete' });
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
    console.log(`${LOG} Step failed`, { queueJobId: id, stepIndex, workerJobId });
    return NextResponse.json({ ok: true, action: 'fail' });
  }

  return NextResponse.json(
    { error: `Unknown action: ${action}. Use start|complete|fail|append` },
    { status: 400 }
  );
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
      console.log(`${LOG} Webhook received and queue job updated:`, {
        queueJobId: id,
        queueId,
        status: jobStatus,
      });
    } catch (updateError: unknown) {
      const err = updateError instanceof Error ? updateError : new Error(String(updateError));
      console.error(`${LOG} Failed to update queue job from webhook:`, {
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
    console.error(`${LOG} Error handling queue webhook:`, { queueId, error: err.message });
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
