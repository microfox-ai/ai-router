import { AiRouter } from '@microfox/ai-router';
import { z } from 'zod';
import { scrapper } from './helpers/scrapper';

const aiRouter = new AiRouter();

export const scrapingAgent = aiRouter
  .agent('/', async (ctx) => {
    const { url } = ctx.request.params as { url: string };
    return await scrapper(url);
  })
  .actAsTool('/', {
    id: 'contactExtractorScraping',
    name: 'Scrape URL',
    description:
      'Scrapes a URL and returns its HTML, metadata, and the content of its linked JS and CSS files.',
    inputSchema: z.object({ url: z.string() }),
    outputSchema: z.object({
      data: z.object({
        html: z.string(),
        url: z.string(),
        title: z.string(),
        description: z.string(),
        jsContent: z.array(z.string()),
        cssContent: z.array(z.string()),
      }),
    }),
    metadata: {
      icon: 'https://raw.githubusercontent.com/microfox-ai/microfox/refs/heads/main/logos/web.svg',
      title: 'Scrape URL',
      parent: 'contactExtractor',
    },
  });
