import type { ChainContext } from './queue.js';

/**
 * Built-in chain mapping: pass the previous step's output directly as the next step's input.
 * Falls back to `initialInput` if there are no previous outputs.
 *
 * Use via `chain: 'passthrough'` on a queue step — no need to reference this directly.
 */
export function defaultMapChainPassthrough(ctx: ChainContext): unknown {
  const { initialInput, previousOutputs } = ctx;
  if (previousOutputs.length > 0) {
    return previousOutputs[previousOutputs.length - 1]?.output;
  }
  return initialInput;
}

/**
 * Built-in chain mapping for same-worker "continue" rounds.
 * Maps `{ current, history, ... }` from the last step output into
 * `{ mode: 'continue', current, history, nextNumber: 0, operator: 'add' }`.
 *
 * Use via `chain: 'continueFromPrevious'` on a queue step.
 */
export function defaultMapChainContinueFromPrevious(ctx: ChainContext): unknown {
  const { previousOutputs } = ctx;
  const prev = previousOutputs[previousOutputs.length - 1]?.output as {
    current?: number;
    history?: string[];
  } | null;
  if (!prev || typeof prev.current !== 'number') {
    return {
      mode: 'continue' as const,
      current: 0,
      history: [] as string[],
      nextNumber: 0,
      operator: 'add' as const,
    };
  }
  return {
    mode: 'continue' as const,
    current: prev.current,
    history: prev.history ?? [],
    nextNumber: 0,
    operator: 'add' as const,
  };
}
