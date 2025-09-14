import { AiRouter } from '@microfox/ai-router';

const aiRouter = new AiRouter();

/**
 * This agent is resposible for scraping the website for information based on the request & url.
 */
export const scrapeAgent = aiRouter
  .agent('/', async (ctx) => {
    // first extract the links from the text.
    // fetch all the information from the links.
    // fetch all links from each site.
    // detect links that require further extraction.
    // ask & confirm from user whether to further scrape.
    return {
      message: 'Hello, world!',
    };
  })
  .actAsTool('/', {
    description: 'A tool to get the profile of the user',
    inputSchema: z.object({
      name: z.string(),
    }),
  });
