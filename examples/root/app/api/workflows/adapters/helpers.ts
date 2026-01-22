import { z, type ZodTypeAny } from 'zod';
import type { WorkflowDefinition } from '@microfox/ai-router';

/**
 * Helper to create a Vercel-backed workflow definition with explicit id/version
 * and Zod schemas. Types are automatically inferred from the schemas.
 *
 * This is project-specific boilerplate that uses the generic `WorkflowDefinition`
 * contract from the package.
 */
export type VercelWorkflowFn<Input = any, Output = any> = (
  input: Input,
) => Promise<Output>;

export interface VercelWorkflowCreateOptions<
  InputSchema extends ZodTypeAny = ZodTypeAny,
  OutputSchema extends ZodTypeAny | undefined = ZodTypeAny | undefined,
> {
  id: string;
  version?: string;
  input: InputSchema;
  output?: OutputSchema;
  /**
   * The `"use workflow"` function that will be passed to the external
   * Vercel `workflow` runtime (via `workflow/api.start` and `getRun`).
   */
  workflowFn: (
    input: z.infer<InputSchema>,
  ) => Promise<OutputSchema extends ZodTypeAny ? z.infer<OutputSchema> : any>;
}

export function createVercelWorkflow<
  InputSchema extends ZodTypeAny,
  OutputSchema extends ZodTypeAny | undefined = undefined,
>(
  options: VercelWorkflowCreateOptions<InputSchema, OutputSchema>,
): WorkflowDefinition<
  z.infer<InputSchema>,
  OutputSchema extends ZodTypeAny ? z.infer<OutputSchema> : any
> {
  if (!options.workflowFn) {
    throw new Error(
      '[ai-router][workflow] createVercelWorkflow requires `workflowFn` ' +
        'which should be a "use workflow" function.',
    );
  }

  return {
    id: options.id,
    version: options.version,
    inputSchema: options.input,
    outputSchema: options.output,
    provider: 'vercel',
    definition: {
      workflowFn: options.workflowFn as any,
    },
  };
}

/**
 * Helper to create an Upstash-backed workflow definition.
 *
 * Upstash workflows are implemented as Next.js API routes using `serve`
 * from `@upstash/workflow/nextjs`. This helper just stores the endpoint URL.
 */
export interface UpstashWorkflowCreateOptions<
  InputSchema extends ZodTypeAny = ZodTypeAny,
  OutputSchema extends ZodTypeAny | undefined = ZodTypeAny | undefined,
> {
  id: string;
  version?: string;
  input: InputSchema;
  output?: OutputSchema;
  /**
   * The public URL of the Next.js route that implements this workflow
   * using `serve` from `@upstash/workflow/nextjs`.
   */
  endpointUrl: string;
}

export function createUpstashWorkflow<
  InputSchema extends ZodTypeAny,
  OutputSchema extends ZodTypeAny | undefined = undefined,
>(
  options: UpstashWorkflowCreateOptions<InputSchema, OutputSchema>,
): WorkflowDefinition<
  z.infer<InputSchema>,
  OutputSchema extends ZodTypeAny ? z.infer<OutputSchema> : any
> {
  if (!options.endpointUrl) {
    throw new Error(
      '[ai-router][workflow] createUpstashWorkflow requires `endpointUrl` ' +
        'pointing to the Next.js route that implements the workflow.',
    );
  }

  return {
    id: options.id,
    version: options.version,
    inputSchema: options.input,
    outputSchema: options.output,
    provider: 'upstash',
    definition: {
      endpointUrl: options.endpointUrl,
    },
  };
}
