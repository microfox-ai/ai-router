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
import { contextLimiter } from './middlewares/contextLimiter';
import { onlyTextParts } from './middlewares/onlyTextParts';
import { chatRestoreLocal } from '../api/studio/chat/sessions/chatSessionLocal';

const aiRouter = new AiRouter<any, any, any, any>();
// aiRouter.setLogger(console);

const aiMainRouter = aiRouter
  .agent('/system', systemAgent)
  .agent('/summarize', summarizeAgent)
  .agent('/research', braveResearchAgent)
  .use('/', contextLimiter(5))
  .use('/', onlyTextParts(100))
  .agent('/', async (props) => {
    // Ai decides what to do based on the last message & user intent.
    props.response.writeMessageMetadata({
      loader: 'Deciding...',
    });
    console.log('REQUEST MESSAGES', props.request.messages.length);
    const stream = streamText({
      model: google('gemini-2.5-pro'),
      system: dedent`
          You are a helpful assistant that can use the following tools to help the user
          Use the summary tool to summarise the research.
          If you do research or websearch, always follow it up with calling the summary tool.
        `,
      messages: convertToModelMessages(
        props.state.onlyTextMessages || props.request.messages,
      ),
      tools: {
        ...props.next.agentAsTool('/research'),
        ...props.next.agentAsTool('/summarize'),
      },
      toolChoice: 'auto',
      stopWhen: [
        stepCountIs(10),
        ({ steps }) =>
          steps.some((step) =>
            step.toolResults.some(
              (tool) => tool.toolName === 'summarizeResearch',
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
