import { google } from '@ai-sdk/google';
import { AiRouter } from '@microfox/ai-router';
import {
  convertToModelMessages,
  InferUITools,
  stepCountIs,
  streamText,
} from 'ai';
import dedent from 'dedent';
import { contactExtractorAgent } from './agents/contactExtractorAgent';
import { systemAgent } from './agents/system';
import { contextLimiter } from './middlewares/contextLimiter';
import { onlyTextParts } from './middlewares/onlyTextParts';

const aiRouter = new AiRouter();
// aiRouter.setLogger(console);

const aiMainRouter = aiRouter
  .agent('/system', systemAgent)
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
          // ...props.next.agentAsTool('/system'),
          ...props.next.agentAsTool('/extract')
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
        id: 'error-main-router',
        type: 'error',
        data: `An unexpected error occurred in the main router: ${error.message}`,
      });
    }
  });


// console.log('--------REGISTRY--------');
// console.log(aiMainRouter.registry());
const aiRouterRegistry = aiMainRouter.registry();
const aiRouterTools = aiRouterRegistry.tools;
type AiRouterTools = InferUITools<typeof aiRouterTools>;
// console.log('--------REGISTRY--------');

export { aiMainRouter, aiRouterRegistry };

export { aiRouterTools, type AiRouterTools };

//http://localhost:3000/api/studio/chat/agent/research/brave?query=Herohonda&deep=false&count=3
