'use server';

import { z } from 'zod';
import { ffprobeWorker } from '../workers/ffprobe.worker';
import { createJob } from '@/app/ai/agents/shared/jobStore';

const InputSchema = z.object({
  mediaUrl: z.string().url(),
  maxBytes: z.coerce.number().int().min(128 * 1024).max(30 * 1024 * 1024).optional().default(8 * 1024 * 1024),
  timeoutMs: z.coerce.number().int().min(1000).max(120_000).optional().default(30_000),
});

function getWebhookUrl(): string {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return `${baseUrl}/api/ai/callback`;
}

function canDispatchRemote(): boolean {
  return Boolean(process.env.WORKER_BASE_URL || process.env.NEXT_PUBLIC_WORKER_BASE_URL);
}

export async function handleFfprobeAgent(params: Record<string, any>) {
  const input = InputSchema.parse(params);

  const dispatchMode = canDispatchRemote() ? 'remote' : 'local';

  const result = await ffprobeWorker.dispatch(
    {
      mediaUrl: input.mediaUrl,
      maxBytes: input.maxBytes,
      timeoutMs: input.timeoutMs,
    },
    {
      mode: dispatchMode,
      webhookUrl: getWebhookUrl(),
      metadata: { workerId: ffprobeWorker.id },
    }
  );

  // Create job record in store
  await createJob({
    jobId: result.jobId,
    workerId: ffprobeWorker.id,
    input: { mediaUrl: input.mediaUrl, maxBytes: input.maxBytes, timeoutMs: input.timeoutMs },
    metadata: { dispatchMode },
  });

  return {
    ok: true,
    jobId: result.jobId,
    workerId: ffprobeWorker.id,
    dispatchMode,
    statusUrl: `/api/worker-jobs/${result.jobId}`,
    message: 'FFprobe analysis job started',
  };
}

