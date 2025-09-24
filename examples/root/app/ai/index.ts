import { google } from '@ai-sdk/google';
import { AiRouter } from '@microfox/ai-router';
import {
  convertToModelMessages,
  InferUITools,
  stepCountIs,
  streamText,
} from 'ai';
import dedent from 'dedent';
import { braveResearchAgent } from './agents/braveResearch';
import { summarizeAgent } from './agents/summarize';
import { systemAgent } from './agents/system';
import { thinkerAgent } from './agents/thinker';
import { contextLimiter } from './middlewares/contextLimiter';
import { onlyTextParts } from './middlewares/onlyTextParts';

const aiRouter = new AiRouter<any, any, any, any>();
// aiRouter.setLogger(console);

const aiMainRouter = aiRouter
  .agent('/system', systemAgent)
  .agent('/summarize', summarizeAgent)
  .agent('/research', braveResearchAgent)
  .agent('/thinker', thinkerAgent)
  .use('/', contextLimiter(5))
  .use('/', onlyTextParts(100))
  .agent('/', async (props) => {
    // show a loading indicator
    props.response.writeMessageMetadata({
      loader: 'Thinking...',
    });

    // main orchestration as a stream
    const stream = streamText({
      model: google('gemini-2.5-pro'),
      system: dedent`
          You are a helpful assistant that can use the following tools to help the user
          
        `,
      messages: convertToModelMessages(
        props.state.onlyTextMessages || props.request.messages,
      ),
      tools: {
        // attach the agents you need
        ...props.next.agentAsTool('/thinker'),
        ...props.next.agentAsTool('/summarize'),
        ...props.next.agentAsTool('/research'),
      },
      toolChoice: 'auto',
      // stop conditions
      stopWhen: [
        stepCountIs(10),
        ({ steps }) =>
          steps.some((step) =>
            step.toolResults.some((tool) => tool.output?._isFinal),
          ),
      ],
      onError: (error) => {
        console.error('ORCHESTRATION ERROR', error);
      },
      onFinish: (result) => {
        console.log('ORCHESTRATION USAGE', result.totalUsage);
      },
    });

    // merge the stream to the response
    props.response.merge(
      stream.toUIMessageStream({
        sendFinish: false,
        sendStart: true,
      }),
    );
  });

// console.log('--------REGISTRY--------');
const aiRouterRegistry = aiMainRouter.registry();
const aiRouterTools = aiRouterRegistry.tools;
type AiRouterTools = InferUITools<typeof aiRouterTools>;
// console.log('--------REGISTRY--------');

export { aiMainRouter, aiRouterRegistry, aiRouterTools, type AiRouterTools };
