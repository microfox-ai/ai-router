import type { ZodTypeAny } from 'zod';

/**
 * Event log entry types for durable workflow execution.
 */
export type HistoryEvent =
  | { type: 'WORKFLOW_STARTED'; input: any; timestamp: number }
  | { type: 'STEP_SCHEDULED'; stepId: string; input: any; sequence: number }
  | { type: 'STEP_COMPLETED'; stepId: string; output: any; sequence: number }
  | { type: 'STEP_FAILED'; stepId: string; error: any; sequence: number }
  | { type: 'SLEEP_STARTED'; duration: string; deadline: number; sequence: number }
  | { type: 'SLEEP_COMPLETED'; sequence: number }
  | {
      type: 'EVENT_WAITING';
      eventName: string;
      schema?: ZodTypeAny;
      ui?: WorkflowUI;
      timeout?: string;
      sequence: number;
    }
  | { type: 'EVENT_RECEIVED'; eventName: string; payload: any; sequence: number }
  | { type: 'WORKFLOW_COMPLETED'; result: any; sequence: number }
  | { type: 'WORKFLOW_FAILED'; error: any; sequence: number };

/**
 * UI metadata for HITL workflows.
 */
export interface WorkflowUI {
  title: string;
  description?: string;
  components?: Array<{
    type: 'text' | 'input' | 'button' | 'markdown';
    [key: string]: any;
  }>;
}

/**
 * Workflow instance status.
 */
export type WorkflowInstanceStatus =
  | 'RUNNING'
  | 'SUSPENDED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/**
 * Workflow instance record.
 */
export interface WorkflowInstance {
  id: string;
  workflowId: string;
  version: string;
  status: WorkflowInstanceStatus;
  input: any;
  result?: any;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  waitingForEvent?: string;
  waitingForUI?: WorkflowUI;
}

/**
 * Signal record for HITL.
 */
export interface Signal {
  id: string;
  instanceId: string;
  eventName: string;
  payload: any;
  token?: string;
  processed: boolean;
  createdAt: Date;
}

/**
 * Timer record for sleep functionality.
 */
export interface Timer {
  id: string;
  instanceId: string;
  fireAt: Date;
  createdAt: Date;
}

