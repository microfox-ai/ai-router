import type { StorageDriver } from './storage/driver.js';
import type { HistoryEvent, WorkflowUI } from './types.js';
import type { CreatedStep } from '../workflow.js';
import type { ZodTypeAny } from 'zod';
import { z } from 'zod';
import { generateId } from 'ai';

/**
 * Parse duration string (e.g., "1h", "30m", "2d") to milliseconds.
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}

/**
 * Seeded PRNG for deterministic random numbers.
 */
class SeededRandom {
  private seed: number;

  constructor(seed: string) {
    // Simple hash function to convert string to number
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      const char = seed.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    this.seed = Math.abs(hash) || 1;
  }

  next(): number {
    // Linear congruential generator
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
}

/**
 * WorkflowContext provides durable primitives for workflow execution.
 */
export class WorkflowContext<Input, Output> {
  public input: Input;
  public metadata?: Record<string, any>;

  // Internal state
  public _instanceId: string;
  public _storage: StorageDriver;
  public _replayMode: boolean;
  public _eventHistory: HistoryEvent[];
  public _sequence: number;
  public _workflowStartTime: Date;
  public _random: SeededRandom;

  constructor(
    instanceId: string,
    input: Input,
    storage: StorageDriver,
    replayMode: boolean,
    eventHistory: HistoryEvent[],
    workflowStartTime: Date,
  ) {
    this._instanceId = instanceId;
    this.input = input;
    this._storage = storage;
    this._replayMode = replayMode;
    this._eventHistory = eventHistory;
    this._sequence = eventHistory.length;
    this._workflowStartTime = workflowStartTime;
    this._random = new SeededRandom(`${instanceId}-${this._sequence}`);
  }

