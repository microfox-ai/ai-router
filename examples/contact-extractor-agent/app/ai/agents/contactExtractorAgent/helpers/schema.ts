import { z } from 'zod';

export const personaAnalysisSchema = z.object({
  name: z.string().optional().describe('The full name of the person.'),
  profession: z
    .string()
    .optional()
    .describe('The primary profession or job title.'),
  age: z.string().optional().describe('The estimated age or age range.'),
  summary: z
    .string()
    .optional()
    .describe(
      'A brief, one-paragraph summary of the person based on the content.',
    ),
  interests: z
    .array(z.string())
    .optional()
    .describe('A list of key interests, skills, or hobbies.'),
  location: z.string().optional().describe('The city, state, or country.'),
});

export const contactSchema = z.object({
  _id: z.string().optional(),
  source: z.string(),
  name: z.string().optional(),
  primaryEmail: z.string().optional(),
  emails: z.array(z.string()).optional(),
  socials: z
    .object({
      linkedin: z.string().optional(),
      github: z.string().optional(),
      twitter: z.string().optional(),
      portfolio: z.string().optional(),
    })
    .optional(),
  path: z
    .array(z.array(z.string().url()))
    .optional()
    .describe(
      'A nested array representing the navigation path. Each inner array contains the URLs scraped at that depth.',
    ),
  persona: personaAnalysisSchema.optional(),
});

export const agentInputSchema = z.object({
  urls: z
    .array(z.string().url())
    .describe('An array of seed URLs to start the extraction process.'),
  directive: z
    .string()
    .describe(
      'A specific instruction for the agent (e.g., "Find contact info for the founders of Vercel").',
    ),
  maxContacts: z
    .number()
    .optional()
    .describe('The maximum number of contacts to extract. Defaults to 5.'),
});

export type Contact = z.infer<typeof contactSchema>;

