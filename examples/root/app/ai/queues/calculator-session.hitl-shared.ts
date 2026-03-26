import { z } from 'zod';

export const CALCULATOR_OPERATORS = ['add', 'subtract', 'multiply', 'divide'] as const;
export type CalculatorOperator = (typeof CALCULATOR_OPERATORS)[number];

/** Reviewer payload shape used by HITL forms. */
export const calculatorHitlInputSchema = z.object({
  nextNumber: z.number().optional(),
  operator: z.enum(CALCULATOR_OPERATORS).optional(),
  /** When false the user wants to stop looping; the worker will set finalized=true. */
  continueLoop: z.boolean().optional(),
});
export type CalculatorHitlInput = z.infer<typeof calculatorHitlInputSchema>;

export type CalculatorHitlUiSection =
  | {
      type: 'calculator-keypad';
      allowDecimal?: boolean;
      quickNumbers?: number[];
      showHistory?: boolean;
    }
  | { type: 'hint'; text: string };

export interface CalculatorHitlUiSpec {
  type: 'custom';
  viewId: 'calculator-hitl-v1';
  title: string;
  sections: CalculatorHitlUiSection[];
  [key: string]: unknown;
}

/** Build UI config stored in queue step `hitl.ui`. */
export function createCalculatorHitlUi(): CalculatorHitlUiSpec {
  return {
    type: 'custom',
    viewId: 'calculator-hitl-v1',
    title: 'Calculator',
    sections: [
      {
        type: 'calculator-keypad',
        allowDecimal: true,
        quickNumbers: [0, 1, 2, 5, 10],
        showHistory: true,
      },
      {
        type: 'hint',
        text: 'Apply an operation and continue, or finish to end the session.',
      },
    ],
  };
}

export function isCalculatorHitlUiSpec(value: unknown): value is CalculatorHitlUiSpec {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.viewId === 'calculator-hitl-v1' && Array.isArray(v.sections);
}

