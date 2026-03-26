/**
 * Smart retry configuration for workers.
 * Retries execute in-process (same Lambda invocation) so error context is preserved
 * between attempts and the job remains in `running` state throughout.
 */

export interface RetryContext {
  /** Current attempt number (1-indexed). 2 = first retry, 3 = second retry, etc. */
  attempt: number;
  /** Total max attempts configured. */
  maxAttempts: number;
  /** Error from the previous attempt — use to self-correct (e.g. inject into prompt). */
  lastError: {
    message: string;
    name: string;
    stack?: string;
    /** HTTP status code or error code if present on the error object. */
    code?: string | number;
  };
}

export type BuiltInRetryPattern =
  | 'rate-limit'
  | 'json-parse'
  | 'overloaded'
  | 'server-error';

export interface CustomRetryPattern {
  /** Regex test against error.message, or a predicate receiving the full error object. */
  match: RegExp | ((err: Error & Record<string, any>) => boolean);
  /** Delay in ms before the retry. A function receives the retry attempt number (1 = first retry). */
  delayMs?: number | ((attempt: number) => number);
  /** When true, populates ctx.retryContext.lastError so the handler can self-correct. Built-ins set this per pattern. */
  injectContext?: boolean;
}

export type RetryPattern = BuiltInRetryPattern | CustomRetryPattern;

export interface SmartRetryConfig {
  /** Maximum total attempts, including the first (default: 3). */
  maxAttempts?: number;
  /** Error patterns that trigger a retry. Non-matching errors fail immediately. */
  on: RetryPattern[];
}

// ─── Built-in pattern implementations ────────────────────────────────────────

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
    delayMs: (attempt) => attempt * 10_000, // 10s, 20s, 30s…
    injectContext: false,
  },
  'json-parse': {
    match: (err) =>
      err.name === 'SyntaxError' ||
      err.name === 'ZodError' ||
      /json|parse|unexpected.?token|invalid.?format/i.test(err.message),
    delayMs: (_attempt) => 0, // Immediate — model self-corrects from ctx
    injectContext: true,
  },
  overloaded: {
    match: (err) =>
      /overloaded|model.?is.?busy/i.test(err.message) ||
      err.status === 529 ||
      err.code === 529,
    delayMs: (attempt) => attempt * 15_000, // 15s, 30s…
    injectContext: false,
  },
  'server-error': {
    match: (err) =>
      /internal.?server.?error|service.?unavailable|bad.?gateway/i.test(err.message) ||
      (typeof err.status === 'number' && err.status >= 500 && err.status < 600),
    delayMs: (attempt) => attempt * 5_000, // 5s, 10s…
    injectContext: false,
  },
};

// ─── Pattern matching ─────────────────────────────────────────────────────────

interface MatchResult {
  matched: boolean;
  delayMs: number;
  injectContext: boolean;
}

export function matchesRetryPattern(
  err: Error,
  patterns: RetryPattern[],
  /** 1-indexed retry number (1 = first retry, i.e. second execution). */
  attempt: number
): MatchResult {
  for (const pattern of patterns) {
    if (typeof pattern === 'string') {
      const impl = BUILT_IN_PATTERNS[pattern];
      if (impl.match(err as any)) {
        return { matched: true, delayMs: impl.delayMs(attempt), injectContext: impl.injectContext };
      }
    } else {
      let matched = false;
      if (pattern.match instanceof RegExp) {
        matched = pattern.match.test(err.message);
      } else {
        try {
          matched = pattern.match(err as any);
        } catch {
          matched = false;
        }
      }
      if (matched) {
        const delayMs =
          typeof pattern.delayMs === 'function'
            ? pattern.delayMs(attempt)
            : (pattern.delayMs ?? 0);
        return { matched: true, delayMs, injectContext: pattern.injectContext ?? false };
      }
    }
  }
  return { matched: false, delayMs: 0, injectContext: false };
}

// ─── Retry executor ───────────────────────────────────────────────────────────

/**
 * Executes `fn` with in-process smart retry.
 * `fn` receives `RetryContext | undefined` (undefined on first attempt).
 * `TokenBudgetExceededError` is never retried regardless of config.
 */
export async function executeWithRetry<T>(
  fn: (retryCtx: RetryContext | undefined) => Promise<T>,
  config: SmartRetryConfig,
  onRetry?: (retryCtx: RetryContext, delayMs: number) => void
): Promise<T> {
  const maxAttempts = config.maxAttempts ?? 3;
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

    try {
      return await fn(retryCtx);
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // TokenBudgetExceededError must never be retried.
      if (err?.name === 'TokenBudgetExceededError') throw err;

      if (attempt >= maxAttempts) throw err;

      const retryAttemptNumber = attempt; // 1 = first retry
      const { matched, delayMs } = matchesRetryPattern(lastError, config.on, retryAttemptNumber);
      if (!matched) throw err;

      const nextCtx: RetryContext = {
        attempt: attempt + 1,
        maxAttempts,
        lastError: {
          message: lastError.message,
          name: lastError.name,
          stack: lastError.stack,
          code: (lastError as any).code ?? (lastError as any).status,
        },
      };
      onRetry?.(nextCtx, delayMs);

      if (delayMs > 0) {
        await new Promise<void>((r) => setTimeout(r, delayMs));
      }
    }
  }

  throw lastError ?? new Error('executeWithRetry: unknown error');
}
