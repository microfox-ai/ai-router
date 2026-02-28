/**
 * Puppeteer Web Scraper Worker
 * Group: scraper – extracts structured data from webpages using CSS selectors.
 */

import { createWorker, type WorkerConfig } from '@microfox/ai-worker';
import { z } from 'zod';
import type { WorkerHandlerParams } from '@microfox/ai-worker/handler';
import { openPage } from '@microfox/puppeteer-sls';

const InputSchema = z.object({
  url: z.string().url(),
  selectors: z.record(z.string(), z.string()),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']).optional().default('networkidle2'),
  viewport: z
    .object({
      width: z.number().int().min(240).max(3840).optional().default(1280),
      height: z.number().int().min(240).max(2160).optional().default(720),
    })
    .optional()
    .default({ width: 1280, height: 720 }),
  extractText: z.boolean().optional().default(true),
  extractAttributes: z.array(z.string()).optional().default([]),
});

const OutputSchema = z.object({
  url: z.string().url(),
  data: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.null()])),
  extractedAt: z.string(),
  fieldsFound: z.array(z.string()),
  fieldsNotFound: z.array(z.string()),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const workerConfig: WorkerConfig = {
  group: 'scraper',
  timeout: 300,
  memorySize: 1024,
};

export default createWorker<typeof InputSchema, Output>({
  id: 'puppeteer-scraper',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async ({ input, ctx }: WorkerHandlerParams<Input, Output>) => {
    const jobId = String(ctx.jobId);
    let page: Awaited<ReturnType<typeof openPage>>['page'] | undefined;
    let browser: Awaited<ReturnType<typeof openPage>>['browser'] | undefined;

    try {
      await ctx.jobStore?.update({ status: 'running' });
      await ctx.jobStore?.update({
        progressMessage: `Opening page: ${input.url}`,
        progress: 10,
      });

      const isLocal =
        process.env.IS_OFFLINE != null || process.env.SERVERLESS_OFFLINE != null;
      const pageData = await openPage({
        url: input.url,
        headless: true,
        isLocal,
        waitUntil: input.waitUntil,
      });
      page = pageData.page;
      browser = pageData.browser;

      await ctx.jobStore?.update({ progress: 30, progressMessage: 'Setting viewport' });
      const viewport = {
        width: input.viewport?.width ?? 1280,
        height: input.viewport?.height ?? 720,
      };
      await page.setViewport(viewport);

      await ctx.jobStore?.update({ progress: 50, progressMessage: 'Extracting data' });

      const extractedData: Record<string, string | string[] | null> = {};
      const fieldsFound: string[] = [];
      const fieldsNotFound: string[] = [];

      for (const [fieldName, selector] of Object.entries(input.selectors)) {
        try {
          const elements = await page.$$(selector);

          if (elements.length === 0) {
            extractedData[fieldName] = null;
            fieldsNotFound.push(fieldName);
            continue;
          }

          if (elements.length === 1) {
            const element = elements[0];
            let value: string | null = null;

            if (input.extractText) {
              // Prefer textContent; for <meta> tags use content attribute (e.g. meta[name="description"])
              value = await page.evaluate((el: Element) => {
                const text = el.textContent?.trim() || null;
                if (text) return text;
                if (el.tagName === 'META') return (el as HTMLMetaElement).getAttribute('content') || null;
                return null;
              }, element);
            } else {
              value = await page.evaluate((el: Element) => el.innerHTML || null, element);
            }

            if (input.extractAttributes.length > 0 && value) {
              const attrs: Record<string, string> = {};
              for (const attr of input.extractAttributes) {
                const attrValue = await page.evaluate(
                  (el: Element, attrName: string) => el.getAttribute(attrName) || null,
                  element,
                  attr
                );
                if (attrValue) attrs[attr] = attrValue;
              }
              if (Object.keys(attrs).length > 0) {
                value = JSON.stringify({ text: value, attributes: attrs });
              }
            }

            extractedData[fieldName] = value;
            fieldsFound.push(fieldName);
          } else {
            const values: string[] = [];
            const getValue = input.extractText
              ? (el: Element) =>
                  page.evaluate((elem: Element) => {
                    const text = elem.textContent?.trim() || null;
                    if (text) return text;
                    if (elem.tagName === 'META') return (elem as HTMLMetaElement).getAttribute('content') || null;
                    return null;
                  }, el)
              : (el: Element) => page.evaluate((elem: Element) => elem.innerHTML || null, el);
            for (const element of elements) {
              const value = await getValue(element);
              if (value) values.push(value);
            }
            extractedData[fieldName] = values.length > 0 ? values : null;
            if (values.length > 0) fieldsFound.push(fieldName);
            else fieldsNotFound.push(fieldName);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.logger?.warn?.(`Error extracting "${fieldName}": ${msg}`);
          extractedData[fieldName] = null;
          fieldsNotFound.push(fieldName);
        }
      }

      await ctx.jobStore?.update({ progress: 90, progressMessage: 'Processing results' });

      const output: Output = {
        url: input.url,
        data: extractedData,
        extractedAt: new Date().toISOString(),
        fieldsFound,
        fieldsNotFound,
      };

      await ctx.jobStore?.update({ status: 'completed', output });
      return output;
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
