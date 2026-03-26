# @microfox/ai-worker

Background worker runtime for `ai-router` - SQS-based async agent execution.

## Overview

`@microfox/ai-worker` enables you to run long-running AI agents asynchronously on AWS Lambda, triggered via SQS queues. This allows you to bypass Vercel's timeout limits while maintaining a unified developer experience.

## Features

- **Unified DX**: Define agent logic in one place (`app/ai/agents/...`), deploy automatically to Lambda
- **SQS-based**: Reliable message queuing with automatic retries
- **Webhook callbacks**: Receive completion notifications back to your Next.js app
- **Local development**: Run handlers immediately in development mode
- **Type-safe**: Full TypeScript support with Zod schema validation

## Installation

```bash
npm install @microfox/ai-worker
```

## Quick Start

### 1. Create a Background Worker

```typescript
// app/ai/agents/video-processing.worker.ts
import { createWorker, type WorkerConfig } from '@microfox/ai-worker';
import { z } from 'zod';

// Export workerConfig separately (best practice - CLI extracts this automatically)
export const workerConfig: WorkerConfig = {
  timeout: 900, // 15 minutes
  memorySize: 2048, // 2GB
  // Optional: Lambda layers
  // layers: ['arn:aws:lambda:${aws:region}:${aws:accountId}:layer:ffmpeg:1'],
};

export const videoProcessingAgent = createWorker({
  id: 'video-processing',
  inputSchema: z.object({ url: z.string() }),
  outputSchema: z.object({ processedUrl: z.string() }),
  
  handler: async ({ input, ctx }) => {
    // This runs on AWS Lambda
    const result = await heavyVideoProcessing(input.url);
    return { processedUrl: result };
  },
});
```

### 2. Dispatch from an Orchestrator

```typescript
// app/ai/orchestrator.ts
import { videoProcessingAgent } from './agents/video-processing.worker';

// Dispatch to background worker
const result = await videoProcessingAgent.dispatch(
  { url: 'https://example.com/video.mp4' },
  {
    webhookUrl: 'https://myapp.com/api/ai/callback', // optional
    mode: 'remote', // optional: "auto" | "local" | "remote"
    jobId: 'unique-job-id', // Optional
    metadata: { userId: '123' }, // Optional
  }
);

// Returns: { messageId: string, status: 'queued', jobId: string }
```

### 3. Handle Webhook Callbacks

```typescript
// app/api/ai/callback/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const { jobId, workerId, status, output, error } = await request.json();
  
  if (status === 'success') {
    // Update your database, trigger follow-up agents, etc.
    await updateJobStatus(jobId, 'completed', output);
  } else {
    // Handle error
    await updateJobStatus(jobId, 'failed', error);
  }
  
  return NextResponse.json({ success: true });
}
```

### 4. Deploy Workers

```bash
# Scan app/ai/**/*.worker.ts and deploy to AWS
npx @microfox/ai-worker-cli@latest push
```

## Configuration

### Environment Variables

**Required for Next.js:**
- `WORKER_BASE_URL` - Base URL of your workers service (server-side only). We append `/workers/trigger` and `/workers/config` internally when needed (e.g. `https://.../prod`). For client-side, use `useWorkflowJob` which calls your app's `/api/workflows/*` routes.
- `WORKERS_TRIGGER_API_KEY` - Optional API key for trigger authentication (sent as `x-workers-trigger-key`)

**Required for Lambda (set via deploy script):**
- `AWS_REGION` - AWS region for SQS/Lambda
- `STAGE` - Deployment stage (dev/stage/prod)
- `MONGODB_URI` or `DATABASE_MONGODB_URI` - For job store (and internalJobs / await polling).
- Any secrets your workers need (OPENAI_KEY, DATABASE_URL, etc.)

**Worker-to-worker (Lambda):** When a worker calls another via `ctx.dispatchWorker`, the CLI injects `WORKER_QUEUE_URL_<SANITIZED_ID>` (e.g. `WORKER_QUEUE_URL_COST_USAGE_AI`) into that function’s environment. Same-service callees get this automatically; cross-service callees require setting the env var manually.

### Worker Configuration

**Best Practice**: Export `workerConfig` as a separate const from your worker file:

```typescript
import { type WorkerConfig } from '@microfox/ai-worker';

export const workerConfig: WorkerConfig = {
  timeout: 300, // Lambda timeout in seconds (max 900)
  memorySize: 512, // Lambda memory in MB (128-10240)
  layers: ['arn:aws:lambda:${aws:region}:${aws:accountId}:layer:ffmpeg:1'], // Optional Lambda layers
};
```

