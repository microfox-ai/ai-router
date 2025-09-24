import { google } from '@ai-sdk/google';
import { AiRouter } from '@microfox/ai-router';
import { z } from 'zod';
import { streamText, convertToModelMessages } from 'ai';
import dedent from 'dedent';

const aiRouter = new AiRouter();

export const answerAgent = aiRouter
  .agent('/', async (ctx) => {
    ctx.response.writeMessageMetadata({
      loader: 'Analyzing and answering questions...',
    });

    const { questions, userRequest } = ctx.request.params;

    const textStream = streamText({
      model: google('gemini-2.5-pro'),
      system: dedent`
        You are an expert knowledge assistant with access to comprehensive information.
        Your task is to answer the provided questions based on your knowledge.
        
        IMPORTANT GUIDELINES:
        - Only answer questions you have confident, accurate knowledge about
        - If you don't know something or are uncertain, clearly state "I don't have sufficient knowledge to answer this question accurately"
        - Provide detailed, well-reasoned answers for questions you can answer
        - Use your knowledge to provide comprehensive insights
        - Structure your responses clearly with proper formatting
        - Be honest about the limits of your knowledge
        
        Your responses should be:
        - Accurate and well-informed
        - Comprehensive but concise
        - Properly structured with headers and formatting
        - Honest about knowledge limitations
      `,
      prompt: dedent`
        Original User Request: "${userRequest}"
        
        Generated Questions to Answer:
        ${questions.map((q: string, index: number) => `${index + 1}. ${q}`).join('\n')}
        
        Please provide thoughtful, comprehensive answers to these questions based on your knowledge.
        For each question you can answer confidently, provide a detailed response.
        For questions you cannot answer accurately, clearly state that you don't have sufficient knowledge.
        
        Structure your response with clear headers for each question and maintain professional formatting.
      `,
      maxOutputTokens: 4000,
      onFinish: (output) => {
        console.log('ANSWER GENERATION USAGE', output.totalUsage);
      },
    });

    ctx.response.merge(
      textStream.toUIMessageStream({ sendFinish: false, sendStart: false }),
    );

    await textStream.text;

    return {
      status: 'Questions answered successfully',
      _isFinal: true,
    };
  })
  .actAsTool('/', {
    id: 'answerQuestions',
    name: 'Answer Questions',
    description:
      'Answers the generated questions based on available knowledge, only answering what is known with confidence',
    inputSchema: z.object({
      questions: z.array(z.string()).describe('Array of questions to answer'),
      userRequest: z.string().describe('The original user request for context'),
    }) as any,
    outputSchema: z.object({
      status: z.string().describe('Status of the answer generation'),
    }) as any,
    metadata: {
      icon: '💡',
      title: 'Question Answerer',
      hideUI: true,
    },
  });
