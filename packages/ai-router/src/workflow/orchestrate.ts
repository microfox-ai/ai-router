import type { ZodTypeAny } from 'zod';

// Context object (accumulative) - available to all step input functions
export interface OrchestrationContext {
  input: any;                       // Original input
  steps: Record<string, any>;       // Outputs by step ID
  previous: any;                    // Previous step output
  all: any[];                       // All step outputs in order
  runId?: string;                   // Current workflow runId (for token generation)
  errors?: Array<{ step: number | string; error: any }>; // Errors collected during execution (if continueOnError)
}

// Agent step (await or fire-and-forget)
export interface AgentStep {
  type: 'agent';
  agent: string;                    // Agent path
  input?: any | ((ctx: OrchestrationContext) => any);  // Input mapping (static or function)
  await?: boolean;                  // true = blocking, false = fire-and-forget (default: true)
  id?: string;                      // Step ID for referencing output
}

// Hook step (HITL)
export interface HookStep {
  type: 'hook';
  token: string | ((ctx: OrchestrationContext) => string);  // Hook token
  schema?: ZodTypeAny;              // Payload schema (for validation, not used in runtime)
  id?: string;                      // Step ID
}

// Sleep step
export interface SleepStep {
  type: 'sleep';
  duration: string | number;        // "1 min", "30s", or milliseconds
}

// Condition step
export interface ConditionStep {
  type: 'condition';
  if: (ctx: OrchestrationContext) => boolean;    // Condition function
  then: OrchestrationStep[];        // Steps if true
  else?: OrchestrationStep[];       // Steps if false
}

// Parallel step
export interface ParallelStep {
  type: 'parallel';
  steps: OrchestrationStep[];       // Steps to run in parallel
}

// Worker step (call a background worker)
export interface WorkerStep {
  type: 'worker';
  worker: string;                   // Worker ID
  input?: any | ((ctx: OrchestrationContext) => any);  // Input mapping (static or function)
  await?: boolean;                  // true = blocking (wait for result), false = fire-and-forget (default: false)
  id?: string;                      // Step ID for referencing output
}

// Workflow step (call another workflow)
export interface WorkflowStep {
  type: 'workflow';
  workflow: string;                // Workflow ID or path
  input?: any | ((ctx: OrchestrationContext) => any);  // Input mapping (static or function)
  await?: boolean;                 // true = blocking (wait for result), false = fire-and-forget (default: true)
  id?: string;                     // Step ID for referencing output
}

// Union type for all step types
export type OrchestrationStep = 
  | AgentStep
  | HookStep
  | SleepStep
  | ConditionStep
  | ParallelStep
  | WorkerStep
  | WorkflowStep;

// Main orchestration config
export interface OrchestrationConfig {
  steps: OrchestrationStep[];
  baseUrl?: string;                 // Base URL for agent calls
  messages?: any[];                 // Initial messages
  input?: any;                      // Initial input (available in context.input)
  hookTimeout?: string;             // Default hook timeout (e.g., '7d', default: '7d')
  continueOnError?: boolean;        // Continue execution on step error (default: false, fail-fast)
  timeout?: string;                 // Global timeout for entire orchestration (e.g., '30m')
}

// Builder pattern for fluent API
export class OrchestrationBuilder {
  steps: OrchestrationStep[] = [];
  
  agent(
    path: string, 
    input?: any | ((ctx: OrchestrationContext) => any), 
    options?: { await?: boolean; id?: string }
  ): this {
    this.steps.push({ 
      type: 'agent', 
      agent: path, 
      input, 
      await: options?.await ?? true,
      id: options?.id 
    });
    return this;
  }
  
  hook(
    token: string | ((ctx: OrchestrationContext) => string), 
    schema?: ZodTypeAny
  ): this {
    this.steps.push({ type: 'hook', token, schema });
    return this;
  }
  
  sleep(duration: string | number): this {
    this.steps.push({ type: 'sleep', duration });
    return this;
  }
  
  condition(
    condition: (ctx: OrchestrationContext) => boolean,
    thenSteps: OrchestrationStep[],
    elseSteps?: OrchestrationStep[]
  ): this {
    this.steps.push({ 
      type: 'condition', 
      if: condition, 
      then: thenSteps,
      else: elseSteps 
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
    options?: { await?: boolean; id?: string }
  ): this {
    this.steps.push({
      type: 'worker',
      worker: workerId,
      input,
      await: options?.await ?? false, // Default to fire-and-forget
      id: options?.id,
    });
    return this;
  }
  
  workflow(
    workflowId: string,
    input?: any | ((ctx: OrchestrationContext) => any),
    options?: { await?: boolean; id?: string }
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
    return { steps: this.steps };
  }
}

// Helper function to create a new builder
export function createOrchestration(): OrchestrationBuilder {
  return new OrchestrationBuilder();
}
