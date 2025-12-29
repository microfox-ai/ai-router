import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getJob } from '../jobStore';

const ParamsSchema = z.object({
  jobId: z.string().min(1),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ jobId: string }> }
) {
  try {
    const params = ParamsSchema.parse(await ctx.params);
    const job = await getJob(params.jobId);

    if (!job) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }

    // Return job in the expected format (JobDoc shape expected by the UI)
    return NextResponse.json(
      {
        ok: true,
        job: {
          _id: job._id,
          workerId: job.workerId,
          status: job.status,
          progressPct: job.progressPct,
          logs: job.logs,
          output: job.output,
          error: job.error,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
        },
      },
      { status: 200 },
    );
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: 'Invalid job id', details: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { ok: false, error: error?.message || 'Internal server error' },
      { status: 500 },
    );
  }
}

