import type {
  WorkflowInstance,
  HistoryEvent,
  Signal,
  Timer,
} from '../types.js';

/**
 * Pluggable storage driver interface for workflow persistence.
 */
export interface StorageDriver {
  // Instance management
  createInstance(
    workflowId: string,
    version: string,
    input: any,
  ): Promise<string>; // returns instanceId

  getInstance(instanceId: string): Promise<WorkflowInstance | null>;

  updateInstanceStatus(
    instanceId: string,
    status: WorkflowInstance['status'],
    metadata?: any,
  ): Promise<void>;

  // Event log
  appendEvents(instanceId: string, events: HistoryEvent[]): Promise<void>;
  getEvents(instanceId: string): Promise<HistoryEvent[]>;

  // Signals/HITL
  createSignal(
    instanceId: string,
    eventName: string,
    payload: any,
    token?: string,
  ): Promise<string>; // returns signalId

  getPendingSignals(instanceId: string): Promise<Signal[]>;
  markSignalProcessed(signalId: string): Promise<void>;

  // Timers
  createTimer(instanceId: string, fireAt: Date): Promise<string>; // returns timerId
  getDueTimers(): Promise<Timer[]>;
  deleteTimer(timerId: string): Promise<void>;

  // Querying
  listInstancesByStatus(
    status: WorkflowInstance['status'],
  ): Promise<WorkflowInstance[]>;
  listWaitingForEvent(eventName?: string): Promise<WorkflowInstance[]>;

  // Initialization
  initialize?(): Promise<void>;
  close?(): Promise<void>;
}

