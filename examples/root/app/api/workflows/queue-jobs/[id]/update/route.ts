import { NextRequest, NextResponse } from 'next/server';
import { updateQueueStep, appendQueueStep } from '../../../stores/queueJobStore';

export const dynamic = 'force-dynamic';

const LOG = '[QueueJobs]';

/**
 * POST /api/workflows/queue-jobs/:id/update
 * Update a queue job step. Called by Lambda workers when __workerQueue is present.
 *
 * Lambda env: Set WORKFLOW_APP_BASE_URL or QUEUE_JOB_API_URL so workers can reach this endpoint
 * (e.g. https://your-app.vercel.app or https://your-app.vercel.app/api/workflows/queue-jobs).
 *
 * Body:
 * - action: 'start' | 'complete' | 'fail' | 'append'
 * - stepIndex: number
 * - workerJobId: string (required for start/complete/fail)
 * - workerId?: string (required for append)
 * - output?: any (for complete)
 * - error?: { message: string } (for fail)
 * - input?: any (optional, for start)
 *
 * For append: adds a new step at the given index with status 'queued'.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }
    const body = await req.json();
    const { action, stepIndex, workerJobId, workerId, output, error, input } =
      body;

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
      console.log(`${LOG} Step failed`, { queueJobId: id, stepIndex, workerJobId, error: error?.message });
      return NextResponse.json({ ok: true, action: 'fail' });
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}. Use start|complete|fail|append` },
      { status: 400 }
    );
  } catch (e: any) {
    console.error(`${LOG} Update error:`, e?.message ?? e);
    return NextResponse.json(
      { error: e?.message ?? 'Failed to update queue job' },
      { status: 500 }
    );
  }
}
