'use server';

import { z } from 'zod';
import { pdfWorker } from '../workers/pdf.worker';

const InputSchema = z.object({
  url: z.string().url(),
  format: z.enum(['A4', 'Letter', 'Legal', 'Tabloid', 'Ledger', 'A0', 'A1', 'A2', 'A3', 'A5', 'A6']).optional().default('A4'),
  landscape: z.coerce.boolean().optional().default(false),
  margin: z
    .object({
      top: z.string().optional().default('1cm'),
      right: z.string().optional().default('1cm'),
      bottom: z.string().optional().default('1cm'),
      left: z.string().optional().default('1cm'),
    })
    .optional(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']).optional().default('networkidle2'),
  printBackground: z.coerce.boolean().optional().default(true),
  returnBase64: z.coerce.boolean().optional().default(true),
});

export async function handlePdfAgent(params: Record<string, any>) {
  const input = InputSchema.parse(params);

  const canRemote = Boolean(
    process.env.WORKER_BASE_URL || process.env.NEXT_PUBLIC_WORKER_BASE_URL
  );

  const result = await pdfWorker.dispatch(input, {
    mode: canRemote ? 'remote' : 'local',
    metadata: { workerId: pdfWorker.id },
  });

  return {
    ok: true,
    jobId: result.jobId,
    workerId: pdfWorker.id,
    statusUrl: `/api/worker-jobs/${result.jobId}`,
    message: 'PDF generation job started',
  };
}

