import { AiMiddleware, getTextParts } from '@microfox/ai-router';
import { FileSystemStore } from '@microfox/ai-router/fs_store';
import { generateId, generateText, UIMessage } from 'ai';
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

export type ChatSessionData = {
  session: ChatSession;
  messages: ChatMessage[];
};

// Create .chat directory if it doesn't exist
const ensureChatDirectory = async () => {
  try {
    if (typeof window !== 'undefined') {
      return null;
    }

    // Use eval to avoid bundler module resolution
    const fs = eval('require("fs/promises")');
    const path = eval('require("path")');
    const chatDir = path.join(process.cwd(), '.chat');
    try {
      await fs.access(chatDir);
    } catch {
      await fs.mkdir(chatDir, { recursive: true });
    }
    return chatDir;
  } catch (error) {
    console.error('Error ensuring chat directory', error);
    return null;
  }
};

const getSessionFilePath = async (sessionId: string) => {
  try {
    if (typeof window !== 'undefined') {
      return null;
    }

    // Use eval to avoid bundler module resolution
    const path = eval('require("path")');
    const chatDir = await ensureChatDirectory();
    if (!chatDir) {
      return null;
    }
    return path.join(chatDir, `${sessionId}.json`);
  } catch (error) {
    console.error('Error getting session file path', error);
    return null;
  }
};

export const sesionLocalStore = async (sessionId: string) => {
  try {
    if (typeof window !== 'undefined') {
      return null;
    }

    // Use eval to avoid bundler module resolution
    const fs = eval('require("fs/promises")');
    const path = eval('require("path")');
    const chatDir = await ensureChatDirectory();
    if (!chatDir) {
      return null;
    }
    const sessionFilePath = path.join(chatDir, `${sessionId}.json`);

    try {
      await fs.access(sessionFilePath);
      return new FileSystemStore(sessionFilePath);
    } catch {
      // File doesn't exist, create it
      await fs.writeFile(
        sessionFilePath,
        JSON.stringify({
          sessionData: {
            session: {
              id: sessionId,
              title: 'New Chat',
              createdAt: new Date().toISOString(),
              metadata: {},
              autoSubmit: null,
            },
            messages: [],
          },
        }),
        'utf-8',
      );
      return new FileSystemStore(sessionFilePath);
    }
  } catch (error) {
    console.error('Error ensuring chat directory', error);
    return null;
  }
};

export const sessionLocalListOut = async () => {
  try {
    if (typeof window !== 'undefined') {
      return null;
    }

    // Use eval to avoid bundler module resolution
    const fs = eval('require("fs/promises")');
    const chatDir = await ensureChatDirectory();
    if (!chatDir) {
      return null;
    }
    const sessions = await fs.readdir(chatDir);
    return sessions.map((session: string) => session.replace('.json', ''));
  } catch (error) {
    console.error('Error ensuring chat directory', error);
    return null;
  }
};

/**
 * Middleware to restore chat session from local file storage
 * @param props - The context object
 * @param next - The next middleware or router
 * @returns
 */
export const chatRestoreLocal: AiMiddleware<{
  sessionId: string;
  loader?: string;
}> = async (props, next) => {
  try {
    const { sessionId, messages } = props.request;

    if (!sessionId || sessionId === 'undefined') {
      return next();
    }

    // update UI on frontend for smoother experience
    props.response.writeMessageMetadata({
      loader: 'Initializing...',
    });

    const newMessage = messages[messages.length - 1];
    const chatDir = await ensureChatDirectory();
    const sessionFilePath = await getSessionFilePath(sessionId);

    if (!sessionFilePath) {
      console.error('Failed to get session file path');
      return next();
    }

    // Create FileSystemStore instance for this session
    const sessionStore = new FileSystemStore(sessionFilePath);
    // Try to load existing session data
    const existingData = await sessionStore.get<ChatSessionData>('sessionData');
    //<ChatSessionData>("sessionData");
    if (
      existingData &&
      existingData.messages &&
      existingData.messages.length > 0
    ) {
      const oldMessages = existingData.messages.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

      // Check if the new message already exists in the store
      const isNewMessageInStore = oldMessages.find(
        (message) => message.id === newMessage.id,
      );

      if (isNewMessageInStore) {
        props.request.messages = oldMessages.map((message) =>
          message.id === newMessage.id ? newMessage : message,
        );
      } else {
        const updatedMessages = oldMessages.concat([
          {
            ...newMessage,
            sessionId: sessionId,
            content: getTextParts(newMessage).join('\n'),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]);

        props.request.messages = updatedMessages;
      }
    } else {
      // Create new chat session
      props.request.messages = [newMessage];

      const title = await generateText({
        model: google('gemini-2.5-flash'),
        prompt: `Generate a title for the chat session based on the messages: ${getTextParts(newMessage).join('\n')}`,
        system: `You are a helpful assistant that generates a title for a chat session based on the messages.`,
      });

      const newSession: ChatSession = {
        id: sessionId,
        title: title.text,
        createdAt: new Date().toISOString(),
      };

      const newMessageData: ChatMessage = {
        ...newMessage,
        sessionId: sessionId,
        content: getTextParts(newMessage).join('\n'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Save new session and message to file
      await sessionStore.set('sessionData', {
        session: newSession,
        messages: [newMessageData],
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
