# Workflow Architecture - Implementation TODOs

Complete list of features that need to be implemented or improved.

## Registry & Auto-Discovery

### 1. Workflow Registry System
**Location:** `app/api/workflows/registry/workflows.ts`
**Status:** TODO
**Priority:** High

**Features:**
- [ ] `registerWorkflow(workflowId, definition, options?)` - Register workflows
- [ ] `getWorkflow(workflowId, version?)` - Lookup workflows
- [ ] `listWorkflows(options?)` - List all workflows
- [ ] Auto-discovery: `scanWorkflows()` - Scan `app/workflows/**/*.ts`
- [ ] Support versioning (multiple versions per workflow)
- [ ] Persistent storage (Redis/Upstash, Supabase, or in-memory for dev)

**Implementation Notes:**
- Use glob to find workflow files
- Extract workflow from `defineWorkflow()` helper (when implemented)
- Cache discovered workflows
- Support hot-reload in development

### 2. Worker Registry System
**Location:** `app/api/workflows/registry/workers.ts`
**Status:** TODO
**Priority:** High

**Features:**
- [ ] `registerWorker(workerId, worker)` - Register workers
- [ ] `getWorker(workerId)` - Lookup workers
- [ ] `listWorkers()` - List all workers
- [ ] Auto-discovery: `scanWorkers()` - Scan `app/ai/**/*.worker.ts`
- [ ] Dynamic worker loading on-demand
- [ ] Worker validation (must have id, dispatch, handler)

**Implementation Notes:**
- Use glob to find `*.worker.ts` files
- Extract worker from exported default or named export
- Support common patterns: `app/ai/agents/${workerId}/${workerId}.worker.ts`
- Cache discovered workers

## Workflow Status & Lookup

### 3. Workflow Status Lookup (GET endpoint)
**Location:** `app/api/workflows/[...slug]/route.ts` (GET handler)
**Status:** Placeholder
**Priority:** High

**Current State:** Returns error - needs workflow definition

**Implementation:**
- [ ] Lookup workflow definition from registry (for registered workflows)
- [ ] Construct agent workflow definition (for agent paths)
- [ ] Call `adapter.getWorkflowStatus(definition, runId)`
- [ ] Return normalized status response
- [ ] Handle 404 when workflow or runId not found

### 4. Agent Workflows via Upstash
**Location:** `app/api/workflows/[...slug]/route.ts` (POST handler)
**Status:** Not implemented
**Priority:** Medium

**Current State:** Returns error for agent workflows when provider is 'upstash'

**Implementation:**
- [ ] Create Upstash workflow endpoint for agent execution
- [ ] Option 1: Create `app/api/workflows/agents/[...slug]/upstash/route.ts`
- [ ] Option 2: Use `context.call` in Upstash orchestration to directly call agent API
- [ ] Register dynamic endpoint or use pattern-based routing
- [ ] Support both blocking and fire-and-forget modes

## Worker Integration

### 5. Worker Await Mode (Blocking)
**Location:** `app/api/workflows/workflows/steps.ts` (`callWorkerStep`)
**Status:** Simplified implementation
**Priority:** High

**Current State:** Returns job info, doesn't actually wait for result

**Implementation:**
- [ ] Create webhook handler: `/api/workflows/workers/:workerId/webhook`
- [ ] Implement job store: `app/api/workflows/stores/jobStore.ts`
- [ ] Webhook handler stores result in job store
- [ ] Poll job store or use event system (Redis pub/sub, EventBridge)
- [ ] For Upstash: Use `context.waitForEvent` with jobId as eventId
- [ ] For Vercel: Poll job store with exponential backoff
- [ ] Timeout handling (fail after max wait time)

### 6. Worker Status Lookup (GET endpoint)
**Location:** `app/api/workflows/workers/[...slug]/route.ts` (GET handler)
**Status:** Placeholder
**Priority:** Medium

**Current State:** Returns placeholder response

