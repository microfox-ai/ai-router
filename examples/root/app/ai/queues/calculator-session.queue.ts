import {
  defineHitlConfig,
  defineWorkerQueue,
  type ChainContext,
  type HitlResumeContext,
  type WorkerQueueConfig,
} from '@microfox/ai-worker';
import {
  calculatorHitlInputSchema,
  createCalculatorHitlUi,
  type CalculatorHitlInput,
  type CalculatorOperator,
} from '@/app/ai/queues/calculator-session.hitl-shared';

/**
 * Calculator HITL demo queue.
 *
 * Structure: 1 initial step + 1 HITL step that loops until the user clicks "Finish".
 * Each loop iteration pauses for human approval; the reviewer picks an operator and
 * number to apply, and decides whether to continue or end the session.
 */

const calculatorHitlConfig = defineHitlConfig({
  taskKey: 'calculator-session-loop',
  timeoutSeconds: 60 * 60,
  onTimeout: 'reject',
  ui: createCalculatorHitlUi(),
  inputSchema: calculatorHitlInputSchema,
});

/** Initial dispatch payload for the calculator-session queue (step 0 only). */
export type CalculatorSessionInitialInput =
  | { mode: 'init'; a: number; b: number; operator: 'add' | 'subtract' | 'multiply' | 'divide' }
  | { mode: 'carry'; current: number; history: string[] };

/**
 * Chain: build a `continue` payload from the previous step's output.
 * Called when advancing to the HITL step (or at the start of each loop iteration).
 */
function chainFromPrev(ctx: ChainContext) {
  const prev = ctx.previousOutputs[ctx.previousOutputs.length - 1]?.output as
    | { current?: number; history?: string[] }
    | undefined;
  return {
    mode: 'continue' as const,
    current: typeof prev?.current === 'number' ? prev.current : 0,
    history: Array.isArray(prev?.history) ? prev.history : [],
    nextNumber: 0,
    operator: 'add' as const,
  };
}

/**
 * Resume: merge the stored pending state with the reviewer's chosen operator + number.
 * Sets `finalize: true` when the reviewer unchecked "Continue loop".
 */
function resumeFromHitl(ctx: HitlResumeContext<CalculatorHitlInput>) {
  const reviewer = ctx.reviewerInput;
  const base = ctx.pendingInput as { current?: unknown; history?: unknown; operator?: string };
  return {
    mode: 'continue' as const,
    current: typeof base.current === 'number' ? base.current : 0,
    history: Array.isArray(base.history) ? base.history : [],
    nextNumber: Number(reviewer.nextNumber ?? 0),
    operator: (reviewer.operator ?? base.operator ?? 'add') as CalculatorOperator,
    finalize: reviewer.continueLoop === false,
  };
}

const calculatorSessionQueue = defineWorkerQueue({
  id: 'calculator-session',
  steps: [
    { workerId: 'calculator-hitl' },
    {
      workerId: 'calculator-hitl',
      chain: chainFromPrev,
      resume: resumeFromHitl,
      requiresApproval: true,
      hitl: calculatorHitlConfig,
      loop: {
        /** Keep looping until the worker signals finalized (user clicked "Finish"). */
        shouldContinue: ({ output }) => !(output as { finalized?: boolean }).finalized,
        maxIterations: 20,
      },
    },
  ],
}) satisfies WorkerQueueConfig<CalculatorSessionInitialInput, { current: number; finalized: boolean }>;

export default calculatorSessionQueue;
