import type { JSONValue, Tool } from 'ai';
import type { ZodTypeAny } from 'zod';
import { z } from 'zod';
import type { AgentTool } from './router.js';

/**
 * Helper type for values that can safely be passed between workflows and steps.
 * Mirrors the semantics from the workflow docs (JSON types + a few extras) but
 * stays runtime-agnostic. The actual enforcement comes from your workflow runtime.
 */
export type Serializable =
  | JSONValue
  | Date
  | URL
  | Map<Serializable, Serializable>
  | Set<Serializable>
  | bigint
  | Uint8Array;

// ---------------------------------------------------------------------------
// Workflow & Step authoring helpers (DX only, no runtime)
// ---------------------------------------------------------------------------

export type WorkflowFn<Args extends any[] = any[], Result = any> = (
  ...args: Args
) => Promise<Result>;

/**
 * A typed workflow definition. At runtime this is just the original function;
 * the replay/event-log behaviour is provided entirely by your workflow runtime.
 *
 * Usage:
 *   export const userOnboarding = defineWorkflow(async (email: string) => {
 *     "use workflow";
 *     ...
 *   });
 */
export interface WorkflowDefinition<
  Args extends any[] = any[],
  Result = any,
> extends WorkflowFn<Args, Result> {}

export function defineWorkflow<Args extends any[], Result>(
  fn: WorkflowFn<Args, Result>,
): WorkflowDefinition<Args, Result> {
  return fn as WorkflowDefinition<Args, Result>;
}

/**
 * WorkflowContext provides durable primitives for workflow execution.
 * Import the class from './workflow/context.js' for actual usage.
 */
import type { WorkflowContext as WorkflowContextImpl } from './workflow/context.js';
export type WorkflowContext<Input = any, Output = any> = WorkflowContextImpl<Input, Output>;

export type CreatedWorkflow<Input = any, Output = any> = {
  id: string;
  version?: string;
  inputSchema: ZodTypeAny;
  outputSchema?: ZodTypeAny;
  handler: (ctx: WorkflowContext<Input, Output>) => Promise<Output>;
};

export interface WorkflowCreateOptions<
  InputSchema extends ZodTypeAny = ZodTypeAny,
  OutputSchema extends ZodTypeAny | undefined = ZodTypeAny | undefined,
