/**
 * Puppeteer Screenshot Worker
 * 
 * Takes screenshots of webpages with options for full-page or viewport-only captures.
 * Perfect for capturing website designs, monitoring visual changes, or creating thumbnails.
 */

import { createWorker, type WorkerConfig } from '@microfox/ai-worker';
import { z } from 'zod';
import { appendLog, createJob, markError, markRunning, markSuccess, setProgress } from '../../shared/jobStore';
import type { WorkerHandlerParams } from '@microfox/ai-worker/handler';
import { OpenPageSls } from '../../shared/puppeteer';

const InputSchema = z.object({
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

const OutputSchema = z.object({
  url: z.string().url(),
  screenshotBase64: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  fullPage: z.boolean(),
  format: z.literal('png'),
  sizeBytes: z.number().int(),
  capturedAt: z.string(),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const workerConfig: WorkerConfig = {
  timeout: 300, // 5 minutes
  memorySize: 1024, // 1GB
};

export const screenshotWorker = createWorker<typeof InputSchema, Output>({
  id: 'puppeteer-screenshot',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async ({ input, ctx }: WorkerHandlerParams<Input, Output>) => {
    const jobId = String(ctx.jobId);
    const start = Date.now();

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

      await setProgress(jobId, 30, 'Setting viewport');
      await page.setViewport({
        width: input.viewport.width,
        height: input.viewport.height,
      });

      await setProgress(jobId, 50, 'Capturing screenshot');
      const screenshot = await page.screenshot({
        fullPage: input.fullPage,
        type: 'png',
      }) as Buffer;

      await setProgress(jobId, 90, 'Processing image');

      // Get actual dimensions from the page
      const dimensions = await page.evaluate(() => {
        return {
          width: Math.max(document.documentElement.scrollWidth, window.innerWidth),
          height: Math.max(document.documentElement.scrollHeight, window.innerHeight),
        };
      });

      const output: Output = {
        url: input.url,
        screenshotBase64: input.returnBase64 ? screenshot.toString('base64') : '',
        width: input.fullPage ? dimensions.width : input.viewport.width,
        height: input.fullPage ? dimensions.height : input.viewport.height,
        fullPage: input.fullPage,
        format: 'png',
        sizeBytes: screenshot.length,
        capturedAt: new Date().toISOString(),
      };

      await markSuccess(jobId, output);
      await appendLog(jobId, `Screenshot captured: ${screenshot.length} bytes`);

      return output;
    } catch (error) {
      await markError(jobId, error);
      await appendLog(jobId, 'Screenshot failed; rethrowing to allow SQS retry (if applicable).');
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

