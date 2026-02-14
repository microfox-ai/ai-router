'use server';

import { z } from 'zod';
import { videoConverterWorker } from '../workers/video-converter.worker';
import { createJob } from '@/app/ai/agents/shared/jobStore';

const InputSchema = z.object({
  mediaUrl: z.string().url(),
  outputFormat: z.enum(['mp4', 'webm', 'mov', 'avi']).optional().default('mp4'),
  resolution: z.string().regex(/^\d+x\d+$/).optional(),
  quality: z.coerce.number().int().min(0).max(51).optional().default(23),
  maxBytes: z.coerce.number().int().min(128 * 1024).max(100 * 1024 * 1024).optional().default(50 * 1024 * 1024),
  timeoutMs: z.coerce.number().int().min(5000).max(600_000).optional().default(300_000),
});

function getWebhookUrl(): string {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return `${baseUrl}/api/ai/callback`;
}

function canDispatchRemote(): boolean {
  return Boolean(process.env.WORKER_BASE_URL);
}

export async function handleVideoConverterAgent(params: Record<string, any>) {
  const input = InputSchema.parse(params);

  const dispatchMode = canDispatchRemote() ? 'remote' : 'local';

  const result = await videoConverterWorker.dispatch(
    {
      mediaUrl: input.mediaUrl,
      outputFormat: input.outputFormat,
      resolution: input.resolution,
      quality: input.quality,
      maxBytes: input.maxBytes,
      timeoutMs: input.timeoutMs,
    },
    {
      mode: dispatchMode,
      webhookUrl: getWebhookUrl(),
      metadata: { workerId: videoConverterWorker.id },
    }
  );

  // Create job record in store
  await createJob({
    jobId: result.jobId,
    workerId: videoConverterWorker.id,
    input: {
      mediaUrl: input.mediaUrl,
      outputFormat: input.outputFormat,
      resolution: input.resolution,
      quality: input.quality,
      maxBytes: input.maxBytes,
      timeoutMs: input.timeoutMs,
    },
    metadata: { dispatchMode },
  });

  return {
    ok: true,
    jobId: result.jobId,
    workerId: videoConverterWorker.id,
    dispatchMode,
    statusUrl: `/api/worker-jobs/${result.jobId}`,
    message: 'Video conversion job started',
  };
}