> {
  id: string;
  version?: string;
  input: InputSchema;
  output?: OutputSchema;
  handler: (
    ctx: WorkflowContext<
      z.infer<InputSchema>,
      OutputSchema extends ZodTypeAny ? z.infer<OutputSchema> : any
    >,
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
 *   handler: async (ctx) => {
 *     // ctx.input is automatically typed from input schema
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
  return {
    id: options.id,
    version: options.version,
    inputSchema: options.input,
    outputSchema: options.output,
    handler: options.handler as any,
  };
}

export type StepFn<Args extends any[] = any[], Result = any> = (
  ...args: Args
) => Promise<Result>;

export interface StepConfig {
  /** Override the default max retry attempts for this step (interpreted by your workflow runtime). */
  maxRetries?: number;
  /** Configure a timeout for this step (e.g. "30s", "5m"). */
  timeout?: string;
}

/**
 * A step definition carries the original function plus optional configuration
 * metadata. Your workflow runtime can read `__stepConfig` if it wants to.
 */
export interface StepDefinition<Args extends any[] = any[], Result = any>
  extends StepFn<Args, Result> {
  config: (cfg: StepConfig) => StepDefinition<Args, Result>;
  /** @internal – configuration bag for the workflow runtime (if it chooses to use it). */
  __stepConfig?: StepConfig;
}

/**
 * Identity helper for authoring steps with fluent configuration.
 *
 * Usage:
 *   export const fetchWithRetry = defineStep(async (url: string) => {
 *     "use step";
 *     ...
 *   }).config({ maxRetries: 5, timeout: "30s" });
 */
export function defineStep<Args extends any[], Result>(
  fn: StepFn<Args, Result>,
): StepDefinition<Args, Result> {
  const base = (...args: Args) => fn(...args);
  const stepDef = base as StepDefinition<Args, Result>;

  stepDef.__stepConfig = {};
  stepDef.config = (cfg: StepConfig) => {
    stepDef.__stepConfig = { ...(stepDef.__stepConfig ?? {}), ...cfg };
    return stepDef;
  };

  return stepDef;
}

/**
 * A more structured step definition, matching the `createStep` DX described
 * in `research.txt`. This is still runtime-agnostic; ai-router does not run a
 * durable engine by itself, but the metadata is designed for one.
 */
export interface StepRetryConfig {
  maxAttempts?: number;
  backoff?: 'exponential' | 'fixed';
}

export interface CreatedStep<Input = any, Output = any> {
  id: string;
  inputSchema: ZodTypeAny;
  outputSchema?: ZodTypeAny;
  run: (input: Input, ctx?: { attempt: number }) => Promise<Output>;
  retry?: StepRetryConfig;
}

export interface StepCreateOptions<
  InputSchema extends ZodTypeAny = ZodTypeAny,
  OutputSchema extends ZodTypeAny | undefined = ZodTypeAny | undefined,
> {
  id: string;
  input: InputSchema;
  output?: OutputSchema;
  run: (
    input: z.infer<InputSchema>,
    ctx?: { attempt: number },
  ) => Promise<OutputSchema extends ZodTypeAny ? z.infer<OutputSchema> : any>;
  retry?: StepRetryConfig;
}

/**
 * Create a durable step with explicit id, schemas and retry behaviour.
 * Types are automatically inferred from Zod schemas - no need to specify them!
 * 
 * The "use step" directive is automatically handled - you don't need to add it.
 * 
 * @example
 * ```ts
 * const step = createStep({
 *   id: 'create-user',
 *   input: z.object({ email: z.string().email(), name: z.string() }),
 *   output: z.object({ userId: z.string() }),
 *   run: async (input) => {
 *     // input is automatically typed as { email: string; name: string }
 *     return { userId: '123' }; // Return type is inferred from output schema
 *   },
 * });
 * ```
 */
export function createStep<
  InputSchema extends ZodTypeAny,
  OutputSchema extends ZodTypeAny | undefined = undefined,
>(
  options: {
    id: string;
    input: InputSchema;
    output?: OutputSchema;
    run: (
      input: z.infer<InputSchema>,
      ctx?: { attempt: number },
    ) => Promise<OutputSchema extends ZodTypeAny ? z.infer<OutputSchema> : any>;
    retry?: StepRetryConfig;
  },
): CreatedStep<
  z.infer<InputSchema>,
  OutputSchema extends ZodTypeAny ? z.infer<OutputSchema> : any
> {
  // Wrap the run function to automatically inject "use step" directive
  // This ensures the function is recognized as a step function
  const wrappedRun = async (
    input: z.infer<InputSchema>,
    ctx?: { attempt: number },
  ): Promise<OutputSchema extends ZodTypeAny ? z.infer<OutputSchema> : any> => {
    "use step";
    return await options.run(input, ctx);
  };

  return {
    id: options.id,
    inputSchema: options.input,
    outputSchema: options.output,
    run: wrappedRun as any,
    retry: options.retry,
  };
}

// ---------------------------------------------------------------------------
// Workflow-as-Tool helpers (tool-first DX, runtime-agnostic)
// ---------------------------------------------------------------------------

export type WorkflowStatus =
  | 'started'
  | 'waiting_for_human'
  | 'completed'
  | 'failed';

export interface WorkflowInvocationResult<Output = unknown> {
  workflowId: string;
  status: WorkflowStatus;
  /**
   * Optional, minimal output snapshot. Keep this very small and store rich
   * state in your workflow runtime to avoid token bloat.
   */
  output?: Output;
}

export interface WorkflowToolConfig<Input, OutputMinimal = unknown> {
  /**
   * Stable tool id. This will be used as the tool key on the AI side.
   */
  id: string;
  /** Human-readable name for the tool. */
  name: string;
  /** Clear description of what the workflow does. */
  description: string;
  /**
   * Zod schema describing the workflow's input. This is used by ai-router to
   * build a Tool the AI model can call.
   */
  inputSchema: ZodTypeAny;
  /**
   * Zod schema for the *minimal* output you want to expose back to the AI.
   * Rich workflow state should stay in your workflow runtime.
   */
  outputSchema: ZodTypeAny;
  /**
   * Optional metadata that will flow through to Studio / UI.
   */
  metadata?: AgentTool['metadata'];
  /**
   * Function that actually starts (or signals to) a workflow instance in your
   * chosen workflow runtime and returns a minimal status payload.
   *
   * Example: This can call `startWorkflow('onboardingWorkflow', input)` from
   * your `useWorkflow` client and return `{ workflowId, status, output? }`.
   */
  start: (input: Input) => Promise<WorkflowInvocationResult<OutputMinimal>>;
}

/**
 * Creates an `AgentTool` that represents a long-running workflow.
 *
 * This is intentionally runtime-agnostic: you provide the `start` function that
 * talks to your `workflow` / `useWorkflow` engine (HTTP call, direct SDK, etc.)
 * and ai-router takes care of exposing it as a tool with proper schemas and metadata.
 */
export function createWorkflowTool<Input, OutputMinimal = unknown>(
  config: WorkflowToolConfig<Input, OutputMinimal>,
): AgentTool<Input, WorkflowInvocationResult<OutputMinimal>> {
  const {
    id,
    name,
    description,
    inputSchema,
    outputSchema,
    metadata,
    start,
  } = config;

  const toolDef: AgentTool<
    Input,
    WorkflowInvocationResult<OutputMinimal>
  > = {
    id,
    name,
    description,
    inputSchema,
    outputSchema,
    metadata,
    // Underlying `ai` Tool type uses `execute` as the call surface.
    execute: async (input: Input) => {
      return start(input);
    },
  } as AgentTool<Input, WorkflowInvocationResult<OutputMinimal>> &
    Tool<Input, WorkflowInvocationResult<OutputMinimal>>;

  return toolDef;
}

// ---------------------------------------------------------------------------
// HITL helpers – deterministic tokens & gateway typing (no runtime logic)
// ---------------------------------------------------------------------------

/**
 * Small helper for constructing deterministic tokens for HITL hooks.
 * Mirrors the patterns from `workflow_hitl.md` while staying dead simple and
 * framework-agnostic.
 *
 * Example:
 *   const token = buildHitlToken('onboarding-signal', userId);
 *   // -> "onboarding-signal:user-123"
 */
export function buildHitlToken(
  kind: string,
  entityId: string | number,
  extra?: string | number,
): string {
  const base = `${kind}:${String(entityId)}`;
  return extra !== undefined ? `${base}:${String(extra)}` : base;
}

export interface HitlGatewayPayload<Data extends Serializable = Serializable> {
  token: string;
  data: Data;
}

/**
 * Generic type for a HITL gateway function. This is meant to wrap the
 * `resumeHook(token, data)` primitive from your workflow runtime.
 */
export type HitlGatewayHandler<Data extends Serializable = Serializable> = (
  payload: HitlGatewayPayload<Data>,
) => Promise<void>;

/**
 * Convenience helper to build a gateway handler from a lower-level
 * `resumeHook(token, data)` style API. This keeps ai-router decoupled from
 * any specific workflow runtime while still giving you a clear integration
 * point for HITL flows.
 */
export function resumeViaGateway<Data extends Serializable = Serializable>(
  resumeFn: (token: string, data: Data) => Promise<void>,
): HitlGatewayHandler<Data> {
  return async ({ token, data }) => {
    await resumeFn(token, data);
  };
}

// ---------------------------------------------------------------------------
// Export workflow runtime components
// ---------------------------------------------------------------------------

export { WorkflowEngine } from './workflow/engine.js';
export { WorkflowSuspensionError, WorkflowCancellationError } from './workflow/context.js';
export type { StorageDriver } from './workflow/storage/driver.js';
export { MemoryStorageDriver } from './workflow/storage/memory.js';
export { SQLiteStorageDriver } from './workflow/storage/sqlite.js';
export type { HistoryEvent, WorkflowUI, WorkflowInstance, Signal, Timer, WorkflowInstanceStatus } from './workflow/types.js';

/**
 * Helper to create a step that calls an ai-router agent.
 * This allows workflows to invoke existing agents as steps.
 */
export function createAgentStep(
  agentPath: string,
  router: any, // AiRouter - using any to avoid circular dependency
): CreatedStep<any, any> {
  // Import z at module level would cause issues, so we import it here
  // In practice, users should import z from 'zod' themselves
  const z = require('zod') as typeof import('zod').z;
  
  return createStep({
    id: `call-agent-${agentPath.replace(/\//g, '-')}`,
    input: z.any(),
    output: z.any(),
    run: async (params) => {
      // Call the router's handle method
      // Note: This is a simplified version - in practice you'd want to
      // properly handle the response stream and extract the result
      const response = await router.handle(agentPath, {
        request: { params, messages: [] },
      });
      // Extract result from response
      return response;
    },
  });
}

/**
 * Creates both a step and an agent from the same definition.
 * The step is used in workflows (with replay/memoization), while the agent
 * can be called directly (with UI streaming, state access, etc.).
 * 
 * @example
 * ```ts
 * const createUser = createStepAgent(router, {
 *   id: 'create-user',
 *   path: '/agents/create-user', // Optional - for direct agent calls
 *   input: z.object({ email: z.string().email(), name: z.string() }),
 *   output: z.object({ userId: z.string() }),
 *   step: async (input) => {
 *     "use step";
 *     // Pure step implementation
 *     return await createUserInDB(input);
 *   },
 *   agent: async (ctx, input) => {
 *     // Optional agent wrapper with router context
 *     ctx.response.writeMessageMetadata({ loader: 'Creating user...' });
 *     return await createUser.step.run(input);
 *   },
 * });
 * 
 * // Use in workflow
 * const user = await ctx.run(createUser.step, { email, name });
 * 
 * // Or call as agent
 * await ctx.next.callAgent('/agents/create-user', { email, name });
 * ```
 */
export function createStepAgent<
  InputSchema extends ZodTypeAny,
  OutputSchema extends ZodTypeAny | undefined = undefined,
>(
  router: any, // AiRouter
  options: {
    id: string;
    path?: string;
    input: InputSchema;
    output?: OutputSchema;
    step: (
      input: z.infer<InputSchema>,
      ctx?: { attempt: number },
    ) => Promise<OutputSchema extends ZodTypeAny ? z.infer<OutputSchema> : any>;
    agent?: (
      ctx: any, // AiContext - using any to avoid circular dependency
      input: z.infer<InputSchema>,
    ) => Promise<OutputSchema extends ZodTypeAny ? z.infer<OutputSchema> : any>;
    retry?: StepRetryConfig;
  },
): {
  step: CreatedStep<
    z.infer<InputSchema>,
    OutputSchema extends ZodTypeAny ? z.infer<OutputSchema> : any
  >;
  agent?: any; // Agent handler if path provided
} {
  // Create the step
  const step = createStep({
    id: options.id,
    input: options.input,
    output: options.output,
    run: options.step,
    retry: options.retry,
  });

  // Create agent wrapper if path provided
  let agent: any;
  if (options.path && options.agent) {
    router.agent(options.path, async (ctx: any) => {
      const input = options.input.parse(ctx.request.params);
      return await options.agent!(ctx, input);
    });
    agent = true; // Indicate agent was registered
  } else if (options.path) {
    // Default agent implementation that just calls the step
    router.agent(options.path, async (ctx: any) => {
      const input = options.input.parse(ctx.request.params);
      return await step.run(input);
    });
    agent = true;
  }

  return { step, agent };
}


