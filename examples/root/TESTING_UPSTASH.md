# Testing Upstash Workflows & Orchestration

This guide covers how to test workflows and orchestration specifically with the **Upstash workflow provider**.

## Prerequisites

### 1. Environment Variables Setup

Make sure you have set the following in your `.env.local`:

```env
WORKFLOW_PROVIDER=upstash
QSTASH_TOKEN=your_qstash_token
QSTASH_URL=https://qstash.upstash.io/v2
QSTASH_CURRENT_SIGNING_KEY=your_current_signing_key
QSTASH_NEXT_SIGNING_KEY=your_next_signing_key

# Optional: Database for persistent job storage
# Option 1: MongoDB
DATABASE_TYPE=mongodb
DATABASE_MONGODB_URI=mongodb://localhost:27017
DATABASE_MONGODB_DB=ai_router
DATABASE_MONGODB_COLLECTION=workflow_jobs

# Option 2: Upstash Redis (recommended for Upstash workflows)
DATABASE_TYPE=upstash-redis
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_redis_token
```

### 2. Configuration Options

You can configure everything in `microfox.config.ts` (recommended) or use environment variables as fallback:

**Option A: Config-based (Recommended)**

```typescript
// microfox.config.ts
export const StudioConfig = {
  // ... other config
  studioSettings: {
    database: {
      type: 'upstash-redis', // or 'mongodb' or 'local'
      upstashRedis: {
        url: 'https://your-redis.upstash.io', // Config value takes precedence
        token: 'your_redis_token', // Config value takes precedence
        keyPrefix: 'workflow:jobs:', // Optional, defaults to 'workflow:jobs:'
      },
      mongodb: {
        uri: 'mongodb://localhost:27017', // Config value takes precedence
        db: 'ai_router', // Config value takes precedence
        collection: 'workflow_jobs', // Config value takes precedence
      },
    },
  },
  workflow: {
    provider: 'upstash', // Config value takes precedence
    adapters: {
      upstash: {
        token: 'your_qstash_token', // Config value takes precedence
        url: 'https://qstash.upstash.io/v2', // Config value takes precedence
        currentSigningKey: 'your_key', // Config value takes precedence
        nextSigningKey: 'your_key', // Config value takes precedence
      },
    },
  },
};
```

**Option B: Environment Variables (Fallback)**

If config values are not set, environment variables are used as fallback. The config file already includes env var fallbacks, so you can just set env vars if you prefer.

### 3. Start Development Server

```bash
cd examples/root
npm run dev
```

**Important**: With Upstash, your local server must be accessible from the internet for webhooks to work. Use a tool like:
- **ngrok**: `ngrok http 3000` (recommended)
- **Cloudflare Tunnel**: `cloudflared tunnel --url http://localhost:3000`
- **localtunnel**: `npx localtunnel --port 3000`

## Testing via UI

### Test Harness Page

Navigate to: `http://localhost:3000/workflows/test-harness`

This page works the same for both Vercel and Upstash providers. The system automatically routes to the correct provider based on your configuration.

#### 1. Test Registered Workflow (Echo)

1. Enter a message (e.g., "hello upstash")
2. Click **"Start echo"**
3. Observe the `runId` (Upstash runIds start with different format than Vercel)
4. Click **"Poll status"** to check completion
5. View output when status is "completed"

**Note**: Upstash workflows may take slightly longer to start due to HTTP round-trips.

#### 2. Test Orchestration with Hook

1. Click **"Start orchestrate"**
2. Wait for the workflow to reach the hook step
3. Note the `hook token` displayed
4. Click **"Resume approve"** or **"Resume reject"**
5. Observe workflow continues and completes

**Upstash-specific behavior**:
- Hooks use `context.waitForEvent()` with the token as `eventId`
- Signals are sent via Upstash `client.notify()` API
- Hook timeout is configurable via `config.hookTimeout` (default: 7 days)

#### 3. Test Worker Dispatch

1. Enter worker ID (e.g., `echo-worker`)
2. Click **"Dispatch (await: true)"**
3. Worker job is stored in MongoDB (if configured) or in-memory
4. When worker completes, it calls webhook which updates job store
5. Upstash workflow is notified via `client.notify()` with `jobId` as `eventId`
6. Workflow continues after receiving the event

## Testing via API

### 1. Start an Upstash Orchestration

```bash
curl -X POST http://localhost:3000/api/workflows/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "steps": [
        {
          "type": "agent",
          "agent": "/system/current_date",
          "id": "date1",
          "input": { "format": "iso", "timezone": "UTC" }
        },
        {
          "type": "sleep",
          "duration": "2s"
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
  "runId": "upstash-run-id-...",
  "status": "running"
}
```

