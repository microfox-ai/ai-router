/**
 * Puppeteer Web Scraper Worker
 * 
 * Extracts structured data from webpages using CSS selectors.
 * Perfect for scraping product information, article content, or any structured web data.
 */

import { createWorker, type WorkerConfig } from '@microfox/ai-worker';
import { z } from 'zod';
import { appendLog, createJob, markError, markRunning, markSuccess, setProgress } from '../../shared/jobStore';
import type { WorkerHandlerParams } from '@microfox/ai-worker/handler';
import { OpenPageSls } from '../../shared/puppeteer';

const InputSchema = z.object({
  url: z.string().url(),
  selectors: z.record(z.string(), z.string()), // { fieldName: 'css-selector' }
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']).optional().default('networkidle2'),
  viewport: z
    .object({
      width: z.number().int().min(240).max(3840).optional().default(1280),
      height: z.number().int().min(240).max(2160).optional().default(720),
    })
    .optional()
    .default({ width: 1280, height: 720 }),
  extractText: z.boolean().optional().default(true), // Extract text content vs HTML
  extractAttributes: z.array(z.string()).optional().default([]), // e.g., ['href', 'src', 'alt']
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
  timeout: 300, // 5 minutes
  memorySize: 1024, // 1GB
};

export const scraperWorker = createWorker<typeof InputSchema, Output>({
  id: 'puppeteer-scraper',
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

      await setProgress(jobId, 50, 'Extracting data');
      
      // Extract data for each selector
      const extractedData: Record<string, string | string[] | null> = {};
      const fieldsFound: string[] = [];
      const fieldsNotFound: string[] = [];

      for (const [fieldName, selector] of Object.entries(input.selectors)) {
        try {
          const elements = await page.$$(selector);
          
          if (elements.length === 0) {
            extractedData[fieldName] = null;
            fieldsNotFound.push(fieldName);
            await appendLog(jobId, `Selector "${selector}" for field "${fieldName}" found no elements`);
            continue;
          }

          if (elements.length === 1) {
            // Single element - extract text or attributes
            const element = elements[0];
            let value: string | null = null;

            if (input.extractText) {
              value = await page.evaluate((el: Element) => el.textContent?.trim() || null, element);
            } else {
              value = await page.evaluate((el: Element) => el.innerHTML || null, element);
            }

            // Extract additional attributes if requested
            if (input.extractAttributes.length > 0 && value) {
              const attrs: Record<string, string> = {};
              for (const attr of input.extractAttributes) {
                const attrValue = await page.evaluate(
                  (el: Element, attrName: string) => el.getAttribute(attrName) || null,
                  element,
                  attr
                );
                if (attrValue) {
                  attrs[attr] = attrValue;
                }
              }
              // Combine text with attributes as JSON string
              if (Object.keys(attrs).length > 0) {
                value = JSON.stringify({ text: value, attributes: attrs });
              }
            }

            extractedData[fieldName] = value;
            fieldsFound.push(fieldName);
          } else {
            // Multiple elements - extract as array
            const values: string[] = [];
            for (const element of elements) {
              let value: string | null = null;

              if (input.extractText) {
                value = await page.evaluate((el: Element) => el.textContent?.trim() || null, element);
              } else {
                value = await page.evaluate((el: Element) => el.innerHTML || null, element);
              }

              if (value) {
                values.push(value);
              }
            }

            extractedData[fieldName] = values.length > 0 ? values : null;
            if (values.length > 0) {
              fieldsFound.push(fieldName);
            } else {
              fieldsNotFound.push(fieldName);
            }
          }
        } catch (error: any) {
          await appendLog(jobId, `Error extracting "${fieldName}": ${error.message}`);
          extractedData[fieldName] = null;
          fieldsNotFound.push(fieldName);
        }
      }

      await setProgress(jobId, 90, 'Processing results');

      const output: Output = {
        url: input.url,
        data: extractedData,
        extractedAt: new Date().toISOString(),
        fieldsFound,
        fieldsNotFound,
      };

      await markSuccess(jobId, output);
      await appendLog(jobId, `Extracted ${fieldsFound.length} fields, ${fieldsNotFound.length} not found`);

      return output;
    } catch (error) {
      await markError(jobId, error);
      await appendLog(jobId, 'Scraping failed; rethrowing to allow SQS retry (if applicable).');
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

