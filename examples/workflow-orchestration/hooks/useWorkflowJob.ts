'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type WorkflowJobStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'partial';

export interface WorkerJobResult {
  jobId: string;
  workerId: string;
  status: string;
  output?: unknown;
  error?: { message: string; stack?: string };
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
}

export interface QueueJobStep {
  workerId: string;
  workerJobId: string;
  status: string;
  input?: unknown;
  output?: unknown;
  error?: { message: string };
  startedAt?: string;
  completedAt?: string;
}

export interface QueueJobResult {
  id: string;
  queueId: string;
  status: string;
  steps: QueueJobStep[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface QueueHitlTask {
  taskId: string;
  queueJobId: string;
  queueId: string;
  stepIndex: number;
  workerId: string;
  status: 'awaiting_input' | 'approved' | 'rejected' | 'expired';
  progress?: {
    completedSteps: number;
    totalSteps: number;
    percent: number;
  };
  previousOutputs?: Array<{
    stepIndex: number;
    workerId: string;
    output: unknown;
  }>;
  uiSpec?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  contextSnapshot?: Record<string, unknown>;
}

export type QueueHitlDecisionPayload = {
  decision: 'approve' | 'reject';
  input?: Record<string, unknown>;
  comment?: string;
  reviewerId?: string;
};

export type WorkflowJobOutput = WorkerJobResult | QueueJobResult;

export interface UseWorkflowJobBaseOptions {
  /** Base URL for API calls (default: '' for relative, or set window.location.origin) */
  baseUrl?: string;
  /** Poll interval in ms (default: 2000) */
  pollIntervalMs?: number;
  /** Stop polling after this many ms (default: 300000 = 5 min) */
  pollTimeoutMs?: number;
  /** Start polling automatically after trigger (default: true) */
  autoPoll?: boolean;
  /** Called when job reaches completed (or queue: completed/partial) */
  onComplete?: (result: WorkflowJobOutput) => void;
  /** Called when job fails or trigger/poll errors */
  onError?: (error: Error) => void;
  /** If false, trigger is a no-op and auto-poll is skipped (default: true) */
  enabled?: boolean;
}

export interface UseWorkflowJobWorkerOptions extends UseWorkflowJobBaseOptions {
  type: 'worker';
  workerId: string;
}

export interface UseWorkflowJobQueueOptions extends UseWorkflowJobBaseOptions {
  type: 'queue';
  queueId: string;
  /** Optional metadata for queue trigger */
  metadata?: Record<string, unknown>;
}

export type UseWorkflowJobOptions =
  | UseWorkflowJobWorkerOptions
  | UseWorkflowJobQueueOptions;

const TERMINAL_STATUSES = ['completed', 'failed', 'partial'];

function getBaseUrl(baseUrl?: string): string {
  if (baseUrl !== undefined && baseUrl !== '') return baseUrl;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

export interface UseWorkflowJobReturn {
  /** Trigger the worker or queue. Pass input for the job. */
  trigger: (input?: Record<string, unknown>) => Promise<void>;
  /** Current job/queue job id (after trigger) */
  jobId: string | null;
  /** Current status: idle | queued | running | completed | failed | partial */
  status: WorkflowJobStatus;
  /** Last job output (worker or queue job object) */
  output: WorkflowJobOutput | null;
  /** Error from trigger or from job failure */
  error: Error | null;
  /** True while the trigger request is in flight */
  loading: boolean;
  /** True while polling for job status */
  polling: boolean;
  /** Reset state so you can trigger again */
  reset: () => void;
  /**
   * Derived HITL task from queue output when a step is awaiting approval.
   * Undefined when not in HITL wait state.
   */
  hitlTask?: QueueHitlTask | null;
  /**
   * Submit approval/rejection and optional reviewer input for HITL queue steps.
   */
  submitHitlDecision?: (payload: QueueHitlDecisionPayload) => Promise<void>;
}

export function useWorkflowJob(
  options: UseWorkflowJobWorkerOptions
): UseWorkflowJobReturn & { output: WorkerJobResult | null };
export function useWorkflowJob(
  options: UseWorkflowJobQueueOptions
): UseWorkflowJobReturn & { output: QueueJobResult | null };
export function useWorkflowJob(
  options: UseWorkflowJobOptions
): UseWorkflowJobReturn {
  const {
    baseUrl: baseUrlOpt,
    pollIntervalMs = 2000,
    pollTimeoutMs = 300_000,
    autoPoll = true,
    onComplete,
    onError,
    enabled = true,
  } = options;

  const baseUrl = getBaseUrl(baseUrlOpt);
  const prefix = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
  const api = (path: string) => `${prefix}/api/workflows${path}`;

  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<WorkflowJobStatus>('idle');
  const [output, setOutput] = useState<WorkflowJobOutput | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);

  const deriveHitlTask = useCallback((job: QueueJobResult | null): QueueHitlTask | null => {
    if (!job || !Array.isArray(job.steps)) return null;
    const waitingStepIndex = job.steps.findIndex((s) => s.status === 'awaiting_approval');
    if (waitingStepIndex < 0) return null;
    const waitingStep = job.steps[waitingStepIndex];
    const previousOutputs = job.steps
      .slice(0, waitingStepIndex)
      .map((s, idx) => ({ stepIndex: idx, workerId: s.workerId, output: s.output }));
    const completedSteps = job.steps.filter((s) => s.status === 'completed').length;
    const totalSteps = job.steps.length;
    const percent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
    const meta = (job.metadata ?? {}) as Record<string, any>;
    return {
      taskId: String(meta.hitlTaskId ?? `${job.id}:${waitingStepIndex}`),
      queueJobId: job.id,
      queueId: job.queueId,
      stepIndex: waitingStepIndex,
      workerId: waitingStep.workerId,
      status: 'awaiting_input',
      progress: { completedSteps, totalSteps, percent },
      previousOutputs,
      uiSpec: (waitingStep.input as any)?.hitl?.uiSpec ?? meta.hitlUiSpec ?? {},
      inputSchema: (waitingStep.input as any)?.hitl?.inputSchema ?? meta.hitlInputSchema ?? {},
      contextSnapshot: (waitingStep.input as any)?.hitl?.contextSnapshot ?? meta.hitlContextSnapshot ?? {},
    };
  }, []);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setPolling(false);
  }, []);