### 2. Get Orchestration Status

```bash
curl "http://localhost:3000/api/workflows/orchestrate/upstash-run-id-..."
```

**Response**:
```json
{
  "status": "paused",
  "hook": {
    "token": "test-approval:user123:test"
  }
}
```

### 3. Send Signal to Resume Hook

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

### 4. Test Worker in Orchestration (Await Mode)

Start an orchestration that includes a worker step:

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
          "input": { "format": "iso" }
        },
        {
          "type": "worker",
          "worker": "echo-worker",
          "input": { "message": "from upstash orchestration" },
          "id": "worker",
          "await": true
        },
        {
          "type": "agent",
          "agent": "/system/current_date",
          "id": "date2",
          "input": { "format": "iso" }
        }
      ]
    },
    "input": {},
    "messages": []
  }'
```

**How it works**:
1. Orchestration starts and executes first agent step
2. Worker is dispatched via `/api/workflows/workers/echo-worker`
3. Job is stored in job store (MongoDB or in-memory)
4. Worker executes and calls webhook when complete
5. Webhook updates job store and calls `client.notify()` with `jobId` as `eventId`
6. Upstash workflow receives event via `context.waitForEvent(jobId)`
7. Orchestration continues with next step

### 5. Test Parallel Steps

```bash
curl -X POST http://localhost:3000/api/workflows/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "steps": [
        {
          "type": "parallel",
          "steps": [
            {
              "type": "agent",
              "agent": "/system/current_date",
              "input": {},
              "id": "date1"
            },
            {
              "type": "agent",
              "agent": "/system/current_date",
              "input": {},
              "id": "date2"
            },
            {
              "type": "agent",
              "agent": "/system/current_date",
              "input": {},
              "id": "date3"
            }
          ]
        }
      ]
    },
    "input": {},
    "messages": []
  }'
```

**Upstash behavior**:
- Parallel steps use `Promise.allSettled()` with `context.run()` for each step
- Each step runs in isolation with error handling
- All steps complete before continuing (even if some fail, depending on `continueOnError`)

## Upstash-Specific Features

### 1. Hook Timeout Configuration

You can configure hook timeout in the orchestration config:

```typescript
const config = createOrchestration()
  .agent('/system/current_date', {}, { id: 'date' })
  .hook(() => 'my-token', z.object({ decision: z.string() }))
  .build();

// Add hook timeout (default: 7 days)
config.hookTimeout = '1h'; // or '30m', '2d', etc.
```

### 2. Error Handling

Configure error handling behavior:

```typescript
const config = createOrchestration()
  .agent('/system/current_date', {}, { id: 'date' })
  .agent('/system/current_date', {}, { id: 'date2' })
  .build();

// Continue on error (default: false)
config.continueOnError = true;
```

### 3. Workflow Timeout

Set overall workflow timeout:

```typescript
const config = createOrchestration()
  .agent('/system/current_date', {}, { id: 'date' })
  .build();

// Set workflow timeout (e.g., 5 minutes)
config.timeout = '5m';
```

## Monitoring Upstash Workflows

### 1. Upstash Dashboard

1. Go to https://console.upstash.com/
2. Navigate to your QStash project
3. View workflow executions in the dashboard
4. Check logs and execution history

### 2. Local Logs

Check your Next.js server logs for:
- Workflow start/execution logs
- Hook token generation
- Signal receipt
- Worker job updates

### 3. Job Store Monitoring

#### MongoDB Job Store (if configured)

Query job store to see worker job status:

```bash
# Connect to MongoDB
mongosh "mongodb://localhost:27017"

# Use database
use ai_router

# Query jobs
db.workflow_jobs.find().sort({ createdAt: -1 }).limit(10)
```

#### Upstash Redis Job Store (if configured)

Query job store using Upstash Redis CLI or dashboard:

```bash
# Using Upstash CLI (if installed)
upstash redis get workflow:jobs:job-1234567890-abc

# Or use Redis CLI with REST API
curl -X GET "https://your-redis.upstash.io/get/workflow:jobs:job-1234567890-abc" \
  -H "Authorization: Bearer your_redis_token"
```

Or check in Upstash Console:
1. Go to https://console.upstash.com/
2. Navigate to your Redis database
3. Use the data browser to view keys matching `workflow:jobs:*`

## Troubleshooting

### Workflow Not Starting

**Symptoms**: Request returns error or workflow doesn't execute

**Check**:
1. Verify `QSTASH_TOKEN` is set correctly
2. Check QStash URL is correct: `https://qstash.upstash.io/v2`
3. Verify signing keys are set
4. Check server logs for QStash API errors
5. Ensure your server is accessible from internet (for webhooks)

