import { google } from '@ai-sdk/google';
import { AiRouter } from '@microfox/ai-router';
import { z } from 'zod';
import { streamText, convertToModelMessages, generateId } from 'ai';
import dedent from 'dedent';
import { mapBraveWebSearch } from '@/components/ai/braveResearch/mapper';
import { WebSearchOutput } from '@/components/ai/braveResearch/types';
import { downsizeResearchData } from './helpers';

const aiRouter = new AiRouter();

export const summarizeAgent = aiRouter
  .agent('/', async (ctx) => {
    ctx.response.writeMessageMetadata({
      loader: 'Summarizing...',
    });
    const { type, summaryRequirements } = ctx.request.params;

    const researchData = ctx.state.researchData
      ? ctx.state.researchData?.reduce(
          (
            acc: Record<string, WebSearchOutput>,
            data: { response: any; searchInput: any },
            index: number,
          ) => {
            acc[`Search ${index + 1}`] = mapBraveWebSearch({
              response: data.response,
              searchInput: data.searchInput,
            });
            return acc;
          },
          {},
        )
      : {};

    if (!researchData || Object.keys(researchData).length === 0) {
      ctx.response.writeMessageMetadata({
        error: 'No research data available',
      });
      return { status: 'No research data available' };
    }

    const textStream = streamText({
      model: google('gemini-2.0-flash-001'),
      system: dedent`You are an expert Researcher. 
      Your task is to create a comprehensive, 
      well-structured markdown summary of the discussion.

      Start he summary with a confirmation and your priorities when researching this,
      followed by paragraphs of concise information, key points, insights and conclusions.
      Next show any analysis with neatly formatted tables
      and lastly add any relevant citations with links to the source.

      Structure Guidelines:
           - Use proper markdown headers (##) for each section
           - Format tables with proper alignment and proper markdown syntax
           - Include bullet points for additional context
           - Always attribute quotes and insights to source with proper links
           - Link to relevant websites when mentioned
           - Always include relative timestamps using <timesince>timestamp</timesince> or <timesince>date ISO string</timesince>
           - End with a conclusion table including relevant links and timestamps

      At the end of the summary, include the following:
      - A conclusion from the research
      - A list of important citations with links to the source (the links preview should only show the hostname)
      `,
      prompt: `
      The User's Request is this: ${summaryRequirements}
      Summarise the following information: ${downsizeResearchData(researchData, 10000)}`,
      // Cheap Mode => Increase this to adjust longer Sumamries
      maxOutputTokens: 3000,
      onFinish: (output) => {
        console.log('SUMMARY USAGE', output.totalUsage);
      },
    });

    ctx.response.merge(
      textStream.toUIMessageStream({ sendFinish: false, sendStart: false }),
    );

    await textStream.text;

    return { status: 'Summary Completed!' };
  })
  .actAsTool('/', {
    id: 'summarizeResearch',
    name: 'Summarises Research',
    description: 'Summarises the information that is collected.',
    inputSchema: z.object({
      type: z.enum(['markdown', 'plain']),
      summaryRequirements: z
        .string()
        .describe(
          'The intention of the summarisation - What to summarize, look for, extract, etc.',
        ),
      //summaryStyle: z.string().describe('The style of the summary - What format to use, what to include, what to exclude, etc.'),
    }),
    outputSchema: z.object({
      status: z.string().describe('The status of the summary'),
    }),
    metadata: {
      icon: '🔍',
      title: 'Summarizer',
      hideUI: true,
    },
  });
