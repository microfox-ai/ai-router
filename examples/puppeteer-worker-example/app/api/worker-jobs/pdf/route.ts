import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { pdfWorker } from '@/app/ai/agents/puppeteer/pdf.worker';

const CreateJobSchema = z.object({
  url: z.string().url(),
  format: z.enum(['A4', 'Letter', 'Legal', 'Tabloid', 'Ledger', 'A0', 'A1', 'A2', 'A3', 'A5', 'A6']).optional().default('A4'),
  landscape: z.boolean().optional().default(false),
  margin: z
    .object({
      top: z.string().optional().default('1cm'),
      right: z.string().optional().default('1cm'),
      bottom: z.string().optional().default('1cm'),
      left: z.string().optional().default('1cm'),
    })
    .optional(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']).optional().default('networkidle2'),
  printBackground: z.boolean().optional().default(true),
  returnBase64: z.boolean().optional().default(true),
});

function canDispatchRemote(): boolean {
  return Boolean(process.env.WORKER_BASE_URL || process.env.NEXT_PUBLIC_WORKER_BASE_URL);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = CreateJobSchema.parse(body);

    const dispatchMode = canDispatchRemote() ? 'remote' : 'local';

    const { jobId } = await pdfWorker.dispatch(input, {
      mode: dispatchMode,
      metadata: { workerId: pdfWorker.id },
    });

    return NextResponse.json(
      {
        ok: true,
        jobId,
        workerId: pdfWorker.id,
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