### Hook Not Pausing

**Symptoms**: Workflow doesn't pause at hook step

**Check**:
1. Verify hook token format matches exactly
2. Check Upstash dashboard for workflow execution logs
3. Verify `context.waitForEvent()` is being called with correct `eventId`
4. Check server logs for hook creation errors

### Signal Not Resuming Workflow

**Symptoms**: Signal sent but workflow doesn't continue

**Check**:
1. Verify token matches exactly (case-sensitive)
2. Check `client.notify()` is called with correct `eventId`
3. Verify `eventId` in `notify()` matches token in `waitForEvent()`
4. Check Upstash dashboard for event delivery status
5. Verify webhook endpoint is accessible from internet

### Worker Not Completing in Orchestration

**Symptoms**: Worker step hangs in orchestration

**Check**:
1. Verify worker webhook is called when job completes
2. Check `jobStore.updateJob()` calls `client.notify()` with `jobId` as `eventId`
3. Verify `context.waitForEvent(jobId)` matches the `eventId` used in `notify()`
4. Check job store (MongoDB or Upstash Redis) to see if job status is updated
5. Verify worker completes successfully outside orchestration

### Upstash API Errors

**Error**: `Invalid QStash token`

**Solution**:
1. Verify token from QStash dashboard (not Redis token)
2. Check token has correct permissions
3. Regenerate token if needed

**Error**: `Webhook delivery failed`

**Solution**:
1. Ensure your server is accessible from internet
2. Use ngrok or similar tool for local development
3. Verify webhook URL is correct
4. Check firewall/network settings

## Example: Complete Upstash Orchestration Test

### Step 1: Start Orchestration

```bash
curl -X POST http://localhost:3000/api/workflows/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "steps": [
        {
          "type": "agent",
          "agent": "/system/current_date",
          "id": "start",
          "input": { "format": "iso" }
        },
        {
          "type": "sleep",
          "duration": "1s"
        },
        {
          "type": "hook",
          "token": "test-approval:user123:complete-test"
        },
        {
          "type": "worker",
          "worker": "echo-worker",
          "input": { "message": "test message" },
          "id": "worker",
          "await": true
        },
        {
          "type": "agent",
          "agent": "/system/current_date",
          "id": "end",
          "input": { "format": "iso" }
        }
      ]
    },
    "input": {},
    "messages": []
  }'
```

Save the `runId` from response.

### Step 2: Check Status (Should be paused at hook)

```bash
curl "http://localhost:3000/api/workflows/orchestrate/{runId}"
```

Note the `hook.token` value.

### Step 3: Send Signal to Resume

```bash
curl -X POST http://localhost:3000/api/workflows/orchestrate/signal \
  -H "Content-Type: application/json" \
  -d '{
    "token": "test-approval:user123:complete-test",
    "payload": { "decision": "approve" }
  }'
```

### Step 4: Poll Status Until Complete

```bash
# Poll every 2-3 seconds
curl "http://localhost:3000/api/workflows/orchestrate/{runId}"
```

The workflow should:
1. Resume after signal
2. Dispatch worker
3. Wait for worker completion (via webhook + notify)
4. Continue to final agent step
5. Complete

## Differences from Vercel Workflows

| Feature | Vercel | Upstash |
|---------|--------|---------|
| **RunId Format** | `wrun_...` | Upstash-specific format |
| **Hook Implementation** | `workflow/api` `resumeHook()` | `context.waitForEvent()` + `client.notify()` |
| **Sleep** | `sleep()` from `workflow` | `context.sleep()` |
| **Parallel Steps** | Native workflow steps | `Promise.allSettled()` with `context.run()` |
| **Worker Await** | Polling with `sleep()` | `context.waitForEvent(jobId)` |
| **Observability** | Local `.next/workflow-data` | Upstash Dashboard |
| **Webhook Requirements** | Local only | Must be internet-accessible |

## Next Steps

1. **Test all step types**: agent, worker, hook, sleep, parallel, condition
2. **Test error scenarios**: worker failures, hook timeouts, network errors
3. **Monitor in Upstash dashboard**: Check execution logs and performance
4. **Test with MongoDB**: Verify persistent job storage works correctly
5. **Test production-like scenarios**: Multiple concurrent workflows, high load

## Additional Resources

- [Upstash Workflow Documentation](https://docs.upstash.com/qstash)
- [QStash API Reference](https://docs.upstash.com/qstash/api)
- [Workflow Architecture](./WORKFLOW_ARCHITECTURE.md)
- [Testing Guide](./TESTING_GUIDE.md)
