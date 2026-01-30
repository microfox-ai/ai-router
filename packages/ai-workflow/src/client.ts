/**
 * Client functions for workflow orchestration
 *
 * Type-safe, config-first API. Pass workflow config directly (no directory structure).
 */

import { prepareOrchestrationConfig, type OrchestrationConfig } from './orchestrate.js';

export type { OrchestrationConfig };

export interface OrchestrateOptions {
  /** Workflow config (pure object or from prepareOrchestrationConfig). Required. */
  config: OrchestrationConfig;
  /** Unique execution id for this run (client-provided). */
  executionId: string;
  /** Map of hook step id -> token override. */
  hookTokens?: Record<string, string>;
  /** Initial workflow input (merged with config.input). */
  input?: any;
  /** Initial messages. */
  messages?: any[];
}

export interface OrchestrateResponse {
  runId: string;
  status: string;
  result?: any;
  hook?: { token?: string };
}

export interface WorkflowStatus {
  runId: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  hook?: { token?: string | null };
  hookToken?: string | null;
  error?: any;
  result?: any;
  metadata?: {
    stepCount?: number;
    baseUrl?: string;
    workflowId?: string;
  };
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
}

export interface ResumeHookOptions {
  token: string;
  payload: any;
}

/**
 * Start an orchestration workflow
 *
 * @param apiBaseUrl - Base URL of your app (e.g. 'http://localhost:3000' or 'https://your-app.vercel.app')
 * @param options - config, executionId, optional hookTokens, input, messages
 * @returns runId, status, optional result
 */
export async function orchestrate(
  apiBaseUrl: string,
  options: OrchestrateOptions,
): Promise<OrchestrateResponse> {
  const base = apiBaseUrl.replace(/\/+$/, '');
  const response = await fetch(`${base}/api/workflows/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: options.config,
      executionId: options.executionId,
      hookTokens: options.hookTokens ?? {},
      input: options.input ?? {},
      messages: options.messages ?? [],
    }),
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as {
      error?: string | { message?: string };
    };
    const msg =
      typeof err.error === 'string'
        ? err.error
        : err.error?.message ?? 'Failed to start orchestration';
    throw new Error(msg);
  }

  return response.json();
}

/**
 * Get workflow status by runId
 *
 * @param apiBaseUrl - Base URL of your app
 * @param runId - Run id from orchestrate()
 */
export async function getWorkflowStatus(
  apiBaseUrl: string,
  runId: string,
): Promise<WorkflowStatus> {
  const base = apiBaseUrl.replace(/\/+$/, '');
  const response = await fetch(`${base}/api/workflows/orchestrate/${runId}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as {
      error?: string | { message?: string };
    };
    const msg =
      typeof err.error === 'string'
        ? err.error
        : err.error?.message ?? 'Failed to get workflow status';
    throw new Error(msg);
  }

  const data = (await response.json()) as WorkflowStatus;
  if (data.hook?.token != null) data.hookToken = data.hook.token;
  return data;
}

/**
 * Resume a paused workflow (HITL)
 *
 * @param apiBaseUrl - Base URL of your app
 * @param options - token (required), payload (required)
 */
export async function resumeHook(
  apiBaseUrl: string,
  options: ResumeHookOptions,
): Promise<{ success: boolean }> {
  const base = apiBaseUrl.replace(/\/+$/, '');
  const response = await fetch(`${base}/api/workflows/orchestrate/signal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: options.token,
      payload: options.payload,
    }),
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as {
      error?: string | { message?: string };
    };
    const msg =
      typeof err.error === 'string'
        ? err.error
        : err.error?.message ?? 'Failed to resume hook';
    throw new Error(msg);
  }

  return response.json();
}

export interface OrchestrationClient {
  orchestrate(options: OrchestrateOptions): Promise<OrchestrateResponse>;
  getWorkflowStatus(runId: string): Promise<WorkflowStatus>;
  resumeHook(options: ResumeHookOptions): Promise<{ success: boolean }>;
}

/**
 * Create a type-safe orchestration client with baseUrl fixed.
 * Use in app code to avoid passing apiBaseUrl on every call.
 */
export function createOrchestrationClient(
  apiBaseUrl: string,
): OrchestrationClient {
  const base = apiBaseUrl.replace(/\/+$/, '');
  return {
    async orchestrate(options) {
      return orchestrate(base, options);
    },
    async getWorkflowStatus(runId) {
      return getWorkflowStatus(base, runId);
    },
    async resumeHook(options) {
      return resumeHook(base, options);
    },
  };
}

export interface WorkflowClient {
  /**
   * Convenience wrapper around POST /api/workflows/orchestrate.
   * Generates an executionId automatically if not provided.
   */
  startOrchestration(
    config: OrchestrationConfig,
    options?: {
      executionId?: string;
      hookTokens?: Record<string, string>;
      input?: any;
      messages?: any[];
    },
  ): Promise<OrchestrateResponse>;

  /**
   * GET status for a workflow.
   * - workflowPath '/orchestrate' -> GET /api/workflows/orchestrate/:runId
   * - otherwise -> GET /api/workflows/<workflowPath>/:runId
   */
  getWorkflowStatus(workflowPath: string, runId: string): Promise<any>;

  /**
   * Resume a workflow hook/signal.
   * - workflowPath '/orchestrate' -> POST /api/workflows/orchestrate/signal
   * - otherwise -> POST /api/workflows/<workflowPath>/signal
   */
  sendSignal(workflowPath: string, token: string, payload: any): Promise<any>;
}

function normalizeWorkflowPath(workflowPath: string): string {
  const p = (workflowPath || '').trim();
  if (!p) return '';
  return p.startsWith('/') ? p : `/${p}`;
}

function defaultBaseUrl(): string {
  // In browser, relative fetch works fine; still prefer absolute when available.
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return '';
}

/**
 * Unified workflow client for the Next.js example API routes under /api/workflows/*.
 */
export function createWorkflowClient(apiBaseUrl?: string): WorkflowClient {
  const base = (apiBaseUrl ?? defaultBaseUrl()).replace(/\/+$/, '');

  return {
    async startOrchestration(config, options) {
      const executionId =
        options?.executionId ??
        `wf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      // Ensure internal _statusUpdate steps are injected before sending over the wire.
      const prepared = prepareOrchestrationConfig(config);

      return orchestrate(base, {
        config: prepared,
        executionId,
        hookTokens: options?.hookTokens ?? {},
        input: options?.input ?? {},
        messages: options?.messages ?? [],
      });
    },

    async getWorkflowStatus(workflowPath, runId) {
      const p = normalizeWorkflowPath(workflowPath);
      if (p === '/orchestrate') {
        return getWorkflowStatus(base, runId);
      }

      const url = `${base}/api/workflows${p}/${runId}`.replace(/\/+$/, '');
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(
          `Failed to get workflow status: ${res.status} ${res.statusText}${text ? ` - ${text}` : ''}`,
        );
      }
      return res.json();
    },

    async sendSignal(workflowPath, token, payload) {
      const p = normalizeWorkflowPath(workflowPath);
      if (p === '/orchestrate') {
        return resumeHook(base, { token, payload });
      }

      const url = `${base}/api/workflows${p}/signal`.replace(/\/+$/, '');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, payload }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(
          `Failed to send signal: ${res.status} ${res.statusText}${text ? ` - ${text}` : ''}`,
        );
      }
      return res.json();
    },
  };
}

