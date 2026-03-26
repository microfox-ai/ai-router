/**
 * smart-demo agent — demonstrates Smart Retry + Token Budget for @microfox/ai-router.
 *
 * Sub-agents:
 *  /token-budget  — tracks token usage across several generateObject calls; enforces budget
 *  /smart-retry   — wraps a flaky handler with withRetry(); injects last error into prompt
 *  /json-extract  — combines both: retry on JSON parse error + token tracking
 *
 * Mount this router at `/smart-demo` in app/ai/index.ts.
 * Hit it via GET /api/studio/chat/agent/smart-demo/<sub-path>?<params>
 */

import { google } from '@ai-sdk/google';
import { AiRouter, withRetry } from '@microfox/ai-router';
import { generateObject } from 'ai';
import { z } from 'zod';
import dedent from 'dedent';

const aiRouter = new AiRouter();

// ─── /token-budget ────────────────────────────────────────────────────────────
// Demonstrates ctx.trackTokenUsage() and ctx.getTokenBudget().
// Runs `calls` sequential generateObject calls, tracking cumulative token usage.
// A TokenBudgetExceededError is thrown automatically if budget is exceeded.
//
// Example:
//   GET /api/studio/chat/agent/smart-demo/token-budget?topic=AI&calls=3
// Set maxTokens in handle() to enforce a budget:
//   router.handle('/smart-demo/token-budget', { request, maxTokens: 5000 })
const tokenBudgetAgent = new AiRouter()
  .agent('/', async (ctx) => {
    const topic = String(ctx.request.params.topic ?? 'artificial intelligence');
    const calls = Math.min(10, Math.max(1, Number(ctx.request.params.calls) || 3));

    ctx.logger.log(`[token-budget] Starting: ${calls} LLM call(s) on topic "${topic}"`);

    const perspectives: string[] = [];

    for (let i = 0; i < calls; i++) {
      // Real LLM call — usage is reported and accumulated in the per-request budget.
      const result = await generateObject({
        model: google('gemini-2.5-flash'),
        schema: z.object({
          angle: z.string().describe('A unique angle or sub-topic to explore'),
          insight: z.string().describe('A concise insight about that angle (2-3 sentences)'),
        }),
        prompt: dedent`
          You are an analyst. Give a unique perspective #${i + 1} on the topic: "${topic}".
          Previously covered angles: ${perspectives.join(', ') || 'none'}.
          Pick a fresh angle not already covered.
        `,
      });

      // Track this call's usage. Throws TokenBudgetExceededError if over budget.
      ctx.trackTokenUsage(result.usage);

      perspectives.push(result.object.angle);

      const budget = ctx.getTokenBudget();
      ctx.logger.log(`[token-budget] Call ${i + 1}/${calls} done`, {
        angle: result.object.angle,
        used: budget.used,
        remaining: budget.remaining ?? 'unlimited',
      });
    }

    const budget = ctx.getTokenBudget();

    return {
      topic,
      callsCompleted: calls,
      perspectives,
      tokenUsage: {
        used: budget.used,
        budget: budget.budget,
        remaining: budget.remaining,
      },
    };
  });

// ─── /smart-retry ─────────────────────────────────────────────────────────────
// Demonstrates withRetry() wrapping an agent handler.
// The handler produces a structured answer, but injects ctx.retryContext.lastError
// into the prompt on retry attempts — enabling the model to self-correct.
//
// Example:
//   GET /api/studio/chat/agent/smart-demo/smart-retry?prompt=Summarize+the+history+of+Rome
const smartRetryAgent = new AiRouter()
  .agent(
    '/',
    withRetry(
      async (ctx) => {
        const userPrompt = String(
          ctx.request.params.prompt ?? 'Explain how neural networks learn.',
        );
        const attempt = ctx.retryContext?.attempt ?? 1;

        // On retry: inject the previous error so the model knows what went wrong.
        const errorHint = ctx.retryContext
          ? dedent`

              ---
              IMPORTANT: Your previous attempt (attempt ${attempt - 1}) failed with this error:
              "${ctx.retryContext.lastError.message}"

              Correct the issue and produce a valid response this time.
            `
          : '';

        ctx.logger.log(`[smart-retry] Attempt ${attempt}`, {
          hasRetryContext: !!ctx.retryContext,
        });

        const result = await generateObject({
          model: google('gemini-2.5-flash'),
          schema: z.object({
            title: z.string().min(5).describe('A short title for the answer'),
            summary: z.string().min(20).describe('A concise 2-3 sentence summary'),
            keyPoints: z
              .array(z.string().min(10))
              .min(2)
              .max(5)
              .describe('2-5 key takeaway points'),
          }),
          prompt: dedent`
            ${userPrompt}
            ${errorHint}
          `,
        });

        // Track usage on each attempt.
        ctx.trackTokenUsage(result.usage);

        const budget = ctx.getTokenBudget();

        return {
          attempt,
          retriesNeeded: attempt - 1,
          ...result.object,
          tokenUsage: {
            used: budget.used,
            remaining: budget.remaining ?? 'unlimited',
          },
        };
      },
      {
        maxAttempts: 3,
        // Retry on rate limits (delay) and JSON/Zod parse errors (with error injection).
        on: ['rate-limit', 'json-parse'],
      },
    ),
  );

