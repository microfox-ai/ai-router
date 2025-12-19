/**
 * Puppeteer PDF Generator Worker
 * 
 * Converts webpages to PDF documents with customizable formatting options.
 * Great for generating reports, archiving web content, or creating printable documents.
 */

import { createWorker, type WorkerConfig } from '@microfox/ai-worker';
import { z } from 'zod';
import { appendLog, createJob, markError, markRunning, markSuccess, setProgress } from '../../shared/jobStore';
import type { WorkerHandlerParams } from '@microfox/ai-worker/handler';
import { OpenPageSls } from '../../shared/puppeteer';

const InputSchema = z.object({
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

const OutputSchema = z.object({
  url: z.string().url(),
  pdfBase64: z.string(),
  format: z.string(),
  landscape: z.boolean(),
  sizeBytes: z.number().int(),
  generatedAt: z.string(),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const workerConfig: WorkerConfig = {
  timeout: 300, // 5 minutes
  memorySize: 1024, // 1GB
};

export const pdfWorker = createWorker<typeof InputSchema, Output>({
  id: 'puppeteer-pdf',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async ({ input, ctx }: WorkerHandlerParams<Input, Output>) => {
    const jobId = String(ctx.jobId);

    await createJob({
      jobId,
      workerId: String(ctx.workerId),
      input,
      metadata: { source: 'worker', requestId: ctx.requestId || null },
    });

    let page;
    let browser;

    try {
      await markRunning(jobId);
      await appendLog(jobId, `Opening page: ${input.url}`);
      await setProgress(jobId, 10, 'Launching browser');

      const pageData = await OpenPageSls(input.url, input.waitUntil);
      page = pageData.page;
      browser = pageData.browser;

      await setProgress(jobId, 50, 'Generating PDF');
      const pdf = await page.pdf({
        format: input.format,
        landscape: input.landscape,
        margin: input.margin,
        printBackground: input.printBackground,
      }) as Buffer;

      await setProgress(jobId, 90, 'Processing PDF');

      const output: Output = {
        url: input.url,
        pdfBase64: input.returnBase64 ? pdf.toString('base64') : '',
        format: input.format,
        landscape: input.landscape,
        sizeBytes: pdf.length,
        generatedAt: new Date().toISOString(),
      };

      await markSuccess(jobId, output);
      await appendLog(jobId, `PDF generated: ${pdf.length} bytes`);

      return output;
    } catch (error) {
      await markError(jobId, error);
      await appendLog(jobId, 'PDF generation failed; rethrowing to allow SQS retry (if applicable).');
      throw error;
    } finally {
      try {
        if (page) await page.close();
      } catch {
        // ignore
      }
      try {
        if (browser) await browser.close();
      } catch {
        // ignore
      }
    }
  },
});

