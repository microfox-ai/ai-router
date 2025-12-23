import type { StorageDriver } from './storage/driver.js';
import type { CreatedWorkflow, CreatedStep } from '../workflow.js';
import type { HistoryEvent } from './types.js';
import {
  WorkflowContext,
  WorkflowSuspensionError,
  WorkflowCancellationError,
} from './context.js';
import { generateId } from 'ai';

/**
 * Core workflow execution engine with replay support.
 */
export class WorkflowEngine {
  /**
   * Execute a workflow instance with replay support.
   */
  async executeWorkflow<Input, Output>(
    workflow: CreatedWorkflow<Input, Output>,
    instanceId: string,
    input: Input,
    storage: StorageDriver,
  ): Promise<Output> {
    // Get event history
    const eventHistory = await storage.getEvents(instanceId);
    const replayMode = eventHistory.length > 0;

    // Get workflow start time from first event
    const startEvent = eventHistory.find((e) => e.type === 'WORKFLOW_STARTED');
    const workflowStartTime = startEvent
      ? new Date((startEvent as any).timestamp)
      : new Date();

    // Create context
    const ctx = new WorkflowContext<Input, Output>(
      instanceId,
      input,
      storage,
      replayMode,
      eventHistory,
      workflowStartTime,
    );

    try {
      // Execute workflow handler
      const result = await workflow.handler(ctx);

      // Record completion
      await storage.appendEvents(instanceId, [
        {
          type: 'WORKFLOW_COMPLETED',
          result,
          sequence: ctx._sequence,
        },
      ]);

      await storage.updateInstanceStatus(instanceId, 'COMPLETED', {
        result,
      });

      return result;
    } catch (error: any) {
      if (error instanceof WorkflowSuspensionError) {
        // Expected suspension - workflow will resume later
        throw error;
      }

      if (error instanceof WorkflowCancellationError) {
        await storage.appendEvents(instanceId, [
          {
            type: 'WORKFLOW_FAILED',
            error: error.reason || 'Cancelled',
            sequence: ctx._sequence,
          },
        ]);

        await storage.updateInstanceStatus(instanceId, 'CANCELLED', {
          reason: error.reason,
        });

        throw error;
      }

      // Unexpected error
      await storage.appendEvents(instanceId, [
        {
          type: 'WORKFLOW_FAILED',
          error: error?.message || String(error),
          sequence: ctx._sequence,
        },
      ]);

      await storage.updateInstanceStatus(instanceId, 'FAILED', {
        error: error?.message || String(error),
      });

      throw error;
    }
  }

  /**
   * Resume a suspended workflow (e.g., after signal or timer).
   */
  async resumeWorkflow<Input, Output>(
    workflow: CreatedWorkflow<Input, Output>,
    instanceId: string,
    storage: StorageDriver,
  ): Promise<Output> {
    const instance = await storage.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Workflow instance ${instanceId} not found`);
    }

    if (instance.status !== 'SUSPENDED') {
      throw new Error(
        `Cannot resume workflow in status: ${instance.status}`,
      );
    }

    // Update status to RUNNING
    await storage.updateInstanceStatus(instanceId, 'RUNNING');

    // Execute with replay
    return this.executeWorkflow(workflow, instanceId, instance.input, storage);
  }

  /**
   * Process a signal for a waiting workflow.
   */
  async processSignal(
    instanceId: string,
    eventName: string,
    payload: any,
    storage: StorageDriver,
    token?: string,
  ): Promise<void> {
    const instance = await storage.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Workflow instance ${instanceId} not found`);
    }

    if (instance.status !== 'SUSPENDED' || instance.waitingForEvent !== eventName) {
      throw new Error(
        `Workflow is not waiting for event: ${eventName}`,
      );
    }

    // Find the waiting event to get schema
    const events = await storage.getEvents(instanceId);
    const waitingEvent = events
      .reverse()
      .find(
        (e) =>
          e.type === 'EVENT_WAITING' &&
          (e as any).eventName === eventName,
      ) as any;

    // Validate payload if schema provided
    if (waitingEvent?.schema) {
      waitingEvent.schema.parse(payload);
    }

    // Record event received
    const sequence = events.length;
    await storage.appendEvents(instanceId, [
      {
        type: 'EVENT_RECEIVED',
        eventName,
        payload,
        sequence,
      },
    ]);

    // Mark any pending signals as processed
    const pendingSignals = await storage.getPendingSignals(instanceId);
    for (const signal of pendingSignals) {
      if (signal.eventName === eventName) {
        await storage.markSignalProcessed(signal.id);
      }
    }
  }

  /**
   * Process due timers and resume workflows.
   */
  async processDueTimers(
    workflows: Map<string, CreatedWorkflow<any, any>>,
    storage: StorageDriver,
  ): Promise<void> {
    const dueTimers = await storage.getDueTimers();

    for (const timer of dueTimers) {
      const instance = await storage.getInstance(timer.instanceId);
      if (!instance) {
        continue;
      }

      // Find the workflow
      const workflow = workflows.get(`${instance.workflowId}:${instance.version}`);
      if (!workflow) {
        continue;
      }

      // Check if this is a sleep completion or timeout
      const events = await storage.getEvents(timer.instanceId);
      const lastWaitingEvent = events
        .reverse()
        .find((e) => e.type === 'EVENT_WAITING') as any;

      if (lastWaitingEvent) {
        // This is a timeout for waitForEvent
        // Record timeout event
        await storage.appendEvents(timer.instanceId, [
          {
            type: 'EVENT_RECEIVED',
            eventName: lastWaitingEvent.eventName,
            payload: { timeout: true },
            sequence: events.length,
          },
        ]);
      } else {
        // This is a sleep completion
        const lastSleepEvent = events
          .reverse()
          .find((e) => e.type === 'SLEEP_STARTED') as any;
        if (lastSleepEvent) {
          await storage.appendEvents(timer.instanceId, [
            {
              type: 'SLEEP_COMPLETED',
              sequence: events.length,
            },
          ]);
        }
      }

      // Delete timer
      await storage.deleteTimer(timer.id);

      // Resume workflow
      try {
        await this.resumeWorkflow(workflow, timer.instanceId, storage);
      } catch (error: any) {
        if (error instanceof WorkflowSuspensionError) {
          // Expected - workflow suspended again
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * Check if a function has "use workflow" directive.
   */
  static hasWorkflowDirective(fn: Function): boolean {
    const source = fn.toString();
    return (
      source.includes('"use workflow"') ||
      source.includes("'use workflow'") ||
      source.includes('`use workflow`')
    );
  }

  /**
   * Check if a function has "use step" directive.
   */
  static hasStepDirective(fn: Function): boolean {
    const source = fn.toString();
    return (
      source.includes('"use step"') ||
      source.includes("'use step'") ||
      source.includes('`use step`')
    );
  }
}

