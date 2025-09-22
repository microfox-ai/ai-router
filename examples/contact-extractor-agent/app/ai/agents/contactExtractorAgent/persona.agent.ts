import { z } from 'zod';
import { AiRouter } from '@microfox/ai-router';
import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { jsDom } from './helpers/jsDom';
import { personaAnalysisSchema } from './helpers/schema';
import dedent from 'dedent';

const aiRouter = new AiRouter<any, any>();

export const personaAgent = aiRouter
  .agent('/', async (ctx) => {
    const { url } = ctx.request.params as { url: string };

    const scrapeResult = await ctx.next.callAgent('@/extract/scrape', { url });
    if (!scrapeResult.ok) {
      throw new Error(`Failed to scrape ${url}: ${scrapeResult.error.message}`);
    }

    const { data: { data: html } } = scrapeResult;
    if (typeof html !== 'string') {
      throw new Error(`No HTML content for ${url}`);
    }
    
    const dom = await jsDom(html);
    const textContent = dom.window.document.body.textContent || '';

    const { object: persona, usage } = await generateObject({
      model: google('gemini-2.5-flash'),
      schema: personaAnalysisSchema,
      prompt: dedent`
        Your task is to analyze the text content of a webpage and extract key details about the primary person or organization featured on it.
        Focus exclusively on the subject of the page and ignore any generic, boilerplate text about the platform hosting it (like GitHub, LinkedIn, etc.).
        If you cannot find a specific piece of information, respond with "N/A". Do not guess any information.

        Webpage content:
        ${textContent.substring(0, 8000)}
      `,
    });

    return { ...persona, usage };
  })
  .actAsTool('/', {
    id: 'personaAnalyzer',
    name: 'Persona Analyzer',
    description: 'Analyzes a single URL to extract a detailed, structured persona of the person or entity featured on the page.',
    inputSchema: z.object({
      url: z.string().url().describe('The URL of the profile to analyze (e.g., a portfolio, GitHub, or LinkedIn page).'),
    }),
    outputSchema: personaAnalysisSchema.extend({
      usage: z.object({
        inputTokens: z.number(),
        outputTokens: z.number(),
        totalTokens: z.number(),
      }),
    }),
    metadata: {
      icon: 'https://raw.githubusercontent.com/microfox-ai/microfox/refs/heads/main/logos/perplexity-icon.svg',
      title: 'Persona Analyzer',
    },
  }); 
