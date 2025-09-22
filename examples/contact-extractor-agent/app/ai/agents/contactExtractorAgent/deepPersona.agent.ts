import { z } from 'zod';
import { AiRouter } from '@microfox/ai-router';
import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { jsDom } from './helpers/jsDom';
import { personaAnalysisSchema, Contact } from './helpers/schema';
import dedent from 'dedent';
import { saveContacts, saveContactsToRag, getContactById } from './helpers/storage';

const aiRouter = new AiRouter();

export const deepPersonaAgent = aiRouter
  .agent('/', async (ctx) => {
    const { contactId, urls } = ctx.request.params as { contactId: string, urls: string[] };

    const contact = await getContactById(contactId);
    if (!contact) {
        throw new Error(`Contact with ID ${contactId} not found.`);
    }

    const scrapePromises = urls.map(async (url) => {
        const scrapeResult = await ctx.next.callAgent('@/extract/scrape', { url });
        if (!scrapeResult.ok) {
            console.error(`Failed to scrape ${url}: ${scrapeResult.error.message}`);
            return null;
        }
        const { data: { data: html } } = scrapeResult;
        if (typeof html !== 'string') {
            console.error(`No HTML content for ${url}`);
            return null;
        }
        const dom = await jsDom(html);
        return dom.window.document.body.textContent || '';
    });

    const scrapedContents = (await Promise.all(scrapePromises)).filter(Boolean) as string[];
    const combinedText = scrapedContents.join('\n\n---\n\n');

    const { object: persona, usage } = await generateObject({
      model: google('gemini-2.5-pro'),
      schema: personaAnalysisSchema,
      prompt: dedent`
        Your task is to analyze the text content from multiple webpages belonging to a person and extract key details to build a comprehensive persona.
        Focus exclusively on the subject and ignore any generic, boilerplate text.
        If you cannot find a specific piece of information, respond with "N/A". Do not guess any information.
        
        Here is the existing persona information for context:
        ${JSON.stringify(contact.persona, null, 2)}

        Webpage content:
        ${combinedText.substring(0, 20000)}
      `,
    });

    const updatedContact: Contact = {
        ...contact,
        persona: {
            ...contact.persona,
            ...persona,
        }
    };

    await saveContacts([updatedContact]);
    await saveContactsToRag([updatedContact]);

    return { persona, usage };
  })
  .actAsTool('/', {
    id: 'deepPersonaAnalyzer',
    name: 'Deep Persona Analyzer',
    description: 'Analyzes multiple URLs for a given contact to create a detailed, structured persona and updates the contact record.',
    inputSchema: z.object({
      contactId: z.string().describe('The MongoDB ObjectId of the contact to update.'),
      urls: z.array(z.string().url()).describe('The URLs to analyze (e.g., portfolio, GitHub, LinkedIn).'),
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
      title: 'Deep Persona Analyzer',
    },
  });
