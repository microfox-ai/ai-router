import { AiMiddleware } from '@microfox/ai-router';
import { convertToModelMessages, streamText, stepCountIs } from 'ai';
import { google } from '@ai-sdk/google';
import dedent from 'dedent';

/**
 * Middleware to restore chat session from Redis
 * @param props - The context object
 * @param next - The next middleware or router
 * @returns
 */
export const mainOrchestrator: AiMiddleware<{
  sessionId: string;
}> = async (props) => {
  // Ai decides what to do based on the last message & user intent.

  const messages = props.request.messages;
  const lastMessage = messages[messages.length - 1];

  console.log('messages.length', messages.length);
  if (lastMessage.role === 'user') {
    // console.log('lastMessage', lastMessage.parts);
    console.log(
      'toolset',
      props.next.getToolDefinition('/research/brave')?.metadata?.toolKey,
      props.next.getToolDefinition('/summarize')?.metadata?.toolKey,
      Object.keys({
        ...props.next.agentAsTool('/research/brave'),
        ...props.next.agentAsTool('/summarize'),
      }),
    );
    const stream = streamText({
      model: google('gemini-2.5-pro'),
      system: dedent`
        You are a helpful assistant that can use the following tools to help the user:
        
        Tools:
        ${props.next.getToolDefinition('/research/brave')?.metadata?.toolKey}
        - Use this tool to research the web for any information.
        ${props.next.getToolDefinition('/summarize')?.metadata?.toolKey}
        - Use this tool to summarise the research.

        Notes:
        You Must summarise the research using the ${props.next.getToolDefinition('/summarize')?.metadata?.toolKey} tool.
      `,
      messages: convertToModelMessages(messages),
      tools: {
        ...props.next.agentAsTool('/research/brave'),
        ...props.next.agentAsTool('/summarize'),
      },
      toolChoice: 'required',
      onFinish: (result) => {
        console.log('TOTAL USAGE', result.totalUsage);
      },
    });

    props.response.merge(
      stream.toUIMessageStream({
        sendFinish: false,
        sendStart: false,
      }),
    );

    await stream.text;
  } else {
    // this must be a tool-result submission
  }
};
