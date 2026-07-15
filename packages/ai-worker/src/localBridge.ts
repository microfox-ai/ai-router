/**
 * Local dispatch bridge — the seam the `ai-worker dev` server uses to intercept
 * worker-to-worker dispatch (and queue next-step sends) instead of SQS.
 *
 * Production safety: the bridge is only honored when BOTH conditions hold —
 * `process.env.AI_WORKER_LOCAL === '1'` AND a bridge object was installed on
 * `globalThis`. Nothing in a deployed Lambda sets either, so this path is
 * impossible to trip in production and adds zero dependencies.
 */

import type { SQSMessageBody } from './handler.js';

export interface LocalDispatchBridge {
  /**
   * Hand a would-be SQS message to the local dev queue.
   * `delaySeconds` mirrors SQS DelaySeconds semantics (already clamped to 0–900 by the caller).
   * Must return a message id (used in place of the SQS MessageId).
   */
  enqueue(
    workerId: string,
    messageBody: SQSMessageBody,
    delaySeconds?: number
  ): Promise<{ messageId: string }> | { messageId: string };
}

const BRIDGE_GLOBAL_KEY = '__AI_WORKER_LOCAL_BRIDGE__';

/** Install the bridge (called by the dev server before any worker code runs). */
export function setLocalDispatchBridge(bridge: LocalDispatchBridge | undefined): void {
  (globalThis as Record<string, unknown>)[BRIDGE_GLOBAL_KEY] = bridge;
}

/**
 * Returns the installed bridge, or undefined unless BOTH the env flag and the
 * global are set (see module doc). Checked on every dispatch — cheap (two lookups).
 */
export function getLocalDispatchBridge(): LocalDispatchBridge | undefined {
  if (process.env.AI_WORKER_LOCAL !== '1') return undefined;
  const bridge = (globalThis as Record<string, unknown>)[BRIDGE_GLOBAL_KEY] as
    | LocalDispatchBridge
    | undefined;
  return bridge && typeof bridge.enqueue === 'function' ? bridge : undefined;
}
