/**
 * Token budget tracking for workers.
 * Workers report usage via ctx.reportTokenUsage(); the runtime accumulates
 * and throws TokenBudgetExceededError when the limit is reached.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TokenBudgetState {
  inputTokens: number;
  outputTokens: number;
  /** null = no budget configured */
  budget: number | null;
}

export class TokenBudgetExceededError extends Error {
  public readonly used: number;
  public readonly budget: number;

  constructor(used: number, budget: number) {
    super(`Token budget exceeded: used ${used} tokens (budget: ${budget})`);
    this.name = 'TokenBudgetExceededError';
    this.used = used;
    this.budget = budget;
  }
}

export interface TokenTracker {
  report(usage: TokenUsage): void;
  getState(): TokenBudgetState;
  getBudgetInfo(): { used: number; budget: number | null; remaining: number | null };
}

export function createTokenTracker(budget: number | null): TokenTracker {
  let inputTokens = 0;
  let outputTokens = 0;

  function checkBudget(): void {
    if (budget !== null) {
      const total = inputTokens + outputTokens;
      if (total > budget) {
        throw new TokenBudgetExceededError(total, budget);
      }
    }
  }

  return {
    report(usage: TokenUsage): void {
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
      checkBudget();
    },
    getState(): TokenBudgetState {
      return { inputTokens, outputTokens, budget };
    },
    getBudgetInfo(): { used: number; budget: number | null; remaining: number | null } {
      const used = inputTokens + outputTokens;
      return {
        used,
        budget,
        remaining: budget !== null ? Math.max(0, budget - used) : null,
      };
    },
  };
}
