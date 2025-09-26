import { z } from 'zod';
import { AiRouter } from '@microfox/ai-router';
import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { jsDom } from './helpers/jsDom';
import { personaAnalysisSchema, Contact, contactSchema } from './helpers/schema';
import dedent from 'dedent';
import { saveContacts, saveContactsToRag, getContactById } from './helpers/storage';

const aiRouter = new AiRouter();

export const deepPersonaAgent = aiRouter
  .agent('/', async (ctx) => {
    const { contactId, urls } = ctx.request.params as { contactId: string, urls: string };
    try {
      const contact = await getContactById(contactId);
      if (!contact) {
        throw new Error(`Contact with ID ${contactId} not found.`);
      }

      const scrapePromises = urls?.split(',').map(async (url) => {
        const scrapeResult = await ctx.next.callAgent('@/extract/scrape', {
          url: url,
        });
        if (!scrapeResult.ok) return null;

        const {
          data: { data: pageData },
        } = scrapeResult as any;
        if (typeof pageData.html !== 'string') return null;

        const html = pageData?.html
        if (typeof html !== 'string') {
          console.error(`No HTML content for ${url}`);
          return null;
        }
        const dom = await jsDom(html);
        return dom.window.document.body.textContent || '';
      });

      const scrapedContents = (await Promise.all(scrapePromises))
        .filter((content): content is string => content !== null)
        .map(content => content.substring(0, 20000)); // Limit each page's content

      // console.log("Scraped contents:", scrapedContents);

      const combinedText = scrapedContents.join('\n\n---\n\n');

      console.log("Combined text:", combinedText);

      const { object: persona, usage } = await generateObject({
        model: google('gemini-2.5-pro'),
        schema: personaAnalysisSchema,
        prompt: dedent`
        Your task is to analyze the text content from multiple webpages belonging to a person and extract key details to build a comprehensive persona.
        Focus exclusively on the subject of the page and ignore any generic, boilerplate text about the platform hosting it (like GitHub's navigation, Twitter's UI elements, etc.). Your analysis should only include information about the person.
        If you cannot find a specific piece of information, respond with "N/A". Do not guess any information.
        
        Here is the existing persona information for context. Your job is to enrich this with new details from the content below:
        ${JSON.stringify(contact.persona, null, 2)}

        Webpage content:
        ${combinedText}
      `,
      });

      console.log("Persona:", persona);

      const updatedContact: Contact = {
        ...contact,
        persona: {
          ...contact.persona,
          ...persona,
        }
      };

      console.log("Updated contact:", updatedContact);

      await saveContacts([updatedContact]);
      await saveContactsToRag([updatedContact]);
      return { contact: updatedContact, usage, status: 'success' };

    } catch (error) {
      console.error("Failed to analyze persona.", error);
      return { error: 'Failed to analyze persona.', status: 'error' };
    }
  })
  .actAsTool('/', {
    id: 'deepPersonaAnalyzer',
    name: 'Deep Persona Analyzer',
    description: 'Analyzes multiple URLs for a given contact to create a detailed, structured persona and updates the contact record.',
    inputSchema: z.object({
      contactId: z.string().describe('The MongoDB ObjectId of the contact to update.'),
      urls: z.array(z.string().url()).describe('The URLs to analyze (e.g., portfolio, GitHub, LinkedIn).'),
    }),
    outputSchema: contactSchema.extend({
      status: z.enum(['success', 'error']),
      error: z.string().optional(),
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
