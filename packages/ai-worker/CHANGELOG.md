# @microfox/ai-worker

## 1.1.0

### Minor Changes

- d34c14b: Require auth on deployed worker endpoints.

  The CLI now resolves a stable secret at `push` time — precedence `WORKERS_API_KEY` →
  legacy `WORKERS_TRIGGER_API_KEY`/`WORKERS_CONFIG_API_KEY` → `sha256('microfox-workers:'+projectId)`
  — writes it into every generated `env.json`, and the generated `/workers/trigger`,
  `/workers/config`, and `/queues/{id}/start` handlers now **require** it using a constant-time
  `crypto.timingSafeEqual` comparison (also fixes SEC-9). When no secret resolves, deploy is public
  by default with a loud warning; `--require-auth` fails the build instead and `--allow-public`
  silences the warning. The `?debug=1` output on `/workers/config` is now gated behind a configured
  key.

  `@microfox/ai-worker` exports `resolveWorkersTriggerKey()`, `resolveWorkersConfigKey()`, and
  `deriveWorkersApiKey()`; the dispatch client and the example-app registry use them so callers send
  the matching key automatically. `ai-worker boilerplate` writes a random `WORKERS_API_KEY` into
  `.env` once so new projects are non-public by default.

  Also authenticate the consumer-app workflow routes (SEC-5). The boilerplate now gates every
  mutating route (worker/queue trigger, update, webhook, job, approve) on
  `authorizeWorkflowRequest()` — a user session (`getClientId`), the internal shared secret
  `WORKFLOW_INTERNAL_SECRET` (`x-workflow-secret`, sent by the runtime's `sendWebhook`), or an
  explicit `WORKFLOW_ALLOW_PUBLIC=true` dev opt-out — otherwise 401. The HITL `approve` handler now
  validates reviewer `input` against the step's `hitl.inputSchema` (new
  `getStepHitlInputSchema` registry helper) and dispatches the parsed value, closing the
  arbitrary-input-into-next-step hole. `WORKFLOW_INTERNAL_SECRET` falls back to `WORKERS_API_KEY`,
  so a single shared secret can gate both the deployed endpoints and the app callback routes.

  `ai-worker push` also honors a `MICROFOX_CLI_SPEC` env override (absolute path to a local
  microfox CLI entry, or an npm spec) instead of the hardcoded `npx microfox@latest`, for local
  end-to-end testing against a local cicd server.

### Patch Changes

- 9c6e36d: Changes from PR #65: ai-worker-complete-architecture-security

## 1.0.6

### Patch Changes

- 6d1bac8: Changes from PR #63: minor-fixes-may-2026

## 1.0.5

### Patch Changes

- 8243849: Changes from PR #59: ai-worker-hitl-and-smart-retry
- Updated dependencies [8243849]
  - @microfox/ai-router@2.1.6

## 1.0.4

### Patch Changes

- c4db3a9: Changes from PR #57: grouper-worker-projects

## 1.0.3

### Patch Changes

- d79d331: Changes from PR #55: ai-worker-wrapup-and-docs
- Updated dependencies [d79d331]
  - @microfox/ai-router@2.1.5

## 1.0.2

### Patch Changes

- ab4a506: Changes from PR #52: add_workers-dispatch-queue

## 1.0.1

### Patch Changes

- d108f28: Triggered by issue #41: release @microfox/ai-worker patch
- 8447252: Triggered by issue #47: release @microfox/ai-worker patch
- Updated dependencies [4d3a677]
  - @microfox/ai-router@2.1.3

## 0.1.1

### Patch Changes

- 973aac4: Changes from PR #38: ai-worker-and-cli
