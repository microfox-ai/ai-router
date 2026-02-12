import { NextRequest, NextResponse } from 'next/server';
import {
  createQueueJob,
  getQueueJob,
  listQueueJobs,
} from '../stores/queueJobStore';

export const dynamic = 'force-dynamic';

const LOG = '[QueueJobs]';

/**
 * POST /api/workflows/queue-jobs
 * Create a new queue job. Called by dispatchQueue when starting a queue.
 * Body: { id, queueId, firstStep: { workerId, workerJobId }, metadata? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, queueId, firstStep, metadata } = body;
    if (!id || !queueId || !firstStep?.workerId || !firstStep?.workerJobId) {
      return NextResponse.json(
        {
          error:
            'id, queueId, and firstStep.workerId, firstStep.workerJobId are required',
        },
        { status: 400 }
      );
    }
    await createQueueJob(id, queueId, firstStep, metadata);
    console.log(`${LOG} Created`, { queueJobId: id, queueId, firstWorker: firstStep.workerId });
    return NextResponse.json({ ok: true, id, queueId }, { status: 201 });
  } catch (e: any) {
    console.error(`${LOG} POST error:`, e?.message ?? e);
    return NextResponse.json(
      { error: e?.message ?? 'Failed to create queue job' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/workflows/queue-jobs?queueId=...
 * List queue jobs. Optional queueId filter.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const queueId = searchParams.get('queueId') ?? undefined;
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10) || 50)
    );
    const jobs = await listQueueJobs(queueId, limit);
    return NextResponse.json({ jobs });
  } catch (e: any) {
    console.error('[queue-jobs] GET error:', e);
    return NextResponse.json(
      { error: e?.message ?? 'Failed to list queue jobs' },
      { status: 500 }
    );
  }
}
