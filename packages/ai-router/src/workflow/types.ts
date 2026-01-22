/**
 * Core workflow types and interfaces.
 * 
 * This file contains provider-neutral types used throughout the workflow system.
 */

import type { ZodTypeAny } from 'zod';

/**
 * Provider-neutral workflow definition contract used by ai-router.
 *
 * Concrete providers (Vercel `workflow`, Upstash Workflow, etc.) can extend
 * this shape with additional metadata, but the core fields are stable and
 * used for identification and schema validation.
 *
 * NOTE: Provider-specific helpers (like `createVercelWorkflow`) should be
 * implemented in your project as boilerplate, not in this package. This keeps
 * the package free of runtime dependencies on specific workflow providers.
 */
export interface WorkflowDefinition<Input = any, Output = any> {
  /**
   * Logical workflow identifier, stable across versions.
   */
  id: string;

  /**
   * Optional semantic version or tag to distinguish breaking changes.
   */
  version?: string;

  /**
   * Zod schema describing the validated input payload for the workflow.
   * This is used at the API boundary before delegating to any provider.
   */
  inputSchema: ZodTypeAny;

  /**
   * Optional Zod schema describing the expected workflow result shape.
   */
  outputSchema?: ZodTypeAny;

  /**
   * Provider identifier for this workflow definition. Examples:
   * - "vercel"  – Vercel `workflow` runtime (useworkflow.dev)
   * - "upstash" – Upstash Workflow / QStash
   * - custom strings for other runtimes
   */
  provider?: string;

  /**
   * Bag for provider-specific data needed by the corresponding adapter.
   *
   * For example:
   * - Vercel:  { workflowFn: (input) => Promise<Output> }
   * - Upstash: { endpointPath: string } or other routing metadata
   */
  definition: any;
}

// TODO: Add workflow step type to orchestrate.ts
// This allows workflows to call other workflows in orchestration

// TODO: Add error recovery/retry mechanisms
// - Retry step on failure (with max retries)
// - Retry with exponential backoff
// - Conditional retry based on error type
// - Continue-on-error vs fail-fast strategies

// TODO: Add step timeout configuration
// - Per-step timeout: { timeout: '5m' }
// - Global timeout: { timeout: '30m' } in OrchestrationConfig

// TODO: Add step result validation
// - Validate step output against expected schema
// - Fail fast if validation fails
// - Option to continue with validation errors

// TODO: Add workflow versioning support
// - Version-aware workflow lookup
// - Support multiple versions of same workflow
// - Version selection strategy (latest, specific, semver range)

// TODO: Add workflow composition/imports
// - Import workflows from other modules
// - Compose workflows from smaller workflows
// - Reuse workflow definitions

// TODO: Add workflow testing utilities
// - Mock workflow runtime for testing
// - Test orchestration configs without executing
// - Validate workflow definitions

// TODO: Add workflow monitoring/observability
// - Step execution metrics
// - Step duration tracking
// - Error rate monitoring
// - Workflow execution history
