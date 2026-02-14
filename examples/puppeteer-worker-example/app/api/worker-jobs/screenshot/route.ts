import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { screenshotWorker } from '@/app/ai/agents/puppeteer/screenshot.worker';

const CreateJobSchema = z.object({
  url: z.string().url(),
  fullPage: z.boolean().optional().default(false),
  viewport: z
    .object({
      width: z.number().int().min(240).max(3840).optional().default(1280),
      height: z.number().int().min(240).max(2160).optional().default(720),
    })
    .optional()
    .default({ width: 1280, height: 720 }),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']).optional().default('networkidle2'),
  quality: z.number().int().min(0).max(100).optional().default(90),
  returnBase64: z.boolean().optional().default(true),
});

function canDispatchRemote(): boolean {
  return Boolean(process.env.WORKER_BASE_URL);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = CreateJobSchema.parse(body);

    const dispatchMode = canDispatchRemote() ? 'remote' : 'local';

    const { jobId } = await screenshotWorker.dispatch(input, {
      mode: dispatchMode,
      metadata: { workerId: screenshotWorker.id },
    });

    return NextResponse.json(
      {
        ok: true,
        jobId,
        workerId: screenshotWorker.id,
        dispatchMode,
        statusUrl: `/api/worker-jobs/${jobId}`,
      },
      { status: 200 }
    );
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: 'Invalid input', details: error.message },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { ok: false, error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

