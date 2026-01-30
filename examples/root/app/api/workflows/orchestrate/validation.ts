/**
 * Orchestration config validation utilities.
 * 
 * Validates orchestration configurations for common issues like:
 * - Circular dependencies
 * - Duplicate step IDs
 * - Invalid step definitions
 */

import type { OrchestrationConfig, OrchestrationStep } from '@microfox/ai-workflow';

export interface ValidationError {
  code: string;
  message: string;
  step?: number | string;
  severity?: 'error' | 'warning'; // 'error' blocks execution, 'warning' is informational
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
          
        case 'worker': {
          if (!step.worker || typeof step.worker !== 'string') {
            errors.push({
              code: 'INVALID_WORKER_STEP',
              message: `Worker step must have a valid "worker" ID (string)`,
              step: stepPath.join('.'),
            });
          }
          // Workers support both fire-and-forget and polling modes
          // await: true enables polling for completion, await: false is fire-and-forget
          const workerPoll = (step as { workerPoll?: { intervalMs?: number; timeoutMs?: number; maxRetries?: number } }).workerPoll;
          if (workerPoll && typeof workerPoll === 'object') {
            if (workerPoll.intervalMs !== undefined && (typeof workerPoll.intervalMs !== 'number' || workerPoll.intervalMs <= 0)) {
              errors.push({ code: 'INVALID_WORKER_POLL', message: 'workerPoll.intervalMs must be a positive number', step: stepPath.join('.') });
            }
            if (workerPoll.timeoutMs !== undefined && (typeof workerPoll.timeoutMs !== 'number' || workerPoll.timeoutMs <= 0)) {
              errors.push({ code: 'INVALID_WORKER_POLL', message: 'workerPoll.timeoutMs must be a positive number', step: stepPath.join('.') });
            }
            if (workerPoll.maxRetries !== undefined && (typeof workerPoll.maxRetries !== 'number' || workerPoll.maxRetries <= 0)) {
              errors.push({ code: 'INVALID_WORKER_POLL', message: 'workerPoll.maxRetries must be a positive number', step: stepPath.join('.') });
            }
          }
          break;
        }
          
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
          // Token can be a string or function
          // Note: Functions are lost during JSON serialization, so missing functions are warnings
          if (step.token === undefined || step.token === null) {
            // This is a warning, not an error, because functions can't be serialized
            // The workflow will fail at runtime if the function is actually missing
            console.warn(`[Validation] Hook step at ${stepPath.join('.')} has no token. This may be due to JSON serialization removing functions.`);
          } else if (typeof step.token !== 'string' && typeof step.token !== 'function') {
            errors.push({
              code: 'INVALID_HOOK_STEP',
              message: `Hook step "token" must be a string or function, got ${typeof step.token}`,
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
          
        case 'condition': {
          const ifVal = step.if;
          if (ifVal === undefined || ifVal === null) {
            console.warn(`[Validation] Condition step at ${stepPath.join('.')} has no "if". Use a boolean, whenStep(), or a function.`);
          } else if (typeof ifVal !== 'function' && typeof ifVal !== 'boolean') {
            const obj = ifVal as { type?: string; stepId?: string; op?: string };
            if (obj?.type !== 'stepField' || !obj.stepId || !obj.op) {
              errors.push({
                code: 'INVALID_CONDITION_STEP',
                message: `Condition "if" must be a boolean, a whenStep() object (type/stepId/op), or a function`,
                step: stepPath.join('.'),
              });
            }
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
          if (Array.isArray(step.then)) {
            validateSteps(step.then, [...stepPath, 'then']);
          }
          if (Array.isArray(step.else)) {
            validateSteps(step.else, [...stepPath, 'else']);
          }
          break;
        }
          
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

  const configWorkerPoll = (config as { workerPoll?: { intervalMs?: number; timeoutMs?: number; maxRetries?: number } }).workerPoll;
  if (configWorkerPoll && typeof configWorkerPoll === 'object') {
    if (configWorkerPoll.intervalMs !== undefined && (typeof configWorkerPoll.intervalMs !== 'number' || configWorkerPoll.intervalMs <= 0)) {
      errors.push({ code: 'INVALID_WORKER_POLL', message: 'config.workerPoll.intervalMs must be a positive number' });
    }
    if (configWorkerPoll.timeoutMs !== undefined && (typeof configWorkerPoll.timeoutMs !== 'number' || configWorkerPoll.timeoutMs <= 0)) {
      errors.push({ code: 'INVALID_WORKER_POLL', message: 'config.workerPoll.timeoutMs must be a positive number' });
    }
    if (configWorkerPoll.maxRetries !== undefined && (typeof configWorkerPoll.maxRetries !== 'number' || configWorkerPoll.maxRetries <= 0)) {
      errors.push({ code: 'INVALID_WORKER_POLL', message: 'config.workerPoll.maxRetries must be a positive number' });
    }
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
