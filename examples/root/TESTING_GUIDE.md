# Workflow System Testing Guide

This guide covers how to test the complete workflow orchestration system, including registered workflows, orchestration workflows, and worker execution.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Setup](#setup)
3. [Testing via UI](#testing-via-ui)
4. [Testing via API](#testing-via-api)
5. [Database Configuration](#database-configuration)
6. [Workflow Provider Setup](#workflow-provider-setup)
7. [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Dependencies

1. **Build the ai-router package** (if you made changes):
   ```bash
   cd packages/ai-router
   npm run build
   ```

2. **Install dependencies**:
   ```bash
   cd examples/root
   npm install
   ```

### Environment Variables

Create a `.env.local` file in `examples/root/` with the following variables:

#### For Vercel Workflow Provider (default)
```env
WORKFLOW_PROVIDER=vercel
```

#### For Upstash Workflow Provider
```env
WORKFLOW_PROVIDER=upstash
QSTASH_TOKEN=your_qstash_token
QSTASH_URL=https://qstash.upstash.io/v2
QSTASH_CURRENT_SIGNING_KEY=your_current_signing_key
QSTASH_NEXT_SIGNING_KEY=your_next_signing_key
```

#### For MongoDB Storage (optional)
```env
DATABASE_TYPE=mongodb
DATABASE_MONGODB_URI=mongodb://localhost:27017
DATABASE_MONGODB_DB=ai_router
DATABASE_MONGODB_COLLECTION=workflow_jobs
```

Or use MongoDB Atlas:
```env
DATABASE_TYPE=mongodb
DATABASE_MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
DATABASE_MONGODB_DB=ai_router
DATABASE_MONGODB_COLLECTION=workflow_jobs
```

**Note**: If `DATABASE_TYPE` is not set or set to `local`, the system uses in-memory storage (data is lost on server restart).

## Setup

1. **Start the development server**:
   ```bash
   cd examples/root
   npm run dev
   ```

2. **Verify the server is running**:
   - Open `http://localhost:3000` in your browser
   - You should see the application homepage

## Testing via UI

### Test Harness Page

Navigate to: `http://localhost:3000/workflows/test-harness`

This page provides a comprehensive UI for testing all workflow features:

#### 1. Registered Workflow: Echo

**Purpose**: Test basic workflow execution and status polling.

**Steps**:
1. Enter a message (e.g., "hello world")
2. Click "Start echo"
3. Observe the `runId` and `status` displayed
4. Click "Poll status" to check workflow completion
5. View the output in the Output textarea

**Expected Result**:
```json
{
  "echoed": "hello world",
  "at": "2024-01-01T12:00:00.000Z"
}
```

#### 2. Orchestration: Hook + Agents

**Purpose**: Test orchestration with human-in-the-loop (hook) and agent steps.

**Steps**:
1. Click "Start orchestrate"
2. Observe the workflow starts and runs the first agent step
3. Wait for the hook step (status will show "paused" or "waiting")
4. Note the `hook token` displayed
5. Click "Resume approve" or "Resume reject"
6. Observe the workflow continues and completes
7. View the final result in the Output textarea

**Expected Flow**:
- Step 1: Agent call to `/system/current_date` → completes
- Step 2: Hook waits for approval → paused
- Step 3: After approval, agent call to `/system/current_date` → completes
- Final: Status changes to "completed"

#### 3. Worker: Dispatch + Status

**Purpose**: Test worker dispatch (fire-and-forget and await modes) and job status polling.

**Steps**:
1. Enter a worker ID (default: `echo-worker`)
2. Click "Dispatch (await: false)" for fire-and-forget mode
   - Returns immediately with `jobId` and `status: 'queued'`
3. Click "Dispatch (await: true)" for blocking mode
   - Waits for worker completion (may take longer)
4. Click "Poll job" to check job status
5. View the output when status is "completed"

**Expected Result**:
```json
{
  "echoed": "hi from worker",
  "at": "2024-01-01T12:00:00.000Z"
}
```

### Orchestration Page

Navigate to: `http://localhost:3000/workflows/orchestrate`

This page provides a more detailed orchestration testing interface with custom configuration.

## Testing via API

### 1. Start a Registered Workflow

```bash
curl -X POST http://localhost:3000/api/workflows/echo \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "message": "test message"
    }
  }'
```

**Response**:
```json
{
  "runId": "wrun_abc123...",
  "status": "running"
}
```

### 2. Get Workflow Status

```bash
curl "http://localhost:3000/api/workflows/echo/wrun_abc123..."
```

**Response**:
```json
{
  "status": "completed",
  "result": {
    "echoed": "test message",
    "at": "2024-01-01T12:00:00.000Z"
  }
}
```

### 3. Start an Orchestration

```bash
curl -X POST http://localhost:3000/api/workflows/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "steps": [
        {
          "type": "agent",
          "agent": "/system/current_date",
          "id": "date",
          "input": { "format": "iso", "timezone": "UTC" }
        },
        {
          "type": "hook",
          "token": "test-approval:user123:test"
        },
        {
          "type": "agent",
          "agent": "/system/current_date",
          "id": "date2",
          "input": { "format": "iso", "timezone": "UTC" }
        }
      ]
    },
    "input": {},
    "messages": []
  }'
```

**Response**:
```json
{
  "runId": "wrun_xyz789...",
  "status": "running"
}
```

### 4. Send Signal to Resume Hook

```bash
curl -X POST http://localhost:3000/api/workflows/orchestrate/signal \
  -H "Content-Type: application/json" \
  -d '{
    "token": "test-approval:user123:test",
    "payload": { "decision": "approve" }
  }'
```

**Response**:
```json
{
  "success": true,
  "message": "Signal sent"
}
```

### 5. Dispatch a Worker (Fire-and-Forget)

```bash
curl -X POST http://localhost:3000/api/workflows/workers/echo-worker \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "message": "hello from API"
    },
    "await": false
  }'
```

**Response**:
```json
{
  "jobId": "job-1234567890-abc",
  "status": "queued"
}
```

### 6. Dispatch a Worker (Await Mode)

```bash
curl -X POST http://localhost:3000/api/workflows/workers/echo-worker \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "message": "hello from API"
    },
    "await": true
  }'
```

**Response** (may take time if worker is slow):
```json
{
  "jobId": "job-1234567890-abc",
  "status": "queued",
  "message": "Worker job queued. Use GET /api/workflows/workers/:workerId/:jobId to check status, or wait for webhook."
}
```

### 7. Get Worker Job Status

```bash
curl "http://localhost:3000/api/workflows/workers/echo-worker/job-1234567890-abc"
```

**Response**:
```json
{
  "jobId": "job-1234567890-abc",
  "workerId": "echo-worker",
  "status": "completed",
  "input": { "message": "hello from API" },
  "output": {
    "echoed": "hello from API",
    "at": "2024-01-01T12:00:00.000Z"
  },
  "createdAt": "2024-01-01T12:00:00.000Z",
  "updatedAt": "2024-01-01T12:00:05.000Z",
  "completedAt": "2024-01-01T12:00:05.000Z"
}
```

## Database Configuration

### In-Memory Storage (Default)

**Configuration**: `microfox.config.ts`
```typescript
database: {
  type: 'local', // or omit this line
}
```

**Characteristics**:
- ✅ No setup required
- ✅ Fast for development
- ❌ Data lost on server restart
- ❌ Not suitable for production

### MongoDB Storage

**Configuration**: `microfox.config.ts` (config values take precedence over env vars)
```typescript
database: {
  type: 'mongodb',
  mongodb: {
    uri: 'mongodb://localhost:27017', // Or set via env var
    db: 'ai_router', // Or set via env var
    collection: 'workflow_jobs', // Or set via env var
  },
}
```

**Environment Variables** (fallback if not in config):
```env
DATABASE_MONGODB_URI=mongodb://localhost:27017
DATABASE_MONGODB_DB=ai_router
DATABASE_MONGODB_COLLECTION=workflow_jobs
```

**Setup MongoDB Locally**:
```bash
# Using Docker
docker run -d -p 27017:27017 --name mongodb mongo:latest

# Or install MongoDB locally
# macOS: brew install mongodb-community
# Ubuntu: sudo apt-get install mongodb
```

**Setup MongoDB Atlas** (Cloud):
1. Go to https://www.mongodb.com/cloud/atlas
2. Create a free cluster
3. Get connection string
4. Set in config or `DATABASE_MONGODB_URI` env var

**Characteristics**:
- ✅ Persistent storage
- ✅ Production-ready
- ✅ Supports querying and indexing
- ✅ Data survives server restarts
- ⚠️ Requires MongoDB setup

**Verify MongoDB Connection**:
```bash
# Test connection
mongosh "mongodb://localhost:27017"

# Or with Atlas
mongosh "your-atlas-connection-string"
```

### Upstash Redis Storage

**Configuration**: `microfox.config.ts` (config values take precedence over env vars)
```typescript
database: {
  type: 'upstash-redis',
  upstashRedis: {
    url: 'https://your-redis.upstash.io', // Or set via env var
    token: 'your_redis_token', // Or set via env var
    keyPrefix: 'workflow:jobs:', // Optional, defaults to 'workflow:jobs:'
  },
}
```

**Environment Variables** (fallback if not in config):
```env
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_redis_token
UPSTASH_REDIS_KEY_PREFIX=workflow:jobs:  # Optional
```

**Setup Upstash Redis**:
1. Go to https://console.upstash.com/
2. Create a Redis database
3. Get REST URL and token from the dashboard
4. Set in config or environment variables

**Characteristics**:
- ✅ Persistent storage
- ✅ Production-ready
- ✅ Fast, serverless-friendly
- ✅ Perfect for Upstash workflows (same provider)
- ✅ Data survives server restarts
- ✅ Built-in TTL support
- ⚠️ Requires Upstash account

**Verify Upstash Redis Connection**:
```bash
# Test using curl
curl -X GET "https://your-redis.upstash.io/ping" \
  -H "Authorization: Bearer your_redis_token"
```

## Workflow Provider Setup

### Vercel Workflow (Default)

**Configuration**: `microfox.config.ts`
```typescript
workflow: {
  provider: 'vercel',
}
```

**No additional setup required**. The `workflow` package is already installed.

**Verify Installation**:
```bash
npm list workflow
# Should show: workflow@4.0.1-beta.41
```

### Upstash Workflow

**Configuration**: `microfox.config.ts`
```typescript
workflow: {
  provider: 'upstash',
  adapters: {
    upstash: {
      token: process.env.QSTASH_TOKEN,
      url: process.env.QSTASH_URL,
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    },
  },
}
```

**Setup Steps**:
1. Sign up at https://upstash.com/
2. Create a QStash project
3. Get your QStash token and signing keys from the dashboard
4. Set environment variables (see [Environment Variables](#environment-variables))

**Verify Upstash Connection**:
```bash
# Test QStash endpoint
curl -X POST https://qstash.upstash.io/v2/publish/your-endpoint \
  -H "Authorization: Bearer YOUR_QSTASH_TOKEN" \
  -d '{"test": "data"}'
```

## Troubleshooting

### Build Errors

**Error**: `Module '"@microfox/ai-router/workflow"' has no exported member 'createWorkflowClient'`

**Solution**:
```bash
cd packages/ai-router
npm run build
cd ../../examples/root
npm run dev
```

### Workflow Not Starting

**Symptoms**: Workflow returns error or doesn't start

**Check**:
1. Browser console for errors
2. Server logs for errors
3. Verify workflow package: `npm list workflow`
4. Check workflow provider config in `microfox.config.ts`

### MongoDB Connection Errors

**Error**: `Missing MongoDB connection string`

**Solution**:
1. Set `DATABASE_MONGODB_URI` in `.env.local`
2. Verify MongoDB is running: `mongosh "mongodb://localhost:27017"`
3. Check connection string format (no spaces, correct credentials)

**Error**: `Server selection timed out`

**Solution**:
1. Verify MongoDB is accessible
2. Check firewall/network settings
3. For Atlas: Whitelist your IP address in Atlas dashboard

### Worker Not Found

**Error**: `Worker "echo-worker" not found`

**Solution**:
1. Verify worker file exists: `app/ai/workers/echo-worker.worker.ts`
2. Check worker exports default worker: `export default createWorker({ ... })`
3. Restart dev server to trigger auto-discovery
4. Check server logs for worker discovery errors

### Hook Not Pausing

**Symptoms**: Orchestration doesn't pause at hook step

**Check**:
1. Verify token format matches exactly
2. Check workflow observability web UI (if available)
3. Check server logs for hook creation errors
4. For Upstash: Verify `QSTASH_TOKEN` is set correctly

### Upstash Workflow Errors

**Error**: `Invalid QStash token`

**Solution**:
1. Verify `QSTASH_TOKEN` in `.env.local`
2. Check token is from QStash dashboard (not Redis token)
3. Regenerate token if needed

**Error**: `Workflow execution failed`

**Solution**:
1. Check Upstash dashboard for workflow logs
2. Verify all environment variables are set
3. Check network connectivity to Upstash

## Example Test Scenarios

### Scenario 1: Simple Workflow Chain

Test a workflow that calls another workflow:

```typescript
// Create workflow: app/workflows/definitions/chain-test.ts
import { defineWorkflow } from '@microfox/ai-router/workflow';
import { z } from 'zod';

export default defineWorkflow({
  id: 'chain-test',
  input: z.object({ message: z.string() }),
  output: z.object({ result: z.string() }),
  handler: async (input) => {
    'use workflow';
    // Call echo workflow
    const response = await fetch('http://localhost:3000/api/workflows/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { message: input.message } }),
    });
    const data = await response.json();
    return { result: `Chained: ${JSON.stringify(data)}` };
  },
});
```

### Scenario 2: Worker in Orchestration

Test orchestration that includes a worker step:

```typescript
import { createOrchestration } from '@microfox/ai-router';

const config = createOrchestration()
  .agent('/system/current_date', { format: 'iso' }, { id: 'date' })
  .worker('echo-worker', { message: 'from orchestration' }, { id: 'worker' })
  .agent('/system/current_date', { format: 'iso' }, { id: 'date2' })
  .build();
```

### Scenario 3: Parallel Steps

Test parallel execution:

```typescript
import { createOrchestration } from '@microfox/ai-router';

const config = createOrchestration()
  .parallel([
    { type: 'agent', agent: '/system/current_date', input: {}, id: 'date1' },
    { type: 'agent', agent: '/system/current_date', input: {}, id: 'date2' },
    { type: 'agent', agent: '/system/current_date', input: {}, id: 'date3' },
  ])
  .build();
```

## Next Steps

After testing:

1. **Create your own workflows**: Add files to `app/workflows/definitions/`
2. **Create your own workers**: Add files to `app/ai/workers/`
3. **Build orchestration flows**: Use the DSL in your API routes or workflows
4. **Set up production database**: Configure MongoDB or other persistent storage
5. **Deploy**: Follow your deployment platform's instructions

## Additional Resources

- [Workflow Architecture Documentation](./WORKFLOW_ARCHITECTURE.md)
- [Workflow Providers Guide](./WORKFLOW_PROVIDERS.md)
- [Orchestration Testing](./TESTING_ORCHESTRATION.md)
