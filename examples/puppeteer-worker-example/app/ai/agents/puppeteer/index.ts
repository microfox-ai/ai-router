import { AiRouter } from '@microfox/ai-router';
import { handleScreenshotAgent } from './server-wrappers/screenshot';
import { handlePdfAgent } from './server-wrappers/pdf';
import { handleScraperAgent } from './server-wrappers/scraper';
import { z } from 'zod';

const aiRouter = new AiRouter<any, any, any, any, any>();

export const puppeteerAgent = aiRouter
  .agent('/screenshot', async (ctx) => {
    try {
      console.log('screenshot agent', ctx.request.params);
      ctx.response.writeMessageMetadata({
        loader: 'Taking screenshot...',
      });
      const result = await handleScreenshotAgent(ctx.request.params);
      console.log('screenshot agent result', result);
      ctx.response.write({
        type: 'data-text-jobId',
        data: result.jobId,
      });
      ctx.response.write({
        type: 'text-delta',
        delta: `Screenshot job started. Job ID: ${result.jobId}`,
        id: ctx.response.generateId(),
      });
      return result;
    } catch (error: any) {
      console.error('screenshot agent error', error);
      ctx.response.write({
        type: 'text-delta',
        delta: `Error: ${error.message || 'Unknown error'}`,
        id: ctx.response.generateId(),
      });
      return {
        ok: false,
        error: error.message || 'Unknown error',
      };
    }
  })
  .agent('/pdf', async (ctx) => {
    try {
      console.log('pdf agent', ctx.request.params);
      ctx.response.writeMessageMetadata({
        loader: 'Generating PDF...',
      });
      const result = await handlePdfAgent(ctx.request.params);
      console.log('pdf agent result', result);
      ctx.response.write({
        type: 'data-text-jobId',
        data: result.jobId,
      });
      ctx.response.write({
        type: 'text-delta',
        delta: `PDF generation started. Job ID: ${result.jobId}`,
        id: ctx.response.generateId(),
      });
      return result;
    } catch (error: any) {
      console.error('pdf agent error', error);
      ctx.response.write({
        type: 'text-delta',
        delta: `Error: ${error.message || 'Unknown error'}`,
        id: ctx.response.generateId(),
      });
      return {
        ok: false,
        error: error.message || 'Unknown error',
      };
    }
  })
  .agent('/scraper', async (ctx) => {
    try {
      console.log('scraper agent', ctx.request.params);
      ctx.response.writeMessageMetadata({
        loader: 'Scraping webpage...',
      });
      const result = await handleScraperAgent(ctx.request.params);
      console.log('scraper agent result', result);
      ctx.response.write({
        type: 'data-text-jobId',
        data: result.jobId,
      });
      ctx.response.write({
        type: 'text-delta',
        delta: `Scraping job started. Job ID: ${result.jobId}`,
        id: ctx.response.generateId(),
      });
      return result;
    } catch (error: any) {
      console.error('scraper agent error', error);
      ctx.response.write({
        type: 'text-delta',
        delta: `Error: ${error.message || 'Unknown error'}`,
        id: ctx.response.generateId(),
      });
      return {
        ok: false,
        error: error.message || 'Unknown error',
      };
    }
  })