  const reset = useCallback(() => {
    clearPolling();
    setJobId(null);
    setStatus('idle');
    setOutput(null);
    setError(null);
    setLoading(false);
    setPolling(false);
  }, [clearPolling]);

  const trigger = useCallback(
    async (input?: Record<string, unknown>) => {
      if (!enabled) return;

      setError(null);
      setOutput(null);
      setLoading(true);

      try {
        if (options.type === 'worker') {
          const res = await fetch(api(`/workers/${options.workerId}`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: input ?? {}, await: false }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
          const id = data.jobId ?? null;
          if (!id) throw new Error('No jobId in response');
          setJobId(id);
          setStatus('queued');
          setLoading(false);

          if (autoPoll) {
            setPolling(true);
            const deadline = Date.now() + pollTimeoutMs;
            const poll = async () => {
              if (!mountedRef.current) return;
              try {
                const r = await fetch(
                  api(`/workers/${options.workerId}/${id}`)
                );
                const job = await r.json();
                if (!r.ok) {
                  if (Date.now() >= deadline) {
                    clearPolling();
                    const err = new Error('Poll timeout');
                    setError(err);
                    setStatus('failed');
                    onError?.(err);
                  }
                  return;
                }
                setStatus((job.status as WorkflowJobStatus) ?? 'running');
                setOutput(job as WorkerJobResult);
                if (job.status === 'completed') {
                  clearPolling();
                  onComplete?.(job as WorkerJobResult);
                } else if (job.status === 'failed') {
                  clearPolling();
                  const err = new Error(
                    job?.error?.message ?? 'Job failed'
                  );
                  setError(err);
                  setStatus('failed');
                  onError?.(err);
                } else if (Date.now() >= deadline) {
                  clearPolling();
                  const err = new Error('Poll timeout');
                  setError(err);
                  onError?.(err);
                }
              } catch (e) {
                if (mountedRef.current) {
                  clearPolling();
                  const err = e instanceof Error ? e : new Error(String(e));
                  setError(err);
                  setStatus('failed');
                  onError?.(err);
                }
              }
            };
            await poll();
            intervalRef.current = setInterval(poll, pollIntervalMs);
            timeoutRef.current = setTimeout(() => {
              clearPolling();
              setError(new Error('Poll timeout'));
              setStatus('failed');
            }, pollTimeoutMs);
          }
        } else {
          const body: Record<string, unknown> = {
            input: input ?? {},
          };
          if (options.metadata) body.metadata = options.metadata;
          const res = await fetch(api(`/queues/${options.queueId}`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
          const id = data.jobId ?? null;
          if (!id) throw new Error('No jobId in response');
          setJobId(id);
          setStatus('queued');
          setLoading(false);

          if (autoPoll) {
            setPolling(true);
            // Deadline resets on each awaiting_approval poll — timeout only counts
            // active processing time, not time spent waiting for human decisions.
            let deadline = Date.now() + pollTimeoutMs;
            let intervalId: ReturnType<typeof setInterval> | null = null;
            const terminalHitRef = { current: false };

            const clearThisPolling = () => {
              if (intervalId != null) {
                clearInterval(intervalId);
                if (intervalRef.current === intervalId) intervalRef.current = null;
              }
              if (timeoutRef.current != null) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
              }
              setPolling(false);
            };

            const poll = async () => {
              if (!mountedRef.current) return;
              try {
                const r = await fetch(
                  api(`/queues/${options.queueId}/${id}`)
                );
                const job = await r.json();
                if (!r.ok) {
                  if (Date.now() >= deadline) {
                    clearThisPolling();
                    setError(new Error('Poll timeout'));
                    setStatus('failed');
                  }
                  return;
                }
                const st = (job.status as string) ?? 'running';
                setStatus(st as WorkflowJobStatus);
                setOutput(job as QueueJobResult);
                if (TERMINAL_STATUSES.includes(st)) {
                  terminalHitRef.current = true;
                  clearThisPolling();
                  onComplete?.(job as QueueJobResult);
                  if (st === 'failed') {
                    setError(new Error('Queue job failed'));
                    onError?.(new Error('Queue job failed'));
                  }
                } else if (st === 'awaiting_approval') {
                  // Reset the deadline while waiting for human input — the timeout
                  // should only count active processing time, not human decision time.
                  deadline = Date.now() + pollTimeoutMs;
                } else if (Date.now() >= deadline) {
                  clearThisPolling();
                  setError(new Error('Poll timeout'));
                  setStatus('failed');
                }
              } catch (e) {
                if (mountedRef.current) {
                  clearThisPolling();
                  const err = e instanceof Error ? e : new Error(String(e));
                  setError(err);
                  setStatus('failed');
                  onError?.(err);
                }
              }
            };
            await poll();
            if (terminalHitRef.current) return;
            intervalId = setInterval(() => void poll(), pollIntervalMs);
            intervalRef.current = intervalId;
          }
        }
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        setStatus('failed');
        setLoading(false);
        onError?.(err);
      }
    },
    [
      enabled,
      options,
      api,
      autoPoll,
      pollIntervalMs,
      pollTimeoutMs,
      onComplete,
      onError,
      clearPolling,
    ]
  );

  const submitHitlDecision = useCallback(
    async (payload: QueueHitlDecisionPayload) => {
      if (options.type !== 'queue' || !jobId) {
        throw new Error('submitHitlDecision is only available for queue jobs');
      }
      const response = await fetch(api(`/queues/${options.queueId}/approve`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queueJobId: jobId,
          ...payload,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed to submit HITL decision (${response.status})`);
      }
    },
    [options, jobId, api]
  );

  const hitlTask =
    options.type === 'queue'
      ? deriveHitlTask((output && 'steps' in output ? (output as QueueJobResult) : null))
      : null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearPolling();
    };
  }, [clearPolling]);

  return {
    trigger,
    jobId,
    status,
    output,
    error,
    loading,
    polling,
    reset,
    ...(options.type === 'queue'
      ? {
          hitlTask,
          submitHitlDecision,
        }
      : {}),
  };
}
