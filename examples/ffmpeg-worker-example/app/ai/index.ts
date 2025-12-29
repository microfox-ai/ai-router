import { google } from '@ai-sdk/google';
import { AiRouter } from '@microfox/ai-router';
import {
  convertToModelMessages,
  InferUITools,
  stepCountIs,
  streamText,
} from 'ai';
import dedent from 'dedent';
import { ffmpegAgents } from './agents/ffmpeg';

const aiRouter = new AiRouter<any, any, any, any>();
// aiRouter.setLogger(console);

const aiMainRouter = aiRouter
  .agent('/ffmpeg', ffmpegAgents)
  .agent('/', async (props) => {
    // show a loading indicator
    props.response.writeMessageMetadata({
      loader: 'Thinking...',
    });

    // main orchestration as a stream
    const stream = streamText({
      model: google('gemini-2.5-pro'),
      system: dedent`
          You are a helpful assistant that can help users with video and media processing tasks.
          You can analyze media files and convert videos using the available worker tools.
          
          Available tools:
          - ffprobe: Analyze media files to get metadata (duration, resolution, fps, etc.)
          - video-converter: Convert videos between formats (MP4, WebM, MOV, AVI)
        `,
      messages: convertToModelMessages(props.request.messages),
      tools: {
        // Note: Worker agents are typically called via API routes, not directly as tools
        // This is a simplified example - in production, you'd expose them via actAsTool if needed
      },
      toolChoice: 'auto',
      // stop conditions
      stopWhen: [
        stepCountIs(10),
        ({ steps }) =>
          steps.some((step) =>
            step.toolResults.some((tool) => tool.output),
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
