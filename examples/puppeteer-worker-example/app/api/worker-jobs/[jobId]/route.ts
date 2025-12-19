import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getJob } from '@/app/ai/agents/shared/jobStore';

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

    return NextResponse.json({ ok: true, job }, { status: 200 });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: 'Invalid job id', details: error.message },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { ok: false, error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}


