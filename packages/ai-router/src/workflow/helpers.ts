/**
 * Workflow definition helpers.
 * 
 * Provides type-safe helpers for defining workflows.
 * 
 * TODO: Implement defineWorkflow helper
 * 
 * Simplified workflow definition API:
 * ```typescript
 * import { defineWorkflow } from '@microfox/ai-router/workflow';
 * 
 * export default defineWorkflow({
 *   id: 'my-workflow',
 *   input: z.object({ data: z.string() }),
 *   output: z.object({ result: z.string() }),
 *   handler: async (input) => {
 *     "use workflow";
 *     // workflow logic
 *     return { result: 'processed' };
 *   }
 * });
 * ```
 * 
 * Features to implement:
 * 1. defineWorkflow() function
 *    - Accepts workflow config with id, input schema, output schema, handler
 *    - Returns WorkflowDefinition with proper typing
 *    - Automatically determines provider from config or defaults to configured provider
 * 
 * 2. Auto-registration (optional)
 *    - Automatically register workflow when imported
 *    - Use module-level side effect or explicit registration call
 * 
 * 3. Type inference
 *    - Infer input/output types from Zod schemas
 *    - Provide type-safe handler function
 * 
 * 4. Provider detection
 *    - Detect if handler uses "use workflow" (Vercel)
 *    - Detect if handler uses serve() (Upstash)
 *    - Or allow explicit provider specification
 */

import type { ZodTypeAny } from 'zod';
import type { WorkflowDefinition } from './types.js';

import { z } from 'zod';
import { getWorkflowConfig } from './config.js';

/**
 * Helper function to define a workflow with simplified API.
 * 
 * @example
 * ```typescript
 * import { defineWorkflow } from '@microfox/ai-router/workflow';
 * 
 * export default defineWorkflow({
 *   id: 'my-workflow',
 *   input: z.object({ data: z.string() }),
 *   output: z.object({ result: z.string() }),
 *   handler: async (input) => {
 *     "use workflow";
 *     return { result: input.data };
 *   }
 * });
 * ```
 */
export function defineWorkflow<
  InputSchema extends ZodTypeAny,
  OutputSchema extends ZodTypeAny | undefined = undefined,
>(config: {
  id: string;
  version?: string;
  input: InputSchema;
  output?: OutputSchema;
  handler: (
    input: z.infer<InputSchema>
  ) => Promise<OutputSchema extends ZodTypeAny ? z.infer<OutputSchema> : any>;
  provider?: 'vercel' | 'upstash';
}): WorkflowDefinition<
  z.infer<InputSchema>,
  OutputSchema extends ZodTypeAny ? z.infer<OutputSchema> : any
> {
  // Determine provider from handler or config
  // Check if handler string contains "use workflow" (Vercel) or serve() (Upstash)
  const handlerString = config.handler.toString();
  const hasUseWorkflow = handlerString.includes('"use workflow"') || handlerString.includes("'use workflow'");
  
  // Default to configured provider or 'vercel'
  const provider = config.provider || (hasUseWorkflow ? 'vercel' : getWorkflowConfig().provider);
  
  // For Vercel workflows, we need the handler function
  // For Upstash workflows, we need the endpoint URL (which would be created separately)
  // This helper assumes Vercel workflow unless specified otherwise
  
  const workflowDefinition: WorkflowDefinition<
    z.infer<InputSchema>,
    OutputSchema extends ZodTypeAny ? z.infer<OutputSchema> : any
  > = {
    id: config.id,
    version: config.version,
    inputSchema: config.input,
    outputSchema: config.output,
    provider,
    definition: provider === 'vercel' 
      ? { workflowFn: config.handler as any }
      : { handler: config.handler }, // For Upstash, handler would be used to create endpoint
  };
  
  return workflowDefinition;
}
