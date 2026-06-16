---
"@microfox/ai-worker-cli": minor
"@microfox/ai-worker": minor
---

Require auth on deployed worker endpoints.

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
