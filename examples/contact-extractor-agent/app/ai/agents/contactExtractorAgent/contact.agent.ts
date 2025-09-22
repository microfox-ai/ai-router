import { AiRouter } from '@microfox/ai-router';
import { Contact } from './helpers/schema';
import { z } from 'zod';
import { saveContacts, saveContactsToRag } from './helpers/storage';
import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import dedent from 'dedent';
import { contactSchema } from './helpers/schema';

const aiRouter = new AiRouter();

export const singleContactExtractorAgent = aiRouter
  .agent('/', async (ctx) => {
    const {
      url,
      maxDepth,
      directive,
      masterVisitedUrls,
    } = ctx.request.params as {
      url: string;
      maxDepth: number;
      directive: string;
      masterVisitedUrls: string[];
    };
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const visitedUrls = new Set<string>(masterVisitedUrls);
    let contactResult: Contact | null = null;

    let urlsToScrape = [url];
    let contactId: string | undefined;
    const path: string[][] = [];

    for (let depth = 1; depth <= maxDepth; depth++) {
      if (urlsToScrape.length === 0) {
        break;
      }

      const currentLevelUrls = [...new Set(urlsToScrape)];
      path.push(currentLevelUrls);

      const scrapePromises = currentLevelUrls.map(async (scrapeUrl) => {
        if (visitedUrls.has(scrapeUrl)) return null;
        visitedUrls.add(scrapeUrl);

        const scrapeResult = await ctx.next.callAgent('@/extract/scrape', {
          url: scrapeUrl,
        });
        if (!scrapeResult.ok) return null;

        const {
          data: { data: pageData },
        } = scrapeResult as any;
        if (typeof pageData.html !== 'string') return null;

        const parseResult = await ctx.next.callAgent('@/extract/parse', {
          html: pageData.html,
          url: scrapeUrl,
          jsContent: pageData.jsContent,
          cssContent: pageData.cssContent,
        });
        if (!parseResult.ok) return null;

        return {
          url: scrapeUrl,
          ...parseResult.data,
          title: pageData.title,
          description: pageData.description,
        };
      });

      const scrapedPages = (await Promise.all(scrapePromises)).filter(
        (p): p is NonNullable<typeof p> => p !== null,
      );
      if (scrapedPages.length === 0) break;

      const combinedContent = scrapedPages
        .map(
          (page) => `
        ---
        URL: ${page.url}
        Title: ${page.title}
        Description: ${page.description}
        Emails: ${JSON.stringify(page.emails)}
        Socials: ${JSON.stringify(page.socials)}
        Other Links: ${JSON.stringify(page.otherLinks)}
        ---
      `,
        )
        .join('\n');

      const aiGeneratedContactSchema = contactSchema.omit({
        path: true,
        _id: true,
        source: true,
        persona: true,
      });

      const existingContactInfo = contactResult
        ? `
  # Existing Information
  \`\`\`json
  ${JSON.stringify(
    {
      name: contactResult.name || 'N/A',
      primaryEmail: contactResult.primaryEmail || 'N/A',
      emails: contactResult.emails || [],
      socials: contactResult.socials || [],
    },
    null,
    2,
  )}
  \`\`\`
  `
        : '';

            const { object: analysis, usage: aiUsage } = await generateObject({
                model: google('gemini-2.5-pro'),
                system: dedent`
          You are a meticulous and detail-oriented data extraction agent. 
          Your mission is to analyze web content to find specific contact information about a single individual per request.
          You must adhere strictly to the schemas provided and never invent or assume information. If a piece of information is not present, you must omit the field.
          You only select URLs from the lists provided in the content. You do not create, modify, or assume any URLs.
        `,
        schema: z.object({
          contact: aiGeneratedContactSchema.optional(),
          nextUrls: z.array(z.string()).optional(),
        }),
        prompt: dedent`
          # Primary Directive
          ${directive}
  
          # Context
          I am performing a level-by-level search for a single person, starting from the URL: ${url}.
          I am currently at depth ${depth}.
          ${existingContactInfo}
  
          # Task
          Analyze the combined content from all pages scraped at this depth. Your goal is twofold:
          1.  **Extract/Update Contact Details**: Identify, extract, or update the contact information for the individual most relevant to the Primary Directive. If existing information is provided, enrich it.
          2.  **Identify Next URLs**: From the links provided, select URLs for the next level of scraping that are highly likely to contain more contact details **ABOUT THE SAME INDIVIDUAL**.
  
          # Rules
          - **DO NOT GUESS**: If you cannot find a piece of information, do not include the field in your response.
          - **URLS ARE SACRED**: You MUST only select URLs from the "Other Links" sections in the content below. Do not generate or modify URLs.
          - **STAY FOCUSED**: All information must pertain to the individual being tracked from the initial candidate URL.
  
          # Combined Content from Scraped Pages
          ${combinedContent}
        `,
      });

      if (aiUsage) {
        usage.inputTokens += aiUsage.inputTokens ?? 0;
        usage.outputTokens += aiUsage.outputTokens ?? 0;
        usage.totalTokens += aiUsage.totalTokens ?? 0;
      }

      if (analysis.contact) {
        const updatedContact: Contact = {
          ...(contactResult || {}),
          ...analysis.contact,
          source: url,
          _id: contactId,
          path,
        };

        if (contactId) {
          // Update existing contact
          await saveContacts([{ ...updatedContact, _id: contactId }]);
          contactResult = updatedContact;
        } else {
          // Create new contact
          const [savedId] = await saveContacts([updatedContact]);
          if (savedId) {
            contactId = savedId.toString();
            updatedContact._id = contactId;
            contactResult = updatedContact;
          }
        }
        if(contactResult) await saveContactsToRag([contactResult]);
      }

      if (
        contactResult?.primaryEmail ||
        (contactResult?.emails && contactResult.emails.length > 0)
      ) {
        if (!contactResult.path) contactResult.path = path;
        await saveContacts([contactResult]);
        await saveContactsToRag([contactResult]);
        break; // Email found, exit loop
      }

      urlsToScrape = analysis.nextUrls || [];
    }

    if (contactResult) {
      contactResult.path = path;
      await saveContacts([contactResult]);
      await saveContactsToRag([contactResult]);
    }

    return {
      contact: contactResult,
      usage,
      visitedUrls: Array.from(visitedUrls),
    };
  })
  .actAsTool('/', {
    id: 'singleContactExtractor',
    name: 'Single Contact Extractor',
    description:
      'Analyzes a single URL to extract a detailed, structured contact information of the person or entity featured on the page.',
    inputSchema: z.object({
      url: z.string().url(),
      maxDepth: z.number(),
      directive: z.string(),
      masterVisitedUrls: z.array(z.string().url()),
    }),
    outputSchema: z.object({
      contact: contactSchema.nullable(),
      usage: z.object({
        inputTokens: z.number(),
        outputTokens: z.number(),
        totalTokens: z.number(),
      }),
      visitedUrls: z.array(z.string().url()),
    }),
    metadata: {
      icon: 'https://raw.githubusercontent.com/microfox-ai/microfox/refs/heads/main/logos/perplexity-icon.svg',
      title: 'Single Contact Extractor',
    },
  }); 
