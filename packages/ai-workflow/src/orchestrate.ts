import type { ZodTypeAny } from 'zod';

// Context object (accumulative) - available to all step input functions
export interface OrchestrationContext {
  input: any; // Original input
  steps: Record<string, any>; // Outputs by step ID
  previous: any; // Previous step output
  all: any[]; // All step outputs in order
  runId?: string; // Current workflow runId (for token generation)
  errors?: Array<{ step: number | string; error: any }>; // Errors collected during execution (if continueOnError)
}

// Agent step (await or fire-and-forget)
export interface AgentStep {
  type: 'agent';
  agent: string; // Agent path
  input?: any | ((ctx: OrchestrationContext) => any); // Input mapping (static or function)
  await?: boolean; // true = blocking, false = fire-and-forget (default: true)
  id?: string; // Step ID for referencing output
}

// Hook step (HITL)
export interface HookStep {
  type: 'hook';
  token: string | ((ctx: OrchestrationContext) => string); // Hook token
  schema?: ZodTypeAny; // Payload schema (for validation, not used in runtime)
  id?: string; // Step ID
}

// Sleep step
export interface SleepStep {
  type: 'sleep';
  duration: string | number; // "1 min", "30s", or milliseconds
}

// Serializable condition: reference a prior step's output and compare (no functions).
// Use whenStep() to build these. Supports Vercel workflow serialization.
export interface StepFieldCondition {
  type: 'stepField';
  stepId: string;
  path?: string; // Dot path into step output, e.g. 'payload.approved'. Omit for whole output.
  op: 'eq' | 'neq' | 'truthy' | 'falsy' | 'exists' | 'notExists';
  value?: unknown; // For eq / neq
}

export type SerializableCondition = StepFieldCondition;

// Condition step
export interface ConditionStep {
  type: 'condition';
  if:
    | ((ctx: OrchestrationContext) => boolean)
    | boolean
    | SerializableCondition; // Function, static boolean, or serializable step-field condition
  then: OrchestrationStep[]; // Steps if true
  else?: OrchestrationStep[]; // Steps if false
}

// Parallel step
export interface ParallelStep {
  type: 'parallel';
  steps: OrchestrationStep[]; // Steps to run in parallel
}

/** Config for step-based worker job polling (interval, timeout, max retries). */
export interface WorkerPollConfig {
  intervalMs?: number; // Delay between polls (default: 3000)
  timeoutMs?: number; // Max wall-clock time (default: 600_000 = 10 min)
  maxRetries?: number; // Max poll attempts (default: 200)
}

// Worker step (call a background worker)
export interface WorkerStep {
  type: 'worker';
  worker: string; // Worker ID
  input?: any | ((ctx: OrchestrationContext) => any); // Input mapping (static or function)
  await?: boolean; // true = blocking (wait for result), false = fire-and-forget (default: false)
  id?: string; // Step ID for referencing output
  workerPoll?: WorkerPollConfig; // Override poll interval / timeout / maxRetries for awaited workers
}

// Workflow step (call another workflow)
export interface WorkflowStep {
  type: 'workflow';
  workflow: string; // Workflow ID or path
  input?: any | ((ctx: OrchestrationContext) => any); // Input mapping (static or function)
  await?: boolean; // true = blocking (wait for result), false = fire-and-forget (default: true)
  id?: string; // Step ID for referencing output
}

// Internal status update step (auto-injected before/after hook/sleep)
// Not part of public API - only used internally
export interface StatusUpdateStep {
  type: '_statusUpdate';
  status: 'paused' | 'running';
  hookToken?: string; // Hook token to save (when pausing on hook)
}

// Union type for all step types (including internal _statusUpdate)
export type OrchestrationStep =
  | AgentStep
  | HookStep
  | SleepStep
  | ConditionStep
  | ParallelStep
  | WorkerStep
  | WorkflowStep
  | StatusUpdateStep;

/** Get value at dot path (e.g. 'payload.approved') or whole obj if path empty. */
function getAtPath(obj: unknown, path?: string): unknown {
  if (!path) return obj;
  return (path.split('.') as string[]).reduce((o: any, k) => o?.[k], obj);
}

/**
 * Build a serializable condition that checks a prior step's output.
 * Use in .condition(whenStep(...), thenSteps, elseSteps). Safe for Vercel workflow serialization.
 *
 * @param stepId - Step id (e.g. 'approval')
 * @param path - Dot path into output (e.g. 'payload.approved'). Omit to use whole output.
 * @param op - 'eq' | 'neq' | 'truthy' | 'falsy' | 'exists' | 'notExists'
 * @param value - For eq/neq only
 */
export function whenStep(
  stepId: string,
  path: string | undefined,
  op: StepFieldCondition['op'],
  value?: unknown,
): StepFieldCondition {
  return { type: 'stepField', stepId, path, op, value };
}

/**
 * Evaluate a StepFieldCondition at runtime. Used by workflow executors.
 */