**Implementation:**
- [ ] Implement job store: `app/api/workflows/stores/jobStore.ts`
- [ ] Query job store: `const job = await jobStore.get(jobId)`
- [ ] Return job status: `{ jobId, workerId, status, output?, error? }`
- [ ] Handle not found (404)
- [ ] Support job expiration/cleanup

### 7. Worker Webhook Handler
**Location:** `app/api/workflows/workers/[...slug]/webhook/route.ts`
**Status:** TODO
**Priority:** High

**Features:**
- [ ] Receive worker completion notifications
- [ ] Validate webhook (optional: signature/auth)
- [ ] Store result in job store
- [ ] Publish event for Upstash workflow await mode
- [ ] Handle duplicate webhooks (idempotency)
- [ ] Support both success and error notifications

## Orchestration DSL

### 8. Workflow Step Type
**Location:** `packages/ai-router/src/workflow/orchestrate.ts`
**Status:** TODO
**Priority:** Medium

**Features:**
- [ ] Add `WorkflowStep` interface: `{ type: 'workflow', workflow: string, input?, await?, id? }`
- [ ] Add `.workflow()` method to `OrchestrationBuilder`
- [ ] Implement workflow step execution in `orchestrateWorkflow.ts`
- [ ] Support calling registered workflows by ID
- [ ] Support calling agent workflows by path
- [ ] Support both blocking and fire-and-forget modes

**Example:**
```typescript
createOrchestration()
  .agent('/validate')
  .workflow('my-workflow', (ctx) => ctx.previous)
  .workflow('/agent/path', { input: '...' }, { await: false })
```

### 9. Hook Timeout Configuration
**Location:** `packages/ai-router/src/workflow/orchestrate.ts` & orchestration execution
**Status:** Hardcoded
**Priority:** Low

**Current State:** Hook timeout is hardcoded to '7d'

**Implementation:**
- [ ] Add `hookTimeout` to `OrchestrationConfig`
- [ ] Support per-hook timeout in `HookStep`
- [ ] Use configured timeout in orchestration execution
- [ ] Default to '7d' if not specified

### 10. Parallel Step Error Handling
**Location:** `app/api/workflows/workflows/orchestrateWorkflow.ts` (parallel case)
**Status:** Basic implementation
**Priority:** Medium

**Current State:** Uses `Promise.all()` which fails fast

**Implementation:**
- [ ] Use `Promise.allSettled()` to collect all results/errors
- [ ] Decide on failure strategy: fail-fast vs continue-on-error
- [ ] Merge errors into context: `context.errors = [...]`
- [ ] Support partial success handling
- [ ] For Upstash: Proper context isolation for parallel branches

### 11. Step Error Recovery/Retry
**Location:** Orchestration execution
**Status:** Not implemented
**Priority:** Low

**Features:**
- [ ] Retry step on failure (with max retries)
- [ ] Retry with exponential backoff
- [ ] Conditional retry based on error type
- [ ] Continue-on-error vs fail-fast strategies
- [ ] Retry configuration: `{ retries: 3, backoff: 'exponential' }`

### 12. Step Timeout Configuration
**Location:** `packages/ai-router/src/workflow/orchestrate.ts`
**Status:** Not implemented
**Priority:** Low

**Features:**
- [ ] Add per-step timeout: `{ timeout: '5m' }`
- [ ] Add global timeout: `{ timeout: '30m' }` in `OrchestrationConfig`
- [ ] Enforce timeout in step execution
- [ ] Fail step if timeout exceeded

### 13. Step Result Validation
**Location:** Orchestration execution
**Status:** Not implemented
**Priority:** Low

**Features:**
- [ ] Validate step output against expected schema
- [ ] Fail fast if validation fails
- [ ] Option to continue with validation errors (warning mode)
- [ ] Add validation config to step definition

## Type Safety & Developer Experience

### 14. defineWorkflow Helper
**Location:** `packages/ai-router/src/workflow/helpers.ts`
**Status:** TODO
**Priority:** Medium

**Features:**
- [ ] `defineWorkflow()` function for simplified workflow definition
- [ ] Auto-type inference from Zod schemas
- [ ] Provider detection from handler or explicit specification
- [ ] Optional auto-registration with registry
- [ ] Type-safe handler function

