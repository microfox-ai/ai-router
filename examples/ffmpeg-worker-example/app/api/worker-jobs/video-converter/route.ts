import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { videoConverterWorker } from '@/app/ai/agents/ffmpeg/video-converter.worker';
import { createJob } from '../jobStore';

const CreateJobSchema = z.object({
  mediaUrl: z.string().url(),
  outputFormat: z.enum(['mp4', 'webm', 'mov', 'avi']).optional(),
  resolution: z.string().regex(/^\d+x\d+$/).optional(),
  quality: z.number().int().min(0).max(51).optional(),
  maxBytes: z.number().int().min(128 * 1024).max(100 * 1024 * 1024).optional(),
  timeoutMs: z.number().int().min(5000).max(600_000).optional(),
});

function canDispatchRemote(): boolean {
  return Boolean(process.env.WORKER_BASE_URL);
}

function getWebhookUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}` 
    : 'http://localhost:3000';
  return `${baseUrl}/api/ai/callback`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = CreateJobSchema.parse(body);

    const dispatchMode = canDispatchRemote() ? 'remote' : 'local';

    const { jobId } = await videoConverterWorker.dispatch(input, {
      mode: dispatchMode,
      webhookUrl: getWebhookUrl(),
      metadata: { workerId: videoConverterWorker.id },
    });

    // Create job record in store
    await createJob({
      jobId,
      workerId: videoConverterWorker.id,
      input,
      metadata: { dispatchMode },
    });

    return NextResponse.json(
      {
        ok: true,
        jobId,
        workerId: videoConverterWorker.id,
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

