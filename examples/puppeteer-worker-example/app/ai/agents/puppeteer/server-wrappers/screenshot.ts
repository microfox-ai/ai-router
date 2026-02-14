'use server';

import { z } from 'zod';
import { screenshotWorker } from '../workers/screenshot.worker';

const InputSchema = z.object({
  url: z.string().url(),
  fullPage: z.coerce.boolean().optional().default(false),
  viewport: z.object({
    width: z.coerce.number().int().min(240).max(3840).optional().default(1280),
    height: z.coerce.number().int().min(240).max(2160).optional().default(720),
  }).optional().default({ width: 1280, height: 720 }),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']).optional().default('networkidle2'),
  quality: z.coerce.number().int().min(0).max(100).optional().default(90),
  returnBase64: z.coerce.boolean().optional().default(true),
});

export async function handleScreenshotAgent(params: Record<string, any>) {
  const input = InputSchema.parse(params);

  const canRemote = Boolean(
    process.env.WORKER_BASE_URL
  );
  console.log('canRemote', canRemote);
  const result = await screenshotWorker.dispatch(input, {
    mode: canRemote ? 'remote' : 'local',
    metadata: { workerId: screenshotWorker.id },
  });

  return {
    ok: true,
    jobId: result.jobId,
    workerId: screenshotWorker.id,
    statusUrl: `/api/worker-jobs/${result.jobId}`,
    message: 'Screenshot job started',
  };
}

