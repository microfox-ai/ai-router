import type { HitlViewRenderer } from '@/components/hitl/types';
import { CalculatorHitlV1View } from '@/components/hitl/views/calculator-hitl-v1';

const HITL_VIEW_REGISTRY = new Map<string, HitlViewRenderer>();

/**
 * Register a custom HITL view renderer for a given `viewId`.
 * Call this at module load time to make the view available to HitlTaskPanel.
 *
 * @example
 * ```ts
 * // In your view file or a barrel:
 * registerHitlView('my-review-view', MyReviewComponent);
 * ```
 */
export function registerHitlView(viewId: string, renderer: HitlViewRenderer): void {
  HITL_VIEW_REGISTRY.set(viewId, renderer);
}

// Register built-in example views.
registerHitlView('calculator-hitl-v1', CalculatorHitlV1View);

export function getHitlViewRenderer(viewId?: string): HitlViewRenderer | null {
  if (!viewId) return null;
  return HITL_VIEW_REGISTRY.get(viewId) ?? null;
}

export function listHitlViewIds(): string[] {
  return Array.from(HITL_VIEW_REGISTRY.keys());
}
