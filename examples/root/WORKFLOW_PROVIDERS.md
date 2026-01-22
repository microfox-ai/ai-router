# Workflow Provider Configuration

ai-router supports multiple workflow runtime providers. You can choose between **Vercel `workflow`** (useworkflow.dev) and **Upstash Workflow** for executing orchestration workflows.

## Quick Start

### 1. Set Environment Variable

Set `WORKFLOW_PROVIDER` in your `.env.local` or deployment environment:

```bash
# For Vercel workflow (default)
WORKFLOW_PROVIDER=vercel

# For Upstash Workflow
WORKFLOW_PROVIDER=upstash
```

### 2. Install Required Dependencies

**For Vercel workflow:**
```bash
npm install workflow@^4.0.1-beta.35
```

**For Upstash Workflow:**
```bash
npm install @upstash/workflow @upstash/qstash
```

And set Upstash environment variables:
```bash
QSTASH_TOKEN=your_qstash_token
QSTASH_URL=https://qstash.upstash.io/v2/publish
QSTASH_CURRENT_SIGNING_KEY=your_signing_key
QSTASH_NEXT_SIGNING_KEY=your_next_signing_key  # Optional, for key rotation
```

### 3. Use the Same Orchestration DSL

The orchestration DSL is provider-agnostic. Define your workflow once:

```typescript
import { createOrchestration } from '@microfox/ai-router/workflow/orchestrate';

const onboardingFlow = createOrchestration()
  .agent('/onboarding/collectProfile', undefined, { id: 'collectProfile' })
  .sleep('1d')
  .agent('/onboarding/checkActivation', ctx => ctx.steps.collectProfile, { id: 'check' })
  .condition(
    ctx => ctx.steps.check?.activated === true,
    [
      // then steps
      createOrchestration().agent('/onboarding/sendWelcome').build().steps
    ],
    [
      // else steps
      createOrchestration().agent('/onboarding/sendReminder').build().steps
    ]
  )
  .build();
```

Then call it via the studio API - it will automatically use your configured provider:

```typescript
const response = await fetch('/api/studio/workflow/orchestrate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    config: onboardingFlow,
    input: { userId: '123' },
  }),
});

const { runId, status } = await response.json();
```

## Provider Comparison

| Feature | Vercel `workflow` | Upstash Workflow |
|---------|------------------|------------------|
| **Max Duration** | 60s (Hobby) / 5min (Pro) / 15min (Enterprise) per step | **Unlimited** (can run for days/weeks) |
| **Cost Model** | Pay for execution time | Pay per step/message |
| **Sleep/Wait** | Function stays running (pays for time) | Function shuts down ($0 while waiting) |
| **Long-running Tasks** | Limited by function timeout | Unlimited via `context.call` + `waitForEvent` |
| **Human-in-the-Loop** | `defineHook().create()` | `context.waitForEvent()` |
| **Best For** | Fast, synchronous workflows | Long-running, multi-day workflows |

## Architecture

### Package (`@microfox/ai-router`)

The package exports only **generic contracts**:
- `WorkflowDefinition<Input, Output>` - Provider-neutral workflow shape
- `WorkflowRuntimeAdapter` - Interface for adapters
- `WorkflowRuntimeStartResult`, `WorkflowRuntimeStatusResult` - Normalized result types
- `OrchestrationConfig`, `OrchestrationStep` - DSL types

### Project Boilerplate (`examples/root/app/api/studio/workflow/adapters/`)

Provider-specific implementations live in your project:

- **`vercelAdapter.ts`** - Implements `WorkflowRuntimeAdapter` using `workflow/api`
- **`upstashAdapter.ts`** - Implements `WorkflowRuntimeAdapter` using `@upstash/workflow` Client
- **`helpers.ts`** - `createVercelWorkflow()` and `createUpstashWorkflow()` helpers
- **`config.ts`** - `getWorkflowProvider()` reads `WORKFLOW_PROVIDER` env var

### Workflow Routes

- **Vercel**: Uses `orchestrateWorkflowFn` with `"use workflow"` directive
- **Upstash**: Uses `app/api/workflow/upstash/orchestrate/route.ts` with `serve()` wrapper

## Switching Providers

Simply change the `WORKFLOW_PROVIDER` environment variable and restart your app. The same orchestration DSL will run on the selected provider without code changes.

## Example: Same Workflow, Different Providers

```typescript
// This orchestration works with BOTH providers
const dripCampaign = createOrchestration()
  .agent('/email/sendWelcome')
  .sleep('1d')
  .agent('/email/checkOpenRate', ctx => ({ emailId: ctx.steps.sendWelcome?.id }))
  .condition(
    ctx => ctx.steps.checkOpenRate?.opened === false,
    [
      // Send reminder if not opened
      createOrchestration()
        .agent('/email/sendReminder')
        .build()
        .steps
    ]
  )
  .build();

// Call it - provider is selected automatically via WORKFLOW_PROVIDER
await fetch('/api/studio/workflow/orchestrate', {
  method: 'POST',
  body: JSON.stringify({ config: dripCampaign, input: { email: 'user@example.com' } }),
});
```

**With Vercel**: Runs on Vercel's serverless functions (fast, but limited by timeout).

**With Upstash**: Runs via QStash (can sleep for days, costs $0 while waiting).
