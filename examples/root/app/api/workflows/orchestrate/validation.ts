/**
 * Orchestration config validation utilities.
 * 
 * Validates orchestration configurations for common issues like:
 * - Circular dependencies
 * - Duplicate step IDs
 * - Invalid step definitions
 */

import type { OrchestrationConfig, OrchestrationStep } from '@microfox/ai-router';

export interface ValidationError {
  code: string;
  message: string;
  step?: number | string;
}

/**
 * Helper to safely get step ID (not all step types have 'id' property)
 */
function getStepId(step: OrchestrationStep): string | undefined {
  if ('id' in step) {
    return (step as any).id;
  }
  return undefined;
}

/**
 * Validate orchestration config.
 */
export function validateOrchestrationConfig(config: OrchestrationConfig): ValidationError[] {
  const errors: ValidationError[] = [];
  const stepIds = new Set<string>();
  
  // Validate all steps recursively
  function validateSteps(steps: OrchestrationStep[], path: string[] = []): void {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepPath = [...path, `${i}-${step.type}`];
      
      // Check for duplicate step IDs (not all step types have 'id' property)
      const stepId = getStepId(step);
      if (stepId) {
        if (stepIds.has(stepId)) {
          errors.push({
            code: 'DUPLICATE_STEP_ID',
            message: `Duplicate step ID "${stepId}" found`,
            step: stepId,
          });
        } else {
          stepIds.add(stepId);
        }
      }
      
      // Validate step-specific properties
      switch (step.type) {
        case 'agent':
          if (!step.agent || typeof step.agent !== 'string') {
            errors.push({
              code: 'INVALID_AGENT_STEP',
              message: `Agent step must have a valid "agent" path (string)`,
              step: stepPath.join('.'),
            });
          }
          break;
          
        case 'worker':
          if (!step.worker || typeof step.worker !== 'string') {
            errors.push({
              code: 'INVALID_WORKER_STEP',
              message: `Worker step must have a valid "worker" ID (string)`,
              step: stepPath.join('.'),
            });
          }
          // Workers only support fire-and-forget mode
          if (step.await === true) {
            errors.push({
              code: 'INVALID_WORKER_AWAIT',
              message: `Worker steps only support fire-and-forget mode (await: false). Workers are long-running background tasks that complete independently.`,
              step: stepPath.join('.'),
            });
          }
          break;
          
        case 'workflow':
          if (!step.workflow || typeof step.workflow !== 'string') {
            errors.push({
              code: 'INVALID_WORKFLOW_STEP',
              message: `Workflow step must have a valid "workflow" ID or path (string)`,
              step: stepPath.join('.'),
            });
          }
          break;
          
        case 'hook':
          if (!step.token || (typeof step.token !== 'string' && typeof step.token !== 'function')) {
            errors.push({
              code: 'INVALID_HOOK_STEP',
              message: `Hook step must have a valid "token" (string or function)`,
              step: stepPath.join('.'),
            });
          }
          break;
          
        case 'sleep':
          if (!step.duration || (typeof step.duration !== 'string' && typeof step.duration !== 'number')) {
            errors.push({
              code: 'INVALID_SLEEP_STEP',
              message: `Sleep step must have a valid "duration" (string or number)`,
              step: stepPath.join('.'),
            });
          }
          break;
          
        case 'condition':
          if (typeof step.if !== 'function') {
            errors.push({
              code: 'INVALID_CONDITION_STEP',
              message: `Condition step must have an "if" function`,
              step: stepPath.join('.'),
            });
          }
          if (!Array.isArray(step.then)) {
            errors.push({
              code: 'INVALID_CONDITION_STEP',
              message: `Condition step must have a "then" array`,
              step: stepPath.join('.'),
            });
          }
          if (step.else && !Array.isArray(step.else)) {
            errors.push({
              code: 'INVALID_CONDITION_STEP',
              message: `Condition step "else" must be an array if provided`,
              step: stepPath.join('.'),
            });
          }
          // Validate nested steps
          if (Array.isArray(step.then)) {
            validateSteps(step.then, [...stepPath, 'then']);
          }
          if (Array.isArray(step.else)) {
            validateSteps(step.else, [...stepPath, 'else']);
          }
          break;
          
        case 'parallel':
          if (!Array.isArray(step.steps) || step.steps.length === 0) {
            errors.push({
              code: 'INVALID_PARALLEL_STEP',
              message: `Parallel step must have a non-empty "steps" array`,
              step: stepPath.join('.'),
            });
          }
          // Validate nested steps
          if (Array.isArray(step.steps)) {
            validateSteps(step.steps, [...stepPath, 'parallel']);
          }
          break;
      }
    }
  }
  
  // Validate root-level config
  if (!config.steps || !Array.isArray(config.steps)) {
    errors.push({
      code: 'INVALID_CONFIG',
      message: 'Config must have a "steps" array',
    });
    return errors; // Can't continue validation without steps
  }
  
  if (config.steps.length === 0) {
    errors.push({
      code: 'INVALID_CONFIG',
      message: 'Config must have at least one step',
    });
  }
  
  // Validate all steps
  validateSteps(config.steps);
  
  // Note: Circular dependency detection is complex for workflows
  // This would require analyzing workflow/agent calls recursively
  // For now, we validate structure and IDs only
  
  return errors;
}

/**
 * Check if orchestration config is valid.
 */
export function isValidOrchestrationConfig(config: OrchestrationConfig): boolean {
  return validateOrchestrationConfig(config).length === 0;
}