export function evaluateStepFieldCondition(
  cond: StepFieldCondition,
  ctx: OrchestrationContext,
): boolean {
  const raw = ctx.steps[cond.stepId];
  const v = getAtPath(raw, cond.path);
  switch (cond.op) {
    case 'eq':
      return v === cond.value;
    case 'neq':
      return v !== cond.value;
    case 'truthy':
      return !!v;
    case 'falsy':
      return !v;
    case 'exists':
      return v !== undefined && v !== null;
    case 'notExists':
      return v === undefined || v === null;
    default:
      return false;
  }
}

// Main orchestration config
export interface OrchestrationConfig {
  /** Optional workflow id (e.g. for metadata, debug files). When passing config in API, use config.id. */
  id?: string;
  steps: OrchestrationStep[];
  baseUrl?: string; // Base URL for agent calls
  messages?: any[]; // Initial messages
  input?: any; // Initial input (available in context.input)
  hookTimeout?: string; // Default hook timeout (e.g., '7d', default: '7d')
  continueOnError?: boolean; // Continue execution on step error (default: false, fail-fast)
  timeout?: string; // Global timeout for entire orchestration (e.g., '30m')
  workerPoll?: WorkerPollConfig; // Default poll interval / timeout / maxRetries for awaited workers
}

/**
 * Injects _statusUpdate steps before/after hook and sleep steps.
 * Use when providing raw config (e.g. pure JSON) instead of createOrchestration().build().
 * If config already contains _statusUpdate steps, returns as-is (no double injection).
 */
export function prepareOrchestrationConfig(
  raw: Pick<OrchestrationConfig, 'steps'> & Partial<OrchestrationConfig>,
): OrchestrationConfig {
  const hasStatusUpdates = raw.steps.some((s) => s.type === '_statusUpdate');
  if (hasStatusUpdates) return { ...raw, steps: raw.steps };

  const stepsWithStatusUpdates: OrchestrationStep[] = [];

  for (const step of raw.steps) {
    if (step.type === 'hook' || step.type === 'sleep') {
      stepsWithStatusUpdates.push({
        type: '_statusUpdate',
        status: 'paused',
        hookToken: undefined,
      });
    }
    stepsWithStatusUpdates.push(step);
    if (step.type === 'hook' || step.type === 'sleep') {
      stepsWithStatusUpdates.push({
        type: '_statusUpdate',
        status: 'running',
        hookToken: undefined,
      });
    }
  }

  return { ...raw, steps: stepsWithStatusUpdates };
}

// Builder pattern for fluent API
export class OrchestrationBuilder {
  steps: OrchestrationStep[] = [];

  agent(
    path: string,
    input?: any | ((ctx: OrchestrationContext) => any),
    options?: { await?: boolean; id?: string },
  ): this {
    this.steps.push({
      type: 'agent',
      agent: path,
      input,
      await: options?.await ?? true,
      id: options?.id,
    });
    return this;
  }

  hook(
    token: string | ((ctx: OrchestrationContext) => string),
    schemaOrOptions?: ZodTypeAny | { id?: string },
    options?: { id?: string },
  ): this {
    // Handle overload: if second arg is an object with 'id', it's options, not schema
    if (
      schemaOrOptions &&
      typeof schemaOrOptions === 'object' &&
      'id' in schemaOrOptions &&
      !('_def' in schemaOrOptions)
    ) {
      // Second argument is options, not schema
      this.steps.push({
        type: 'hook',
        token,
        schema: undefined,
        id: (schemaOrOptions as { id?: string }).id,
      });
      return this;
    }
    // Normal case: schema is second arg, options is third
    this.steps.push({
      type: 'hook',
      token,
      schema: schemaOrOptions as ZodTypeAny | undefined,
      id: options?.id,
    });
    return this;
  }

  sleep(duration: string | number): this {
    this.steps.push({ type: 'sleep', duration });
    return this;
  }

  condition(
    condition:
      | ((ctx: OrchestrationContext) => boolean)
      | boolean
      | SerializableCondition,
    thenSteps: OrchestrationStep[],
    elseSteps?: OrchestrationStep[],
  ): this {
    this.steps.push({
      type: 'condition',
      if: condition,
      then: thenSteps,
      else: elseSteps,
    });
    return this;
  }

  parallel(steps: OrchestrationStep[]): this {
    this.steps.push({ type: 'parallel', steps });
    return this;
  }

  worker(
    workerId: string,
    input?: any | ((ctx: OrchestrationContext) => any),
    options?: { await?: boolean; id?: string; workerPoll?: WorkerPollConfig },
  ): this {
    this.steps.push({
      type: 'worker',
      worker: workerId,
      input,
      await: options?.await ?? false, // Default to fire-and-forget
      id: options?.id,
      workerPoll: options?.workerPoll,
    });
    return this;
  }

  workflow(
    workflowId: string,
    input?: any | ((ctx: OrchestrationContext) => any),
    options?: { await?: boolean; id?: string },
  ): this {
    this.steps.push({
      type: 'workflow',
      workflow: workflowId,
      input,
      await: options?.await ?? true, // Default to blocking
      id: options?.id,
    });
    return this;
  }

  build(): OrchestrationConfig {
    return prepareOrchestrationConfig({ steps: this.steps });
  }
}

// Helper function to create a new builder
export function createOrchestration(): OrchestrationBuilder {
  return new OrchestrationBuilder();
}