**Example:**
```typescript
export default defineWorkflow({
  id: 'my-workflow',
  input: z.object({ data: z.string() }),
  output: z.object({ result: z.string() }),
  handler: async (input) => {
    "use workflow";
    return { result: input.data };
  }
});
```

### 15. Type-Safe Worker Calls in Orchestration
**Location:** Orchestration DSL
**Status:** Basic implementation
**Priority:** Low

**Features:**
- [ ] Type inference from worker input/output schemas
- [ ] Type-safe worker ID references
- [ ] Autocomplete for available workers
- [ ] Validation of worker input in orchestration

## Hook/Webhook Improvements

### 16. Hook Token Extraction from Status
**Location:** Adapters (`getWorkflowStatus`)
**Status:** Partial implementation
**Priority:** Medium

**Vercel Adapter:**
- [ ] Extract hook token from run object if available
- [ ] Check `run.hookToken` or `run.waitingForToken`
- [ ] Fallback to empty token (current behavior)

**Upstash Adapter:**
- [ ] Improve event ID extraction from step logs
- [ ] Support different Upstash step log formats
- [ ] Extract from step input if available
- [ ] Handle multiple waiting steps

## Error Handling & Monitoring

### 17. Step-Level Error Handling
**Location:** `app/api/workflows/workflows/orchestrateWorkflow.ts`
**Status:** Not implemented
**Priority:** Medium

**Features:**
- [ ] Wrap each step in try-catch
- [ ] Support continue-on-error vs fail-fast
- [ ] Collect errors in `context.errors` array
- [ ] Preserve step output even on error (optional)
- [ ] Error context: step ID, step type, input, error

### 18. Step Execution Metrics
**Location:** Orchestration execution
**Status:** Not implemented
**Priority:** Low

**Features:**
- [ ] Track step start/end time
- [ ] Store metrics in `context.metrics`
- [ ] Export metrics for monitoring
- [ ] Step duration tracking
- [ ] Success/failure rate per step

### 19. Workflow Execution History
**Location:** Workflow runtime
**Status:** Not implemented
**Priority:** Low

**Features:**
- [ ] Store workflow execution history
- [ ] Track step execution order
- [ ] Store inputs/outputs for each step
- [ ] Support querying execution history
- [ ] Cleanup old executions (TTL)

## Configuration & Setup

### 20. Config Initialization Improvements
**Location:** `app/api/workflows/adapters/index.ts`
**Status:** Basic implementation
**Priority:** Low

**Features:**
- [ ] Support lazy initialization (only when needed)
- [ ] Support config reload in development (hot reload)
- [ ] Better error handling and logging
- [ ] Support multiple config sources (file, env, API)
- [ ] Config validation on initialization

## Testing & Development

### 21. Workflow Testing Utilities
**Location:** Package utilities
**Status:** Not implemented
**Priority:** Low

**Features:**
- [ ] Mock workflow runtime for testing
- [ ] Test orchestration configs without executing
- [ ] Validate workflow definitions
- [ ] Test step execution in isolation
- [ ] Mock adapters for unit testing

## Summary

### High Priority (Core Functionality)
1. Workflow Registry System
2. Worker Registry System with Auto-Discovery
3. Workflow Status Lookup
4. Worker Await Mode (Blocking)
5. Worker Webhook Handler
6. Job Store Implementation

### Medium Priority (Enhanced Functionality)
7. Agent Workflows via Upstash
8. Worker Status Lookup
9. Workflow Step Type
10. Hook Token Extraction from Status
11. Step-Level Error Handling
12. defineWorkflow Helper

### Low Priority (Nice-to-Have)
13. Hook Timeout Configuration
14. Parallel Step Error Handling
15. Step Error Recovery/Retry
16. Step Timeout Configuration
17. Step Result Validation
18. Type-Safe Worker Calls
19. Step Execution Metrics
20. Workflow Execution History
21. Config Initialization Improvements
22. Workflow Testing Utilities
