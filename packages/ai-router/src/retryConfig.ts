/**
 * Smart retry for ai-router agents.
 * Use withRetry(handler, config) to wrap any agent handler.
 */

import type { AiHandler } from './router.js';

export interface RetryContext {
  /** Current attempt number (1-indexed). 2 = first retry. */
  attempt: number;
  maxAttempts: number;
  lastError: {
    message: string;
    name: string;
    stack?: string;
    code?: string | number;
  };
}

export type BuiltInRetryPattern =
  | 'rate-limit'
  | 'json-parse'
  | 'overloaded'
  | 'server-error';

export interface CustomRetryPattern {
  match: RegExp | ((err: Error & Record<string, any>) => boolean);
  delayMs?: number | ((attempt: number) => number);
  injectContext?: boolean;
}

export type RetryPattern = BuiltInRetryPattern | CustomRetryPattern;

export interface SmartRetryConfig {
  maxAttempts?: number;
  on: RetryPattern[];
}

type PatternImpl = {
  match: (err: Error & Record<string, any>) => boolean;
  delayMs: (attempt: number) => number;
  injectContext: boolean;
};

const BUILT_IN_PATTERNS: Record<BuiltInRetryPattern, PatternImpl> = {
  'rate-limit': {
    match: (err) =>
      /rate.?limit|too.?many.?requests/i.test(err.message) ||
      err.status === 429 ||
      err.code === 429 ||
      err.name === 'RateLimitError',
    delayMs: (attempt) => attempt * 10_000,
    injectContext: false,
  },
  'json-parse': {
    match: (err) =>
      err.name === 'SyntaxError' ||
      err.name === 'ZodError' ||
      /json|parse|unexpected.?token|invalid.?format/i.test(err.message),
    delayMs: (_) => 0,
    injectContext: true,
  },
  overloaded: {
    match: (err) =>
      /overloaded|model.?is.?busy/i.test(err.message) ||
      err.status === 529 ||
      err.code === 529,
    delayMs: (attempt) => attempt * 15_000,
    injectContext: false,
  },
  'server-error': {
    match: (err) =>
      /internal.?server.?error|service.?unavailable|bad.?gateway/i.test(err.message) ||
      (typeof err.status === 'number' && err.status >= 500 && err.status < 600),
    delayMs: (attempt) => attempt * 5_000,
    injectContext: false,
  },
};

function matchPattern(
  err: Error,
  patterns: RetryPattern[],
  attempt: number
): { matched: boolean; delayMs: number } {
  for (const pattern of patterns) {
    if (typeof pattern === 'string') {
      const impl = BUILT_IN_PATTERNS[pattern];
      if (impl.match(err as any)) {
        return { matched: true, delayMs: impl.delayMs(attempt) };
      }
    } else {
      let matched = false;
      if (pattern.match instanceof RegExp) {
        matched = pattern.match.test(err.message);
      } else {
        try { matched = pattern.match(err as any); } catch { matched = false; }
      }
      if (matched) {
        const delayMs = typeof pattern.delayMs === 'function'
          ? pattern.delayMs(attempt)
          : (pattern.delayMs ?? 0);
        return { matched: true, delayMs };
      }
    }
  }
  return { matched: false, delayMs: 0 };
}

/**
 * Wraps an agent handler with smart retry logic.
 * `ctx.retryContext` is populated on retry attempts so the handler can self-correct.
 *
 * @example
 * ```ts
 * router.agent('/', withRetry(myAgent, {
 *   maxAttempts: 3,
 *   on: ['rate-limit', 'json-parse'],
 * }));
 * ```
 */
export function withRetry<
  METADATA extends Record<string, any> = Record<string, any>,
  ContextState extends Record<string, any> = Record<string, any>,
  PARAMS extends Record<string, any> = Record<string, any>,
>(
  handler: AiHandler<METADATA, ContextState, PARAMS>,
  config: SmartRetryConfig
): AiHandler<METADATA, ContextState, PARAMS> {
  const maxAttempts = config.maxAttempts ?? 3;

  return async (ctx) => {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const retryCtx: RetryContext | undefined =
        attempt > 1 && lastError
          ? {
              attempt,
              maxAttempts,
              lastError: {
                message: lastError.message,
                name: lastError.name,
                stack: lastError.stack,
                code: (lastError as any).code ?? (lastError as any).status,
              },
            }
          : undefined;

      (ctx as any).retryContext = retryCtx;

      try {
        return await handler(ctx);
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // TokenBudgetExceededError and MaxCallDepthExceededError are never retried.
        if (err?.name === 'TokenBudgetExceededError' || err?.name === 'MaxCallDepthExceededError') {
          throw err;
        }

        if (attempt >= maxAttempts) throw err;

        const { matched, delayMs } = matchPattern(lastError, config.on, attempt);
        if (!matched) throw err;

        ctx.logger.warn(
          `[retry] Attempt ${attempt}/${maxAttempts} failed: ${lastError.message}. Retrying in ${delayMs}ms.`
        );

        if (delayMs > 0) {
          await new Promise<void>((r) => setTimeout(r, delayMs));
        }
      }
    }

    throw lastError ?? new Error('withRetry: unknown error');
  };
}
