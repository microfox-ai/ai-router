# AI Router

**If you know Express, you already know AI Router.**

AI Router brings a familiar middleware-style architecture to the world of AI Agents. It provides a robust foundation for orchestrating complex AI workflows with multiple agents, tools, and dynamic routing, all while integrating seamlessly with the [Vercel AI SDK](https://ai-sdk.dev/docs/introduction).

## The Problem

Modern AI applications, especially those using helpers like the Vercel AI SDK's `useChat`, typically connect the frontend to a single backend API endpoint. This creates a significant challenge: how do you manage a complex, multi-agent system through that single route?

```typescript
// Your frontend connects to ONE endpoint
const { messages, append } = useChat({
  api: '/api/chat', // Single endpoint for everything
});
```

Cramming an entire agentic orchestration logic—with multiple specialized agents, tools, and state management—into a single function is complex, hard to maintain, and quickly becomes unmanageable.

## The Solution: AI Router

AI Router solves this with the **Principle of Singularity**. It allows you to build a sophisticated web of agents, middleware, and tools, each with its own path, and then serve the entire system through a single handler.

Your frontend communicates with one endpoint, while your backend remains modular, organized, and scalable.

## Core Principles

### 1. **Principle of Singularity**

Your frontend connects to one endpoint, but your backend is modular and organized:

```typescript
// Frontend: Still one endpoint
const { messages, append } = useChat({
  api: '/api/chat',
});

// Backend: Clean, modular agents & routing logic
router.agent('/code-generator', codeGeneratorHandler);
router.agent('/data-analyzer', dataAnalyzerHandler);
router.agent('/content-writer', contentWriterHandler);
```

### 2. **Express.js Familiarity**

If you know Express.js, you already know AI Router:

```typescript
// Express.js style routing
router.use('*', authMiddleware);
router.agent('/users/:id', userAgent);
```

### 3. **Agent-as-Tools Pattern**

Agents can be attached as tools to LLM calls, enabling agent sub-agent architecture similar to Google's Agent Development Kit:

```typescript
router.agent('/blog-writer', async (ctx) => {
  const { topic } = ctx.request.params;
  const { text } = await generateText({
    model: openai('gpt-4'),
    prompt: `Write a blog post about ${topic}.`,
    tools: {
      // Attach the existing agent as a tool for the LLM to use
      ...ctx.next.agentAsTool('/research'),
    },
  });
  ctx.response.write({ type: 'text', text });
});
```

### 4. **Leaner Orchestration** with Internal Shared State

```typescript
// Main orchestrator
router.agent('/', async (ctx) => {
  const stream = streamText({
    model: openai('gpt-4'),
    prompt: `Write a blog post about ${topic}.`,
    tools: {
      ...ctx.next.agentAsTool('/agent-1'),
      ...ctx.next.agentAsTool('/agent-2'),
    },
  });
});

// Agent 1: Sets state
router.agent('/agent-1', async (ctx) => {
  ctx.state.topic = 'LONG RESEARCH INFORMATION';
  return { action: 'done' };
});

// Agent 2: Accesses state
router.agent('/agent-2', async (ctx) => {
  const { topic } = ctx.request.state;
  const { text } = await generateText({
    model: openai('gpt-4'),
    prompt: `Write a blog post about ${topic}.`,
  });
});
```

## Getting Started

### Installation

```bash
npm install @microfox/ai-router
```

### Basic Setup

```typescript
import { AiRouter, MemoryStore } from '@microfox/ai-router';

// Create a new router instance
const router = new AiRouter();

// Define your agents
router.agent('/', async (ctx) => {
  return { message: 'Hello from AI Router!' };
});

// Next.js API Route
export async function POST(request: Request) {
  const body = await request.json();
  const { messages, ...restOfBody } = body;

  const response = router.handle('/', {
    request: {
      ...restOfBody,
      messages: messages || [],
    },
  });

  return response;
}
```

## Agents

Agents are the primary handlers in your AI Router application. They are async functions that receive a context object and can interact with users, call other agents, or be exposed as tools for LLM integration.

### Basic Agent

```typescript
router.agent('/path', async (ctx) => {
  // Agent logic here
  return { message: 'Hello from agent!' };
});
```

### Dynamic Paths with Parameters

```typescript
router.agent('/users/:userId', async (ctx) => {
  const { userId } = ctx.request.params;
  return { user: { id: userId, name: `User ${userId}` } };
});
```

### Agent-to-Agent Communication

```typescript
router.agent('/orchestrator', async (ctx) => {
  // Call another agent and wait for result
  const result = await ctx.next.callAgent('/worker', { task: 'process-data' });

  if (result.ok) {
    return { message: `Result: ${result.data}` };
  } else {
    return { error: 'Worker failed', details: result.error.message };
  }
});

router.agent('/worker', async (ctx) => {
  const { task } = ctx.request.params;
  return { processed: `Processed: ${task}` };
});
```

## Agent-as-Tools

The **Agent-as-Tools** pattern allows you to expose any agent as a reusable tool that can be used by LLMs and other agents, creating powerful orchestration capabilities.

### Creating an Agent as a Tool

```typescript
import { z } from 'zod';

const researchAgent = new AiRouter();

researchAgent
  .agent('/', async (ctx) => {
    const { query } = ctx.request.params;
    const summary = await researchService.search(query);
    return {
      summary,
      sources: summary.sources,
      timestamp: new Date().toISOString(),
    };
  })
  .actAsTool('/', {
    id: 'research',
    name: 'Research Agent',
    description: 'Performs comprehensive web research on any topic',
    inputSchema: z.object({
      query: z.string().describe('The research query or topic to investigate'),
      depth: z
        .enum(['shallow', 'deep'])
        .optional()
        .describe('Research depth level'),
    }),
    outputSchema: z.object({
      summary: z.string().describe('Research summary'),
      sources: z.array(z.string()).describe('List of source URLs'),
      timestamp: z.string().describe('When the research was performed'),
    }),
    metadata: {
      icon: '🔍',
      title: 'Research',
      category: 'information',
    },
  });

// Mount the agent
router.agent('/research', researchAgent);
```

### Using Agents as Tools

```typescript
router.agent('/blog-writer', async (ctx) => {
  const { topic } = ctx.request.params;

  const stream = streamText({
    model: openai('gpt-4'),
    prompt: `Write a comprehensive blog post about ${topic}. Use research to gather current information.`,
    tools: {
      research: ctx.next.agentAsTool('/research'),
    },
  });

  return stream;
});
```

## Next.js Integration

AI Router integrates seamlessly with Next.js App Router:

```typescript
// app/api/chat/route.ts
import { AiRouter, MemoryStore } from '@microfox/ai-router';

const router = new AiRouter();
router.setStore(new MemoryStore());

router.agent('/', async (ctx) => {
  return { message: 'Hello from ai-router!' };
});

export async function POST(request: Request) {
  const body = await request.json();
  const { messages, ...restOfBody } = body;

  const response = router.handle('/', {
    request: {
      ...restOfBody,
      messages: messages || [],
    },
  });

  return response;
}
```

```typescript
// app/page.tsx
'use client';

import { useChat } from 'ai/react';

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit } = useChat({
    api: '/api/chat', // Single endpoint for all AI functionality
  });

  return (
    <div>
      {messages.map((message) => (
        <div key={message.id}>
          {message.role}: {message.content}
        </div>
      ))}

      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Ask me anything..."
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
```

## Key Features

- **Express.js Familiarity**: If you know Express, you already know AI Router
- **Agent-as-Tools**: Expose agents as tools for LLM integration
- **Hierarchical Routing**: Build complex, multi-agent systems with clear separation of concerns
- **State Management**: Shared state across agents with internal state management
- **Streaming Support**: Built on top of Vercel AI SDK v5 for real-time responses
- **Type Safety**: Full TypeScript support with Zod schema validation
- **Middleware Support**: Cross-cutting concerns with familiar middleware patterns
- **Token Optimization**: Leaner orchestration with shared state

## Prerequisites

It helps if you already have a good understanding of the following frameworks & packages:

- Ai-SDK v5
- Next.js
- Tailwind CSS

## Documentation

For comprehensive documentation, examples, and advanced usage patterns, visit our [documentation site](https://docs.microfox.ai/ai-router).

## License

MIT