  /**
   * Execute a step with replay support.
   */
  async run<StepInput, StepOutput>(
    step: CreatedStep<StepInput, StepOutput>,
    input: StepInput,
  ): Promise<StepOutput> {
    const stepId = step.id;
    const sequence = this._sequence++;

    // Check replay mode first
    if (this._replayMode) {
      const completedEvent = this._eventHistory.find(
        (e) =>
          e.type === 'STEP_COMPLETED' &&
          (e as any).stepId === stepId &&
          (e as any).sequence === sequence,
      );

      if (completedEvent) {
        return (completedEvent as any).output;
      }

      const failedEvent = this._eventHistory.find(
        (e) =>
          e.type === 'STEP_FAILED' &&
          (e as any).stepId === stepId &&
          (e as any).sequence === sequence,
      );

      if (failedEvent) {
        throw new Error((failedEvent as any).error);
      }
    }

    // Validate input
    const validatedInput = step.inputSchema.parse(input) as StepInput;

    // Record step scheduled
    await this._storage.appendEvents(this._instanceId, [
      {
        type: 'STEP_SCHEDULED',
        stepId,
        input: validatedInput,
        sequence,
      },
    ]);

    // Execute step with retries
    const maxAttempts = step.retry?.maxAttempts || 3;
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const output = await step.run(validatedInput, { attempt }) as StepOutput;

        // Validate output if schema provided
        const validatedOutput = (step.outputSchema
          ? step.outputSchema.parse(output)
          : output) as StepOutput;

        // Record success
        await this._storage.appendEvents(this._instanceId, [
          {
            type: 'STEP_COMPLETED',
            stepId,
            output: validatedOutput,
            sequence,
          },
        ]);

        return validatedOutput;
      } catch (error: any) {
        lastError = error;

        if (attempt < maxAttempts) {
          // Exponential backoff
          const delay = step.retry?.backoff === 'exponential'
            ? Math.pow(2, attempt - 1) * 1000
            : 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed
    await this._storage.appendEvents(this._instanceId, [
      {
        type: 'STEP_FAILED',
        stepId,
        error: lastError?.message || String(lastError),
        sequence,
      },
    ]);

    throw lastError;
  }

  /**
   * Durable sleep primitive.
   */
  async sleep(duration: string): Promise<void> {
    const sequence = this._sequence++;
    const ms = parseDuration(duration);
    const deadline = Date.now() + ms;

    // Check replay mode
    if (this._replayMode) {
      const completedEvent = this._eventHistory.find(
        (e) =>
          e.type === 'SLEEP_COMPLETED' && (e as any).sequence === sequence,
      );
      if (completedEvent) {
        return;
      }
    }

    // Record sleep started
    await this._storage.appendEvents(this._instanceId, [
      {
        type: 'SLEEP_STARTED',
        duration,
        deadline,
        sequence,
      },
    ]);

    // Create timer
    await this._storage.createTimer(this._instanceId, new Date(deadline));

    // Suspend workflow
    await this._storage.updateInstanceStatus(this._instanceId, 'SUSPENDED', {
      reason: 'TIMER',
    });

    // Throw suspension exception (will be caught by engine)
    throw new WorkflowSuspensionError('SLEEP', { deadline });
  }

  /**
   * Wait for HITL event with schema validation and UI metadata.
   */
  async waitForEvent<Payload = any>(
    eventName: string,
    options?: {
      timeout?: string;
      schema?: ZodTypeAny;
      ui?: WorkflowUI;
    },
  ): Promise<Payload> {
    const sequence = this._sequence++;

    // Check replay mode
    if (this._replayMode) {
      const receivedEvent = this._eventHistory.find(
        (e) =>
          e.type === 'EVENT_RECEIVED' &&
          (e as any).eventName === eventName &&
          (e as any).sequence === sequence,
      );
      if (receivedEvent) {
        return (receivedEvent as any).payload;
      }
    }

    // Generate resumption token
    const token = generateId();

    // Record event waiting
    await this._storage.appendEvents(this._instanceId, [
      {
        type: 'EVENT_WAITING',
        eventName,
        schema: options?.schema,
        ui: options?.ui,
        timeout: options?.timeout,
        sequence,
      },
    ]);

    // Update instance status
    await this._storage.updateInstanceStatus(this._instanceId, 'SUSPENDED', {
      reason: 'WAITING_FOR_EVENT',
      waitingForEvent: eventName,
      waitingForUI: options?.ui,
      token,
    });

    // If timeout specified, create timer
    if (options?.timeout) {
      const timeoutMs = parseDuration(options.timeout);
      const timeoutDeadline = Date.now() + timeoutMs;
      await this._storage.createTimer(
        this._instanceId,
        new Date(timeoutDeadline),
      );
    }

    // Throw suspension exception
    throw new WorkflowSuspensionError('WAIT_FOR_EVENT', {
      eventName,
      token,
      timeout: options?.timeout,
    });
  }

  /**
   * Deterministic random number generator.
   */
  random(): number {
    return this._random.next();
  }

  /**
   * Deterministic time based on workflow start.
   */
  now(): Date {
    // Return workflow start time + elapsed steps (deterministic)
    // In a real implementation, you'd track actual elapsed time from events
    return new Date(this._workflowStartTime.getTime() + this._sequence * 1000);
  }

  /**
   * Complete the workflow with a result.
   */
  complete(result: Output): Output {
    // This will be handled by the engine after handler returns
    return result;
  }

  /**
   * Cancel the workflow.
   */
  cancel(reason?: string): void {
    throw new WorkflowCancellationError(reason);
  }
}

/**
 * Exception thrown when workflow suspends (sleep or waitForEvent).
 */
export class WorkflowSuspensionError extends Error {
  constructor(
    public reason: 'SLEEP' | 'WAIT_FOR_EVENT',
    public metadata?: any,
  ) {
    super(`Workflow suspended: ${reason}`);
    this.name = 'WorkflowSuspensionError';
  }
}

/**
 * Exception thrown when workflow is cancelled.
 */
export class WorkflowCancellationError extends Error {
  constructor(public reason?: string) {
    super(reason || 'Workflow cancelled');
    this.name = 'WorkflowCancellationError';
  }
}

