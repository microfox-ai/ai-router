import { AiMiddleware, getTextParts } from '@microfox/ai-router';
import { UIMessage } from 'ai';

/**
 * Middleware to only keep the text parts of the messages and limit the total combined length
 * of all assistant message text parts to the specified maximum
 * @param maxTotalTextLength - The maximum total length of all assistant message text parts combined
 * @returns
 */
export const onlyTextParts = (maxTotalTextLength: number) => {
  const middleware: AiMiddleware = async (props, next) => {
    const messages = props.request.messages;

    // First, collect all assistant message text parts and calculate total length
    const assistantTextParts: string[] = [];
    let totalAssistantTextLength = 0;

    messages.forEach((message) => {
      if (message.role === 'assistant') {
        message.parts
          .filter((part) => part.type === 'text')
          .forEach((part) => {
            assistantTextParts.push(part.text);
            totalAssistantTextLength += part.text.length;
          });
      }
    });

    // Calculate how much to truncate if we exceed the limit
    const truncationNeeded = totalAssistantTextLength > maxTotalTextLength;
    const truncationRatio = truncationNeeded
      ? maxTotalTextLength / totalAssistantTextLength
      : 1;

    const onlyTextMessages: UIMessage<any, any, any>[] = messages.map(
      (message) => {
        if (message.role === 'user') {
          // Keep all text parts for user messages
          return {
            ...message,
            parts: message.parts.filter((part) => part.type === 'text'),
          };
        } else if (message.role === 'assistant') {
          // For assistant messages, truncate text parts proportionally if needed
          return {
            ...message,
            parts: message.parts
              .filter((part) => part.type === 'text')
              .map((part) => ({
                ...part,
                text: truncationNeeded
                  ? part.text.slice(
                      0,
                      Math.floor(part.text.length * truncationRatio),
                    )
                  : part.text,
              })),
          };
        } else {
          // For other message types, keep as is
          return message;
        }
      },
    );

    props.state.onlyTextMessages = onlyTextMessages;
    return next();
  };
  return middleware;
};
