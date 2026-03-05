import { google } from '@ai-sdk/google';
import { AiRouter } from '@microfox/ai-router';
import { z } from 'zod';
import { streamText, convertToModelMessages, stepCountIs } from 'ai';
import dedent from 'dedent';
import { questionAgent } from './question';
import { answerAgent } from './answer';

const aiRouter = new AiRouter();

export const thinkerAgent = aiRouter
  .agent('/question', questionAgent)
  .agent('/answer', answerAgent)
  .agent('/', async (ctx) => {
    ctx.response.writeMessageMetadata({
      loader: 'Thinking deeply about your request...',
    });

    const userRequest =
      ctx.request.params.userRequest ||
      ctx.state.onlyTextMessages?.[ctx.state.onlyTextMessages.length - 1]
        ?.content ||
      'No request provided';

    // First, generate deeper questions
    const questionResult = await ctx.next.callAgent(
      '/question',
      {
        userRequest,
      },
      {
        streamToUI: false,
      },
    );

    if (!questionResult.ok) {
      throw questionResult.error;
    }

    const { questions } = questionResult.data;

    // Then answer the questions
    const answerResult = await ctx.next.callAgent(
      '/answer',
      {
        questions,
        userRequest,
      },
      {
        streamToUI: true,
      },
    );

    if (!answerResult.ok) {
      throw answerResult.error;
    }

    return {
      status: 'Deep thinking completed',
      _isFinal: true,
    };
  })
  .actAsTool('/', {
    id: 'thinker',
    name: 'Deep Thinker',
    description:
      "Generates deeper questions about the user's request and provides comprehensive answers based on available knowledge",
    inputSchema: z.object({
      userRequest: z
        .string()
        .describe("The user's request or question to think deeply about"),
    }) as any,
    outputSchema: z.object({
      status: z.string().describe('Status of the thinking process'),
    }) as any,
    metadata: {
      icon: '🧠',
      title: 'Deep Thinker',
      hideUI: true,
    },
  });
