import { NextRequest, NextResponse } from 'next/server';
import { getQueueJob } from '../../stores/queueJobStore';

export const dynamic = 'force-dynamic';

const LOG = '[QueueJobs]';

/**
 * GET /api/workflows/queue-jobs/:id
 * Get a single queue job by ID.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }
    const job = await getQueueJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Queue job not found' }, { status: 404 });
    }
    if (process.env.DEBUG?.includes('queue') || process.env.DEBUG_WORKER_QUEUES === '1') {
      console.log(`${LOG} GET`, { queueJobId: id, status: job.status, steps: job.steps?.length });
    }
    return NextResponse.json(job);
  } catch (e: any) {
    console.error(`${LOG} GET error:`, e?.message ?? e);
    return NextResponse.json(
      { error: e?.message ?? 'Failed to get queue job' },
      { status: 500 }
    );
  }
}
