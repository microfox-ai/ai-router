import { google } from '@ai-sdk/google';
import { AiRouter } from '@microfox/ai-router';
import { contactExtractorAgent } from './agents/contactExtractorAgent';
import { contextLimiter } from './middlewares/contextLimiter';
import { onlyTextParts } from './middlewares/onlyTextParts';
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
} from 'ai';
import dedent from 'dedent';

const aiRouter = new AiRouter();

// Define the main router without loading the static registry.
// The CLI will use this file as the entry point for building the registry.
const aiMainRouter = aiRouter
  .agent('/extract', contactExtractorAgent)
  .use('/', contextLimiter(5))
  .use('/', onlyTextParts(100))
  .agent('/', async (props) => {
    try {
      props.response.writeMessageMetadata({
        loader: 'Deciding...',
      });

      console.log('REQUEST MESSAGES', props.request.messages.length);
      const stream = streamText({
        model: google('gemini-2.5-pro'),
        system: dedent`
          You are a powerful autonomous agent with a specialization in contact extraction.
          You have access to a tool that can scrape websites, extract contact information, and navigate to other pages to continue searching.
          When the user provides a directive and a set of starting URLs, your job is to use the tool to autonomously find as many relevant contacts as possible.
        `,
        messages: convertToModelMessages(
          props.state.onlyTextMessages || props.request.messages,
        ),
        tools: {
          ...props.next.agentAsTool('/extract'),
        },
        toolChoice: 'auto',
        stopWhen: [
          stepCountIs(10),
          ({ steps }) =>
            steps.some((step) =>
              step.toolResults.some(
                (tool) => tool.toolName === 'extract',
              ),
            ),
        ],
        onError: (error) => {
          console.error('ORCHESTRATION ERROR', error);
        },
        onFinish: (result) => {
          console.log('ORCHESTRATION USAGE', result.totalUsage);
        },
      });

      props.response.merge(
        stream.toUIMessageStream({
          sendFinish: false,
          sendStart: false,
        }),
      );
    } catch (error: any) {
      console.error('Error in main AI router:', error);
      props.response.write({
        type: 'data-error',
        data: `An unexpected error occurred in the main router: ${error.message}`,
      });
    }
  });

export default aiMainRouter;
