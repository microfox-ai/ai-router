import type { ZodTypeAny } from 'zod';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Workflow authoring helpers
// ---------------------------------------------------------------------------

export type WorkflowFn<Input = any, Result = any> = (
  input: Input,
) => Promise<Result>;

export type CreatedWorkflow<Input = any, Output = any> = {
  id: string;
  version?: string;
  inputSchema: ZodTypeAny;
  outputSchema?: ZodTypeAny;
  /**
   * Entrypoint for the external workflow runtime – this should be a
   * `"use workflow"` function that matches the behaviour described in the
   * official docs: https://useworkflow.dev/docs/foundations/workflows-and-steps
   */
  workflowFn: (input: Input) => Promise<Output>;
};

export interface WorkflowCreateOptions<
  InputSchema extends ZodTypeAny = ZodTypeAny,
  OutputSchema extends ZodTypeAny | undefined = ZodTypeAny | undefined,
> {
  id: string;
  version?: string;
  input: InputSchema;
  output?: OutputSchema;
  /**
   * The `"use workflow"` function that will be passed to the external
   * workflow runtime (via `workflow/api.start` and `getRun`).
   *
   * Signature follows the official docs: the function receives the
   * validated input (already parsed from the Zod schema) and returns
   * the workflow result.
   */
  workflowFn: (
    input: z.infer<InputSchema>,
  ) => Promise<OutputSchema extends ZodTypeAny ? z.infer<OutputSchema> : any>;
}

/**
 * Create a workflow with explicit id/version and schemas.
 * Types are automatically inferred from Zod schemas!
 * 
 * @example
 * ```ts
 * const workflow = createWorkflow({
 *   id: 'my-workflow',
 *   input: z.object({ email: z.string().email() }),
 *   output: z.object({ status: z.string() }),
 *   workflowFn: async (input) => {
 *     "use workflow";
 *     // input is automatically typed from input schema
 *     return { status: 'done' };
 *   },
 * });
 * ```
 */
export function createWorkflow<
  InputSchema extends ZodTypeAny,
  OutputSchema extends ZodTypeAny | undefined = undefined,
>(
  options: WorkflowCreateOptions<InputSchema, OutputSchema>,
): CreatedWorkflow<
  z.infer<InputSchema>,
  OutputSchema extends ZodTypeAny ? z.infer<OutputSchema> : any
> {
  if (!options.workflowFn) {
    throw new Error(
      '[ai-router][workflow] createWorkflow requires `workflowFn` ' +
        'which should be a "use workflow" function.',
    );
  }

  return {
    id: options.id,
    version: options.version,
    inputSchema: options.input,
    outputSchema: options.output,
    workflowFn: options.workflowFn as any,
  };
}

// ---------------------------------------------------------------------------
// Workflow runtime adapter exports
// ---------------------------------------------------------------------------

export type {
  WorkflowAdapter,
  WorkflowAdapterStartResult,
  WorkflowAdapterStatusResult,
} from './workflow/runtimeAdapter.js';
export { defaultWorkflowAdapter } from './workflow/runtimeAdapter.js';
