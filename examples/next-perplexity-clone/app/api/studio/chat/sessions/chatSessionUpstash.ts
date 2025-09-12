import { AiMiddleware, getTextParts } from '@microfox/ai-router';
import { CrudHash, CrudStore } from '@microfox/db-upstash';
import { generateId, generateText, UIMessage } from 'ai';
import { Redis } from '@upstash/redis';
import { google } from '@ai-sdk/google';

export type ChatSession = {
  id: string;
  title: string;
  createdAt: string;
  metadata?: any;
  autoSubmit?: string;
};

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  metadata?: any;
  parts: any[];
  createdAt: string;
  updatedAt: string;
};

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export const sessionStore = new CrudHash<ChatSession>(redis, 'chat_sessions');
export const messageStore = new CrudHash<ChatMessage>(
  redis,
  'chat_messages_v2',
);

/**
 * Middleware to restore chat session from Redis
 * @param props - The context object
 * @param next - The next middleware or router
 * @returns
 */
export const chatRestoreUpstash: AiMiddleware<{
  sessionId: string;
  loader?: string;
}> = async (props, next) => {
  try {
    const { sessionId, messages } = props.request;
    if (!sessionId || sessionId === 'undefined') {
      return next();
    }
    const newMessage = messages[messages.length - 1];

    // update UI on frontend for smoother experience
    props.response.writeMessageMetadata({
      loader: 'Initializing...',
    });

    let oldMessages = (
      await messageStore.query(`${sessionId}-*`, {
        count: 1000,
        offset: 0,
      })
    ).sort(
      (b, a) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    console.log('last oldMessages', oldMessages[oldMessages.length - 1]);
    // restore chat session
    if (oldMessages && oldMessages.length > 0) {
      // slice context to only the last 5 messages
      // if (oldMessages.length > 5) {
      //   oldMessages = oldMessages.slice(0, -5);
      // }
      const isNewMessageInStore = oldMessages.find(
        (message) => message.id === newMessage.id,
      );
      if (isNewMessageInStore) {
        props.request.messages = oldMessages.map((message) =>
          message.id === newMessage.id ? newMessage : message,
        );
      } else {
        props.request.messages = oldMessages.concat([
          {
            ...newMessage,
            sessionId: sessionId,
            content: getTextParts(newMessage).join('\n'),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]);
      }
    }

    // create chat session
    if (!oldMessages || oldMessages.length === 0) {
      props.request.messages = [newMessage];
      const title = await generateText({
        model: google('gemini-2.5-flash'),
        prompt: `Generate a title for the chat session based on the messages: ${getTextParts(newMessage).join('\n')}`,
        system: `You are a helpful assistant that generates a title for a chat session based on the messages.`,
      });
      await sessionStore.update(sessionId, {
        title: title.text,
        createdAt: new Date().toISOString(),
      });
      await messageStore.set(newMessage.id, {
        ...newMessage,
        sessionId: sessionId,
        content: getTextParts(newMessage).join('\n'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      props.request.sessionId = sessionId;
    }

    // continue to next middleware or router
    return next();
  } catch (error) {
    props.logger.error('Error restoring chat session', error);
    // stops the router from continuing to next middleware or router
    return;
  }
};
