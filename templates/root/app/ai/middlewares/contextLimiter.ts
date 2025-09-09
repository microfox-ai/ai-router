import { AiMiddleware } from '@microfox/ai-router';

/**
 * Middleware to limit the number of messages in the context
 * @param count
 * @returns
 */
export const contextLimiter = (count: number) => {
  const middleware: AiMiddleware<any, any, any, any, any> = async (
    props,
    next,
  ) => {
    const { messages } = props.request;
    if (messages.length < count) {
      return next();
    } else {
      props.request.messages = messages.slice(0, -count);
      return next();
    }
  };
  return middleware;
};
