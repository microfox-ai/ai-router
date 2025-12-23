import type { StorageDriver } from './driver.js';
import type {
  WorkflowInstance,
  HistoryEvent,
  Signal,
  Timer,
} from '../types.js';
import { generateId } from 'ai';

/**
 * In-memory storage driver for development and testing.
 * Not suitable for production - data is lost on process restart.
 */
export class MemoryStorageDriver implements StorageDriver {
  private instances = new Map<string, WorkflowInstance>();
  private events = new Map<string, HistoryEvent[]>();
  private signals = new Map<string, Signal>();
  private timers = new Map<string, Timer>();

  async createInstance(
    workflowId: string,
    version: string,
    input: any,
  ): Promise<string> {
    const instanceId = generateId();
    const now = new Date();

    const instance: WorkflowInstance = {
      id: instanceId,
      workflowId,
      version,
      status: 'RUNNING',
      input,
      createdAt: now,
      updatedAt: now,
    };

    this.instances.set(instanceId, instance);
    this.events.set(instanceId, []);

    await this.appendEvents(instanceId, [
      {
        type: 'WORKFLOW_STARTED',
        input,
        timestamp: now.getTime(),
      },
    ]);

    return instanceId;
  }

  async getInstance(instanceId: string): Promise<WorkflowInstance | null> {
    return this.instances.get(instanceId) || null;
  }

  async updateInstanceStatus(
    instanceId: string,
    status: WorkflowInstance['status'],
    metadata?: any,
  ): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    instance.status = status;
    instance.updatedAt = new Date();
    if (metadata) {
      instance.metadata = { ...(instance.metadata || {}), ...metadata };
      if (metadata.waitingForEvent) {
        instance.waitingForEvent = metadata.waitingForEvent;
      }
      if (metadata.waitingForUI) {
        instance.waitingForUI = metadata.waitingForUI;
      }
      if (metadata.result !== undefined) {
        instance.result = metadata.result;
      }
    }
  }

  async appendEvents(
    instanceId: string,
    events: HistoryEvent[],
  ): Promise<void> {
    const existing = this.events.get(instanceId) || [];
    const eventList = [...existing, ...events];
    this.events.set(instanceId, eventList);
  }

  async getEvents(instanceId: string): Promise<HistoryEvent[]> {
    return this.events.get(instanceId) || [];
  }

  async createSignal(
    instanceId: string,
    eventName: string,
    payload: any,
    token?: string,
  ): Promise<string> {
    const signalId = generateId();
    const signal: Signal = {
      id: signalId,
      instanceId,
      eventName,
      payload,
      token,
      processed: false,
      createdAt: new Date(),
    };
    this.signals.set(signalId, signal);
    return signalId;
  }

  async getPendingSignals(instanceId: string): Promise<Signal[]> {
    return Array.from(this.signals.values()).filter(
      (s) => s.instanceId === instanceId && !s.processed,
    );
  }

  async markSignalProcessed(signalId: string): Promise<void> {
    const signal = this.signals.get(signalId);
    if (signal) {
      signal.processed = true;
    }
  }

  async createTimer(instanceId: string, fireAt: Date): Promise<string> {
    const timerId = generateId();
    const timer: Timer = {
      id: timerId,
      instanceId,
      fireAt,
      createdAt: new Date(),
    };
    this.timers.set(timerId, timer);
    return timerId;
  }

  async getDueTimers(): Promise<Timer[]> {
    const now = new Date();
    return Array.from(this.timers.values()).filter(
      (t) => t.fireAt <= now,
    );
  }

  async deleteTimer(timerId: string): Promise<void> {
    this.timers.delete(timerId);
  }

  async listInstancesByStatus(
    status: WorkflowInstance['status'],
  ): Promise<WorkflowInstance[]> {
    return Array.from(this.instances.values()).filter(
      (i) => i.status === status,
    );
  }

  async listWaitingForEvent(eventName?: string): Promise<WorkflowInstance[]> {
    return Array.from(this.instances.values()).filter((i) => {
      if (i.status !== 'SUSPENDED' || !i.waitingForEvent) {
        return false;
      }
      if (eventName) {
        return i.waitingForEvent === eventName;
      }
      return true;
    });
  }
}