// ─── /json-extract ────────────────────────────────────────────────────────────
// Demonstrates smart retry on JSON parse failure AND token budget tracking together.
// Asks the model to extract structured data from freeform text. If the model
// returns malformed output (Zod validation fails → SyntaxError), withRetry retries
// and injects the parse error into the next prompt for self-correction.
//
// Example:
//   GET /api/studio/chat/agent/smart-demo/json-extract?text=Alice+is+30,+works+at+Acme+Corp
const jsonExtractAgent = new AiRouter()
  .agent(
    '/',
    withRetry(
      async (ctx) => {
        const text = String(
          ctx.request.params.text ?? 'Alice is 30 years old and works at Acme Corp as an engineer.',
        );
        const attempt = ctx.retryContext?.attempt ?? 1;

        const errorHint = ctx.retryContext
          ? dedent`

              ---
              Previous extraction attempt failed: "${ctx.retryContext.lastError.message}"
              Be strict about producing valid JSON matching the schema. Try again.
            `
          : '';

        ctx.logger.log(`[json-extract] Attempt ${attempt}`, { hasError: !!ctx.retryContext });

        const result = await generateObject({
          model: google('gemini-2.5-flash'),
          schema: z.object({
            name: z.string().describe('Full name of the person'),
            age: z.number().int().positive().describe('Age in years'),
            company: z.string().describe('Company or employer name'),
            role: z.string().describe('Job title or role'),
            confidence: z
              .number()
              .min(0)
              .max(1)
              .describe('Confidence score for this extraction (0–1)'),
          }),
          prompt: dedent`
            Extract structured person information from this text:
            "${text}"
            ${errorHint}
          `,
        });

        ctx.trackTokenUsage(result.usage);

        const budget = ctx.getTokenBudget();

        return {
          extracted: result.object,
          attempt,
          retriesNeeded: attempt - 1,
          tokenUsage: {
            used: budget.used,
            remaining: budget.remaining ?? 'unlimited',
          },
        };
      },
      {
        maxAttempts: 3,
        on: ['rate-limit', 'json-parse'],
      },
    ),
  );

// ─── Root agent — explains the three sub-agents ───────────────────────────────
export const smartDemoAgent = aiRouter
  .agent('/token-budget', tokenBudgetAgent)
  .agent('/smart-retry', smartRetryAgent)
  .agent('/json-extract', jsonExtractAgent)
  .agent('/', async (ctx) => {
    return {
      description: 'smart-demo: ai-router Smart Retry + Token Budget examples',
      subAgents: {
        '/smart-demo/token-budget':
          'Track token usage across multiple LLM calls with ctx.trackTokenUsage(). Set maxTokens in handle() to enforce a budget.',
        '/smart-demo/smart-retry':
          'Wrap a handler with withRetry({ on: [\'rate-limit\', \'json-parse\'] }). ctx.retryContext.lastError is injected into the prompt on retry.',
        '/smart-demo/json-extract':
          'Extract structured JSON with retry on parse failure + token budget tracking. Combines both features.',
      },
      params: {
        '/smart-demo/token-budget': { topic: 'string', calls: 'number (1–10)' },
        '/smart-demo/smart-retry': { prompt: 'string' },
        '/smart-demo/json-extract': { text: 'freeform text to extract person info from' },
      },
    };
  });