The CLI will automatically extract this configuration when generating `serverless.yml`. You do not need to pass it to `createWorker()`.

## Architecture

```
┌─────────────┐
│   Next.js   │
│ Orchestrator│
└──────┬──────┘
       │ dispatch()
       ▼
┌─────────────┐
│  AWS SQS    │
│   Queue     │
└──────┬──────┘
       │ trigger
       ▼
┌─────────────┐
│AWS Lambda   │
│   Worker    │
└──────┬──────┘
       │ POST
       ▼
┌─────────────┐
│  Webhook    │
│  Callback   │
└─────────────┘
```

## API Reference

### `createWorker<INPUT, OUTPUT>(config)`

Creates a background agent with the specified configuration.

**Parameters:**
- `id: string` - Unique worker ID
- `inputSchema: ZodType<INPUT>` - Input validation schema
- `outputSchema: ZodType<OUTPUT>` - Output validation schema
- `handler: WorkerHandler<INPUT, OUTPUT>` - Handler function
- `workerConfig?: WorkerConfig` - **Deprecated**: Prefer exporting `workerConfig` as a separate const

**Returns:** `BackgroundAgent<INPUT, OUTPUT>` with a `dispatch()` method

### `dispatch(input, options)`

Dispatches a job to the background worker.

**Parameters:**
- `input: INPUT` - Input data (validated against `inputSchema`)
- `options: { webhookUrl?: string, jobId?: string, metadata?: Record<string, any> }`

**Returns:** `Promise<{ messageId: string, status: 'queued', jobId: string }>`

### Worker-to-worker: `ctx.dispatchWorker(workerId, input, options?)`

Inside a worker handler, call another worker (fire-and-forget or await):

```typescript
handler: async ({ ctx }) => {
  await ctx.dispatchWorker('other-worker', {}, { await: true });
};
```

- **Fire-and-forget**: `ctx.dispatchWorker(id, input)` — enqueues and returns `{ jobId, messageId }`. Parent job’s `internalJobs` is appended.
- **Await**: `ctx.dispatchWorker(id, input, { await: true })` — enqueues, appends to `internalJobs`, then polls the job store until the child completes or fails. Returns `{ jobId, messageId, output }` or throws. Optional `pollIntervalMs`, `pollTimeoutMs`.

The CLI detects `ctx.dispatchWorker('id', ...)` and adds `WORKER_QUEUE_URL_<ID>` to that Lambda’s env. Local dev uses the HTTP trigger when queue URL is not set.

### Worker queues and HITL (human-in-the-loop)

- **Pause:** When a step has `requiresApproval: true`, `wrapHandlerForQueue` stops **before** dispatching that step, marks the next step `awaiting_approval`, and stores the computed pending input. The target worker does not run until approval.
- **Resume:** `POST .../approve` should call `dispatchWorker` for **that** step only (same `workerJobId`), passing **`{ ...pendingInput, __hitlInput, __hitlDecision }`**. **`wrapHandlerForQueue`** runs **`mapInputFromPrev`** again with **`hitlInput`** / **`pendingStepInput`** on the context so the worker receives merged domain input (no separate app-side merge module).
- **Types:** Import **`MapStepInputContext`** from `@microfox/ai-worker` for mapper functions; use `satisfies WorkerQueueConfig<YourInitial, YourStepOutput>` on `defineWorkerQueue({...})` to document contracts.

#### Optional `chainStrategy` on a step

- **`custom`** or **omitted** — one **`mapInputFromPrev`** export handles **both** advancing the chain and HITL resume (legacy behavior).
- **`passthrough`** — chain path uses **`defaultMapChainPassthrough`**; resume still uses **`mapInputFromPrev`** when `hitlInput` + `pendingStepInput` are present.
- **`continueFromPrevious`** — chain path uses **`defaultMapChainContinueFromPrevious`**; resume still uses **`mapInputFromPrev`**.

#### Worker input: orchestration envelope

Merge your domain Zod object with **`withQueueOrchestrationEnvelope(domainSchema)`**, or intersect a union with **`queueOrchestrationFieldsSchema`**, so `__workerQueue` / HITL keys are accepted without loosening the whole schema.

#### HITL step metadata (`defineHitlConfig`)

Import **`defineHitlConfig`**, **`HitlStepConfig`**, and **`HitlUiSpec`** from **`@microfox/ai-worker`** and pass the result as **`hitl`** on a queue step (with **`requiresApproval: true`**). This is a typed authoring helper; runtime pause behavior is still driven by **`requiresApproval`**.

Full field semantics and lifecycle are documented in the `queue` module JSDoc (`WorkerQueueStep`, `WorkerQueueConfig`).

## License

MIT
