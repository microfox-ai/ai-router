import { AiRouter } from '@microfox/ai-router';
import { z } from 'zod';
import dedent from 'dedent';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { jsDom } from './helpers/jsDom';
import { contactSchema } from './helpers/schema';
import { agentInputSchema, Contact } from './helpers/schema';
import { singleContactExtractorAgent } from './contact.agent';
import { scrapingAgent } from './scraping.agent';
import { parsingAgent } from './parsing.agent';
import { deepPersonaAgent } from './deepPersona.agent';

export const contactExtractorAgent = new AiRouter()
  .agent('/scrape', scrapingAgent)
  .agent('/parse', parsingAgent)
  .agent('/contact', singleContactExtractorAgent)
  .agent('/deep-persona', deepPersonaAgent)
  .agent('/', async (ctx) => {
    try {
      const { urls, directive } = ctx.request.params;
      const maxContacts = Number(ctx.request.params.maxContacts) || 5;
      const maxDepth = 5;

      ctx.state = {
        directive,
        initialUrls: urls,
        visitedUrls: new Set<string>(),
        contacts: [],
        progress: 0,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };

      // Step 1: Scrape initial URLs to find candidate links
      const initialScrapePromises = urls.map(async (url: string) => {
        if (ctx.state.visitedUrls.has(url)) return null;
        ctx.state.visitedUrls.add(url);

        console.log(`Initial scrape for candidate selection: ${url}`);
        const scrapeResult = await ctx.next.callAgent('/scrape', { url });
        if (!scrapeResult.ok) return null;

        const {
          data: {
            data: { html, title, description },
          },
        } = scrapeResult as {
          ok: true;
          data: {
            data: {
              html: string;
              url: string;
              title: string;
              description: string;
            };
          };
        };
        if (typeof html !== 'string') return null;

        const dom = await jsDom(html);
        const links = Array.from(dom.window.document.querySelectorAll('a'))
          .map((a) => {
            try {
              return new URL(a.href, url).toString();
            } catch (e) {
              return null;
            }
          })
          .filter(
            (link): link is string =>
              link !== null &&
              !link.startsWith('javascript:') // &&
              // link.includes('github.com'),
          );

        return { url, pageTitle: title, pageDescription: description, links };
      });

      const initialPages = (await Promise.all(initialScrapePromises)).filter(
        (page): page is NonNullable<typeof page> => Boolean(page),
      );
      if (initialPages.length === 0) {
        return {
          status: 'error',
          error: 'Could not scrape any of the initial URLs.',
        };
      }

      // Step 2: Use AI to select the best candidate URLs
      const combinedInitialContent = initialPages
        .map(
          (page) => `
        ---
        URL: ${page.url}
        Title: ${page.pageTitle}
        Description: ${page.pageDescription}
        Links: 
        ${page.links.join('\n')}
        ---
      `,
        )
        .join('\n');

      const { object: candidateAnalysis, usage } = await generateObject({
        model: google('gemini-2.5-pro'),
        system: dedent`
          You are an expert web reconnaissance analyst. 
          Your specialty is identifying the most promising paths to find contact information for specific individuals based on initial web page scans.
          You are ruthlessly efficient and prioritize URLs that are most likely to lead to a person's direct contact details or professional profiles.
        `,
        schema: z.object({
          candidateUrls: z
            .array(z.string())
            .max(maxContacts || 5)
            .describe(
              'An array of URLs that are most likely to lead to contact information for people mentioned in the directive.',
            ),
        }),
        prompt: dedent`
          # Primary Directive
          My goal is to find contact information for people related to: "${directive}"
          
          # Task
          I have scraped the initial URLs and listed their titles, descriptions, and all the links they contain.
          Based on the Primary Directive, you must analyze this content and select up to 10 URLs that are the most promising candidates for finding the contact information I'm looking for.

          # Selection Criteria
          - **Prioritize**: "About Us", "Team", "Contact", individual portfolio sites, and direct links to social media profiles (LinkedIn, GitHub, Twitter).
          - **De-prioritize**: Links to product pages, pricing, general blog posts, or technical documentation unless they explicitly mention a person relevant to the directive.
          
          # Critical Rule
          You MUST only select max ${maxContacts || 5} URLs from the "Links" sections provided in the content below. Do not create, modify, guess, or assume any URLs. Your job is to select from the existing list, not to invent.

          # Scraped Content
          ${combinedInitialContent}
        `,
      });
      ctx.state.usage.inputTokens += usage.inputTokens;
      ctx.state.usage.outputTokens += usage.outputTokens;
      ctx.state.usage.totalTokens += usage.totalTokens;

      const candidateUrls = [...new Set(candidateAnalysis.candidateUrls || [])]; // Deduplicate

      if (candidateUrls.length === 0) {
        ctx.response.writeMessageMetadata({
          text: 'AI could not identify any candidate URLs to explore further from the initial pages.',
        });
        return {
          status: 'success',
          pagesScraped: ctx.state.visitedUrls.size,
          contactsFound: 0,
          contacts: [],
          usage: ctx.state.usage,
        };
      }

      ctx.response.writeMessageMetadata({
        text: `AI identified ${candidateUrls.length} candidate URLs to investigate.`,
      });

      const contactPromises = candidateUrls.map(async (url: string) =>
        await ctx.next.callAgent('/contact', {
          url,
          maxDepth,
          directive,
          masterVisitedUrls: Array.from(ctx.state.visitedUrls),
        }),
      );

      const results = await Promise.all(contactPromises);

      for (const result of results) {
        if (result.ok) {
          const { contact, usage, visitedUrls } = result.data;

          if (contact) {
            // Avoid adding duplicates if the same contact is found from multiple candidates
            const existingContact = ctx.state.contacts.find(
              (c: Contact) => c._id === contact._id,
            );
            if (!existingContact) {
              ctx.state.contacts.push(contact);
            }
          }

          usage.inputTokens += usage.inputTokens;
          usage.outputTokens += usage.outputTokens;
          usage.totalTokens += usage.totalTokens;

          visitedUrls.forEach((url: string) => ctx.state.visitedUrls.add(url));

          if (ctx.state.contacts.length >= maxContacts) {
            break;
          }
        }
      }

      console.log('--- End Contact Extractor Agent ---');
      return {
        status: 'success',
        pagesScraped: ctx.state.visitedUrls.size,
        contactsFound: ctx.state.contacts.length,
        contacts: ctx.state.contacts,
        usage: ctx.state.usage,
      };
    } catch (error: any) {
      console.error('Error in Contact Extractor Agent:', error);
      ctx.response.writeMessageMetadata({
        text: `Error in Contact Extractor Agent: ${error.message}`,
      });
      return { status: 'error', error: 'Internal server error' };
    }
  })
  .actAsTool('/', {
    id: 'contactExtractor',
    name: 'Contact Extractor',
    description: 'Extracts contact information from a list of seed URLs. It can autonomously navigate up to 3 levels deep to find relevant information based on a user-provided directive.',
    inputSchema: agentInputSchema,
    outputSchema: z.object({
      status: z.string(),
      pagesScraped: z.number(),
      contactsFound: z.number(),
      contacts: z.array(contactSchema),
      usage: z.object({
        inputTokens: z.number(),
        outputTokens: z.number(),
        totalTokens: z.number(),
      }),
    }),
    metadata: {
      icon: 'https://raw.githubusercontent.com/microfox-ai/microfox/refs/heads/main/logos/chrome.svg',
      title: 'Contact Extractor',
      parent: 'contactExtractor',
    },
  });
