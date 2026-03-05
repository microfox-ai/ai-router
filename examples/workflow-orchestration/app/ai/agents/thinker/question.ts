import { google } from '@ai-sdk/google';
import { AiRouter } from '@microfox/ai-router';
import { z } from 'zod';
import { generateObject } from 'ai';
import dedent from 'dedent';

const aiRouter = new AiRouter();

export const questionAgent = aiRouter
  .agent('/', async (ctx) => {
    ctx.response.writeMessageMetadata({
      loader: 'Generating deeper questions...',
    });

    const { userRequest } = ctx.request.params;

    const questionGeneration = await generateObject({
      model: google('gemini-2.5-flash'),
      schema: z.object({
        questions: z
          .array(z.string())
          .describe(
            "Array of deeper, thought-provoking questions that would help understand the user's request better",
          ),
        reasoning: z
          .string()
          .describe(
            "Brief explanation of why these questions are important for understanding the user's request",
          ),
      }),
      prompt: dedent`
        Based on the user's request: "${userRequest}"
        
        Generate 3-5 deeper, thought-provoking questions that would help understand the user's request better. 
        These questions should:
        - Explore the underlying assumptions and context
        - Consider different perspectives or angles
        - Help clarify the user's true intent or needs
        - Be specific and actionable
        - Encourage deeper thinking about the topic
        
        Focus on questions that would provide valuable insights for a comprehensive response.
      `,
    });

    console.log('QUESTION GENERATION USAGE', questionGeneration.usage);

    return {
      questions: questionGeneration.object.questions,
      reasoning: questionGeneration.object.reasoning,
      status: 'Questions generated successfully',
    };
  })
  .actAsTool('/', {
    id: 'generateQuestions',
    name: 'Generate Deeper Questions',
    description:
      "Generates deeper, thought-provoking questions based on the user's request to better understand their needs",
    inputSchema: z.object({
      userRequest: z
        .string()
        .describe("The user's original request or question"),
    }) as any,
    outputSchema: z.object({
      questions: z
        .array(z.string())
        .describe('Array of deeper questions generated'),
      reasoning: z
        .string()
        .describe('Explanation of why these questions are important'),
      status: z.string().describe('Status of the question generation'),
    }) as any,
    metadata: {
      icon: '❓',
      title: 'Question Generator',
      hideUI: true,
    },
  });
