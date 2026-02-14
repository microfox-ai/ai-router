'use server';

import { z } from 'zod';
import { scraperWorker } from '../workers/scraper.worker';

const InputSchema = z.object({
  url: z.string().url(),
  selectors: z.union([
    z.string().transform((str, ctx) => {
      try {
        return JSON.parse(str);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid JSON for selectors',
        });
        return z.NEVER;
      }
    }),
    z.record(z.string(), z.string()),
  ]),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']).optional().default('networkidle2'),
  viewport: z
    .union([
      z.string().transform((str) => {
        try {
          return JSON.parse(str);
        } catch {
          return { width: 1280, height: 720 };
        }
      }),
      z.object({
        width: z.coerce.number().int().min(240).max(3840).optional().default(1280),
        height: z.coerce.number().int().min(240).max(2160).optional().default(720),
      }),
    ])
    .optional(),
  extractText: z.coerce.boolean().optional().default(true),
  extractAttributes: z.union([
    z.string().transform((str) => {
      if (!str) return [];
      try {
        return JSON.parse(str);
      } catch {
        return [];
      }
    }),
    z.array(z.string()),
  ]).optional().default([]),
});

export async function handleScraperAgent(params: Record<string, any>) {
  const input = InputSchema.parse(params);

  const canRemote = Boolean(
    process.env.WORKER_BASE_URL
  );

  const result = await scraperWorker.dispatch(input, {
    mode: canRemote ? 'remote' : 'local',
    metadata: { workerId: scraperWorker.id },
  });

  return {
    ok: true,
    jobId: result.jobId,
    workerId: scraperWorker.id,
    statusUrl: `/api/worker-jobs/${result.jobId}`,
    message: 'Scraping job started',
  };
}

