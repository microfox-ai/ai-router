import { createWorker } from '@microfox/ai-worker';
import { z } from 'zod';

const OperatorSchema = z.enum(['add', 'subtract', 'multiply', 'divide']);

/**
 * Pure domain schema — no queue/HITL envelope keys needed.
 * The runtime strips __workerQueue, __hitlInput, __hitlDecision, etc.
 * automatically before this handler receives input.
 */
const InputSchema = z.union([
  z.object({
    mode: z.literal('init'),
    a: z.number(),
    b: z.number(),
    operator: OperatorSchema,
  }),
  z.object({
    mode: z.literal('carry'),
    current: z.number(),
    history: z.array(z.string()),
  }),
  z.object({
    mode: z.literal('continue'),
    current: z.number(),
    nextNumber: z.number(),
    operator: OperatorSchema,
    history: z.array(z.string()).optional(),
    /** Set by resumeFromHitl when the user clicked "Finish" — marks output finalized. */
    finalize: z.boolean().optional(),
  }),
]);

const OutputSchema = z.object({
  current: z.number(),
  history: z.array(z.string()),
  expression: z.string(),
  finalized: z.boolean(),
});

export const workerConfig = {
  timeout: 60,
  memorySize: 256,
  group: 'calculator',
};

function applyOp(left: number, right: number, op: z.infer<typeof OperatorSchema>): number {
  switch (op) {
    case 'add': return left + right;
    case 'subtract': return left - right;
    case 'multiply': return left * right;
    case 'divide':
      if (right === 0) throw new Error('Cannot divide by zero');
      return left / right;
    default: return left;
  }
}

function opSymbol(op: z.infer<typeof OperatorSchema>): string {
  switch (op) {
    case 'add': return '+';
    case 'subtract': return '-';
    case 'multiply': return 'x';
    case 'divide': return '/';
    default: return '?';
  }
}

export default createWorker({
  id: 'calculator-hitl',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async ({ input, ctx }) => {
    await ctx.jobStore?.update({ status: 'running' });

    if (input.mode === 'carry') {
      const output = {
        current: input.current,
        history: input.history ?? [],
        expression: `${input.current}`,
        finalized: false,
      };
      await ctx.jobStore?.update({ status: 'completed', output });
      return output;
    }

    if (input.mode === 'init') {
      const value = applyOp(input.a, input.b, input.operator);
      const expression = `${input.a} ${opSymbol(input.operator)} ${input.b} = ${value}`;
      const output = {
        current: value,
        history: [expression],
        expression,
        finalized: false,
      };
      await ctx.jobStore?.update({ status: 'completed', output });
      return output;
    }

    // mode === 'continue': domain input is fully formed by the queue's chain/resume functions.
    const nextNumber = Number(input.nextNumber ?? 0);
    const op = input.operator;
    const next = applyOp(input.current, nextNumber, op);
    const expression = `${input.current} ${opSymbol(op)} ${nextNumber} = ${next}`;
    const output = {
      current: next,
      history: [...(input.history ?? []), expression],
      expression,
      finalized: input.finalize === true,
    };
    await ctx.jobStore?.update({ status: 'completed', output });
    return output;
  },
});
