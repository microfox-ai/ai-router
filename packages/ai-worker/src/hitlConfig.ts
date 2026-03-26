import type { ZodType } from 'zod';

/**
 * UI rendering hint for a HITL step.
 *
 * - `'custom'` — render using a registered view component (by `viewId`).
 * - `'schema-form'` — auto-render a form for the step (no custom view needed).
 *   The panel falls back to a raw-JSON textarea if no schema-form renderer is available.
 */
export type HitlUiSpec =
  | {
      type: 'custom';
      /** View ID used to look up the renderer in the app's HITL view registry. */
      viewId: string;
      title?: string;
      sections?: Array<Record<string, unknown>>;
      [key: string]: unknown;
    }
  | {
      type: 'schema-form';
      title?: string;
      description?: string;
    };

/** Metadata for a human-in-the-loop step on `WorkerQueueStep.hitl`. */
export type HitlStepConfig = {
  taskKey: string;
  timeoutSeconds?: number;
  onTimeout?: 'reject' | 'auto-approve';
  assignees?: string[];
  ui: HitlUiSpec;
  /** Reviewer form schema — single source of truth; use `z.infer<typeof schema>` for types. */
  inputSchema?: ZodType;
};

/**
 * DX helper for queue authors: keeps HITL config typed/readable.
 *
 * @example
 * ```ts
 * const hitl = defineHitlConfig({
 *   taskKey: 'review-step',
 *   ui: { type: 'schema-form', title: 'Review the output' },
 *   inputSchema: z.object({ approved: z.boolean(), comment: z.string().optional() }),
 * });
 * ```
 */
export function defineHitlConfig<T extends HitlStepConfig>(config: T): T {
  return config;
}
