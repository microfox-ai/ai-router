# Testing Orchestration Workflow

## Prerequisites

1. **Build the ai-router package** (if you made changes to orchestrate.ts):
   ```bash
   cd packages/ai-router
   npm run build
   ```

2. **Install dependencies** (if not already done):
   ```bash
   cd examples/root
   npm install
   ```

## Running the Test

1. **Start the development server**:
   ```bash
   cd examples/root
   npm run dev
   ```

2. **Navigate to the test page**:
   - Open your browser and go to: `http://localhost:3000/workflows`
   - Click on "Test Orchestration" button on the "Orchestration Workflow" card
   - Or directly navigate to: `http://localhost:3000/workflows/orchestrate`

## Test Steps

1. **Fill in the form**:
   - **Topic**: Enter any topic (e.g., "Test orchestration")
   - **User ID**: Enter any user ID (e.g., "user123")

2. **Start the workflow**:
   - Click "Start Orchestration Workflow"
   - You should see:
     - Status badge showing "Running"
     - Run ID displayed
     - Status updates in real-time (polling every 2 seconds)

3. **Observe the workflow execution**:
   - Step 1: Calls `/system/current_date` agent (should complete quickly)
   - Step 2: Sleeps for 2 seconds (status will be "Running")
   - Step 3: Waits for approval (status will change to "Paused" / "Waiting for Approval")
     - You'll see "Approve" and "Reject" buttons appear

4. **Approve the workflow**:
   - Click the "Approve" button when the workflow is paused
   - The workflow will continue
   - Step 4: Calls `/system/current_date` agent again
   - Status should change to "Completed"

5. **View the result**:
   - Once completed, you should see the workflow result displayed in JSON format
   - The result should include:
     - `context`: Contains all step outputs
     - `result`: The final result (last step output)

## Expected Workflow Steps

The test orchestration executes these steps in order:

1. **Agent Call**: `/system/current_date` with `{ format: 'iso', timezone: 'UTC' }`
   - Should return current date/time
   - Stored in context as `steps.date`

2. **Sleep**: 2 second delay
   - Workflow pauses for 2 seconds

3. **Hook**: Human-in-the-loop approval
   - Token: `orchestrate-approval:{userId}:{topic}`
   - Workflow pauses waiting for signal
   - Stored in context as `steps.approval`

4. **Agent Call**: `/system/current_date` again (after approval)
   - Should return current date/time
   - Stored in context as `steps.dateAfterApproval`

## Testing via API (Alternative)

You can also test directly via API:

### Start Orchestration:
```bash
curl -X POST http://localhost:3000/api/studio/workflow/orchestrate \
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
          "type": "sleep",
          "duration": "2s"
        },
        {
          "type": "hook",
          "token": "orchestrate-approval:user123:test"
        },
        {
          "type": "agent",
          "agent": "/system/current_date",
          "id": "dateAfterApproval",
          "input": { "format": "iso", "timezone": "UTC" }
        }
      ],
      "input": {
        "topic": "test",
        "userId": "user123"
      }
    }
  }'
```

Response:
```json
{
  "runId": "wrun_...",
  "status": "running"
}
```

### Check Status:
```bash
curl "http://localhost:3000/api/studio/workflow/status?runId=wrun_..."
```

### Signal Approval:
```bash
curl -X POST http://localhost:3000/api/studio/workflow/signal \
  -H "Content-Type: application/json" \
  -d '{
    "token": "orchestrate-approval:user123:test",
    "payload": { "decision": "approve", "timestamp": "2024-01-01T00:00:00Z" }
  }'
```

## Troubleshooting

### Build Errors
- If you get import errors for `@microfox/ai-router/workflow/orchestrate`, make sure you built the package:
  ```bash
  cd packages/ai-router && npm run build
  ```

### Workflow Not Starting
- Check browser console for errors
- Check server logs for errors
- Verify workflow package is installed: `npm list workflow`

### Agent Returns Empty
- The agent response extraction should handle this automatically
- Check the browser network tab to see the actual agent response
- Verify `/api/studio/chat/agent/system/current_date` works directly

### Hook Not Pausing
- Verify the token format matches exactly
- Check workflow observability web UI (if available)
- Check server logs for hook creation errors

## Workflow Observability

You can monitor workflows using the workflow CLI's web UI:

### First Time Setup

**Important**: The workflow data directory is created automatically when you run your first workflow. The error you see is normal if you haven't run any workflows yet.

1. **Start your dev server and run a workflow first**:
   ```bash
   npm run dev
   ```
   Then trigger a workflow via the UI or API (see steps above).

2. **After running at least one workflow**, the data directory will be created at:
   - `.next/workflow-data` (inside your project)

3. **Then you can inspect workflows**:
   ```bash
   npx workflow inspect runs --web
   ```
   This will open a web UI at `http://localhost:3000` (or the port specified) showing all workflow runs.

### Viewing Workflow Runs

Once workflows have run, you can:
- View all workflow runs in the web UI
- See step-by-step execution
- Check status, errors, and results
- Monitor hooks and their tokens

**Note**: The workflow data directory is created automatically when workflows execute. You don't need to create it manually.
