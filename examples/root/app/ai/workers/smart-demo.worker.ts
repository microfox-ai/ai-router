/**
 * Smart Demo Worker — demonstrates Smart Retry + Token Budget features.
 *
 * Modes:
 * - 'token-budget': Simulates LLM calls with ctx.reportTokenUsage(). Respects maxTokens budget.
 * - 'smart-retry': Simulates flaky LLM responses that need retry. Uses ctx.retryContext to
 *    self-correct on retry (inject the previous error into the prompt).
 * - 'json-extract': Combines both — extracts JSON with retry on parse error + token tracking.
 */

import { createWorker } from '@microfox/ai-worker';
import { z } from 'zod';

const inputSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('token-budget'),
    /** Number of simulated LLM calls to make (each uses ~1000 tokens). */
    calls: z.number().min(1).max(20).default(3),
  }),
  z.object({
    mode: z.literal('smart-retry'),
    /** How many attempts to simulate failure before succeeding (1 = always fails). */
    failUntilAttempt: z.number().min(1).max(5).default(2),
    prompt: z.string().default('Extract a valid JSON object from the response.'),
  }),
  z.object({
    mode: z.literal('json-extract'),
    rawText: z.string(),
  }),
]);

const outputSchema = z.object({
  mode: z.string(),
  success: z.boolean(),
  result: z.unknown().optional(),
  tokenUsage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
  retryAttempts: z.number().optional(),
  message: z.string(),
});

export const workerConfig = {
  timeout: 120,
  memorySize: 256,
  group: 'test',
};

export default createWorker({
  id: 'smart-demo',
  inputSchema,
  outputSchema,

  // Worker-level retry: applies to ALL modes. Queue step retry would override this per step.
  retry: {
    maxAttempts: 3,
    on: ['rate-limit', 'json-parse'],
  },

  handler: async ({ input, ctx }) => {
    const { mode } = input;

    // ── Token Budget Demo ──────────────────────────────────────────────────────
    if (mode === 'token-budget') {
      const { calls } = input;
      let totalInput = 0;
      let totalOutput = 0;

      ctx.logger.info(`Starting token-budget demo: ${calls} simulated LLM calls`);

      for (let i = 0; i < calls; i++) {
        // Simulate an LLM call (replace with real anthropic/google/openai call).
        const simulatedUsage = {
          inputTokens: 500 + Math.floor(Math.random() * 500),
          outputTokens: 200 + Math.floor(Math.random() * 300),
        };

        // Report usage — throws TokenBudgetExceededError if over the configured maxTokens.
        await ctx.reportTokenUsage(simulatedUsage);

        totalInput += simulatedUsage.inputTokens;
        totalOutput += simulatedUsage.outputTokens;

        const budget = ctx.getTokenBudget();
        ctx.logger.info(`Call ${i + 1}/${calls} done`, {
          used: budget.used,
          remaining: budget.remaining ?? 'unlimited',
        });

        await ctx.jobStore?.update({
          progress: Math.round(((i + 1) / calls) * 100),
          progressMessage: `LLM call ${i + 1}/${calls} — ${budget.used} tokens used`,
        });
      }

      return {
        mode,
        success: true,
        tokenUsage: { inputTokens: totalInput, outputTokens: totalOutput },
        message: `Completed ${calls} simulated LLM calls without exceeding budget.`,
      };
    }

    // ── Smart Retry Demo ───────────────────────────────────────────────────────
    if (mode === 'smart-retry') {
      const { failUntilAttempt, prompt } = input;
      const attempt = ctx.retryContext?.attempt ?? 1;

      ctx.logger.info(`Smart-retry demo: attempt ${attempt}`, {
        failUntilAttempt,
        hasRetryContext: !!ctx.retryContext,
      });

      // Inject previous error into prompt when retrying (self-correction pattern).
      const errorHint = ctx.retryContext
        ? `\n\n[IMPORTANT] Previous attempt failed with: "${ctx.retryContext.lastError.message}". Fix the response.`
        : '';

      const fullPrompt = prompt + errorHint;
      ctx.logger.info(`Prompt: ${fullPrompt.slice(0, 100)}...`);

      // Simulate: fail with a JSON parse error until we reach `failUntilAttempt`.
      if (attempt < failUntilAttempt) {
        // This SyntaxError matches the 'json-parse' built-in retry pattern.
        throw new SyntaxError(
          `Unexpected token 'T' in simulated LLM response (attempt ${attempt}). ` +
          `The model returned plain text instead of JSON. Error hint injected for attempt ${attempt + 1}.`
        );
      }

      // Success on the right attempt.
      const result = { answer: 'This is the corrected JSON response', attempt };

      // Track token usage.
      await ctx.reportTokenUsage({ inputTokens: 350 + attempt * 50, outputTokens: 120 });

      return {
        mode,
        success: true,
        result,
        retryAttempts: attempt - 1, // how many retries were needed
        message: `Succeeded on attempt ${attempt} after ${attempt - 1} retries.`,
      };
    }

    // ── JSON Extract (combines retry + token budget) ───────────────────────────
    if (mode === 'json-extract') {
      const { rawText } = input;
      const attempt = ctx.retryContext?.attempt ?? 1;

      // Inject prior error context into the extraction prompt.
      const errorHint = ctx.retryContext
        ? `\nPrevious extraction failed: "${ctx.retryContext.lastError.message}". Be strict about JSON output only.`
        : '';

      ctx.logger.info(`json-extract: attempt ${attempt}`, { errorHint: !!errorHint });

      // Simulate an extraction LLM call.
      const simulatedUsage = { inputTokens: 300 + attempt * 100, outputTokens: 150 };
      await ctx.reportTokenUsage(simulatedUsage);

      // Attempt to parse (real usage: call an LLM and JSON.parse the response).
      let extracted: unknown;
      try {
        // Try to find a JSON block in the raw text.
        const jsonMatch = rawText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (!jsonMatch) {
          throw new SyntaxError(
            `No JSON found in text: "${rawText.slice(0, 80)}". ` +
            (errorHint ? `Retry context: ${errorHint}` : 'Will retry.')
          );
        }
        extracted = JSON.parse(jsonMatch[0]);
      } catch (err: any) {
        // SyntaxError matches the 'json-parse' pattern and triggers retry.
        throw err;
      }

      return {
        mode,
        success: true,
        result: extracted,
        tokenUsage: simulatedUsage,
        retryAttempts: attempt - 1,
        message: `JSON extracted successfully on attempt ${attempt}.`,
      };
    }

    // TypeScript exhaustive check.
    return { mode: (input as any).mode, success: false, message: 'Unknown mode.' };
  },
});
