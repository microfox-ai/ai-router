/**
 * Workflow API Client
 * 
 * Provides predefined functions for making API calls to workflow endpoints.
 * Assumes the boilerplate structure is correct according to the architecture,
 * but allows customization of base URLs, API paths, auth headers, etc.
 */

import type { OrchestrationConfig } from './orchestrate.js';

/**
 * Client configuration options
 */
export interface WorkflowClientConfig {
  /**
   * Base URL for API calls (e.g., 'http://localhost:3000' or 'https://api.example.com')
   * Defaults to empty string (relative URLs) for same-origin requests
   */
  baseUrl?: string;

  /**
   * Custom API path prefix (default: '/api/workflows')
   */
  apiPath?: string;

  /**
   * Custom headers to include in all requests
   * Useful for auth tokens, API keys, etc.
   */
  headers?: Record<string, string>;

  /**
   * Request timeout in milliseconds (default: 30000 = 30s)
   */
  timeout?: number;

  /**
   * Whether to throw errors on non-OK responses (default: true)
   */
  throwOnError?: boolean;

  /**
   * Custom fetch implementation (useful for testing or custom behavior)
   */
  fetch?: typeof fetch;
}

/**
 * Workflow start response
 */
export interface WorkflowStartResponse {
  runId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  result?: any;
}

/**
 * Workflow status response
 */
export interface WorkflowStatusResponse {
  runId: string;
  status: string;
  result?: any;
  error?: string;
  hook?: {
    token: string;
    type: 'hook';
  };
  webhook?: {
    token: string;
    url: string;
    type: 'webhook';
  };
}

/**
 * Signal response
 */
export interface SignalResponse {
  status: 'resumed';
  message?: string;
}

/**
 * Worker dispatch response
 */
export interface WorkerDispatchResponse {
  jobId: string;
  status: string;
  message?: string;
}

/**
 * Worker status response
 */
export interface WorkerStatusResponse {
  jobId: string;
  workerId: string;
  status: string;
  output?: any;
  error?: {
    message: string;
    stack?: string;
  };
  metadata?: Record<string, any>;
}

/**
 * Error response from API
 */
export interface ApiError {
  error: string;
  statusCode?: number;
  statusText?: string;
}

/**
 * Workflow API Client class
 */
export class WorkflowClient {
  private config: Required<Omit<WorkflowClientConfig, 'headers' | 'fetch'>> & {
    headers?: Record<string, string>;
    fetch?: typeof fetch;
  };

  constructor(config: WorkflowClientConfig = {}) {
    this.config = {
      baseUrl: config.baseUrl ?? '',
      apiPath: config.apiPath ?? '/api/workflows',
      headers: config.headers,
      timeout: config.timeout ?? 30000,
      throwOnError: config.throwOnError ?? true,
      fetch: config.fetch ?? (typeof window !== 'undefined' ? window.fetch : globalThis.fetch),
    };
  }

  /**
   * Create request with default headers and timeout
   */
  private async makeRequest(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const { fetch: fetchFn, timeout, headers } = this.config;
    
    // Ensure we have a fetch function
    const fetchFunction = fetchFn || (typeof window !== 'undefined' ? window.fetch : globalThis.fetch);

    // Combine headers
    const requestHeaders: HeadersInit = {
      'Content-Type': 'application/json',
      ...headers,
      ...options.headers,
    };

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = timeout > 0
      ? setTimeout(() => controller.abort(), timeout)
      : null;

    try {
      const response = await fetchFunction(url, {
        ...options,
        headers: requestHeaders,
        signal: controller.signal,
      });

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      return response;
    } catch (error: any) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }

      throw error;
    }
  }

  /**
   * Handle response and extract JSON or error
   */
  private async handleResponse<T>(
    response: Response,
    expectedStatus: number | number[] = 200
  ): Promise<T> {
    const expectedStatuses = Array.isArray(expectedStatus)
      ? expectedStatus
      : [expectedStatus];

    if (!expectedStatuses.includes(response.status)) {
      let errorMessage: string;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || response.statusText || 'Unknown error';
      } catch {
        errorMessage = await response.text() || response.statusText || 'Unknown error';
      }

      const error: ApiError = {
        error: errorMessage,
        statusCode: response.status,
        statusText: response.statusText,
      };

      if (this.config.throwOnError) {
        throw new Error(
          `API request failed (${response.status} ${response.statusText}): ${errorMessage}`
        );
      }

      throw error;
    }

    // Handle empty responses (204 No Content)
    if (response.status === 204) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  /**
   * Build full URL from path
   */
  private buildUrl(path: string): string {
    const { baseUrl, apiPath } = this.config;
    
    // Ensure path starts with /
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    
    // Combine baseUrl and apiPath
    const base = baseUrl ? `${baseUrl}${apiPath}` : apiPath;
    
    // Combine base and path
    return `${base}${normalizedPath}`;
  }

  /**
   * Start a workflow
   * 
   * @param workflowId - Workflow ID or agent path
   * @param input - Workflow input
   * @param options - Optional messages and additional options
   */
  async startWorkflow(
    workflowId: string,
    input?: any,
    options?: {
      messages?: any[];
      headers?: Record<string, string>;
    }
  ): Promise<WorkflowStartResponse> {
    const url = this.buildUrl(`/${workflowId}`);

    const response = await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify({
        input: input || {},
        messages: options?.messages || [],
      }),
      headers: options?.headers,
    });

    return this.handleResponse<WorkflowStartResponse>(response);
  }

  /**
   * Get workflow status
   * 
   * @param workflowId - Workflow ID
   * @param runId - Run ID
   */
  async getWorkflowStatus(
    workflowId: string,
    runId: string
  ): Promise<WorkflowStatusResponse> {
    const url = this.buildUrl(`/${workflowId}/${runId}`);

    const response = await this.makeRequest(url, {
      method: 'GET',
    });

    return this.handleResponse<WorkflowStatusResponse>(response);
  }

  /**
   * Send signal to workflow (resume hook)
   * 
   * @param workflowId - Workflow ID
   * @param token - Hook token
   * @param payload - Payload to resume with
   */
  async sendSignal(
    workflowId: string,
    token: string,
    payload: any
  ): Promise<SignalResponse> {
    const url = this.buildUrl(`/${workflowId}/signal`);

    const response = await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify({
        token,
        payload,
      }),
    });

    return this.handleResponse<SignalResponse>(response);
  }

  /**
   * Start an orchestration workflow
   * 
   * @param config - Orchestration configuration
   * @param options - Optional input, messages, and additional options
   */
  async startOrchestration(
    config: OrchestrationConfig,
    options?: {
      input?: any;
      messages?: any[];
      headers?: Record<string, string>;
    }
  ): Promise<WorkflowStartResponse> {
    const url = this.buildUrl('/orchestrate');

    const response = await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify({
        config,
        input: options?.input,
        messages: options?.messages || [],
      }),
      headers: options?.headers,
    });

    return this.handleResponse<WorkflowStartResponse>(response);
  }

  /**
   * Execute a worker
   * 
   * @param workerId - Worker ID
   * @param input - Worker input
   * @param options - Optional await mode and additional options
   */
  async executeWorker(
    workerId: string,
    input?: any,
    options?: {
      await?: boolean;
      headers?: Record<string, string>;
    }
  ): Promise<WorkerDispatchResponse> {
    const url = this.buildUrl(`/workers/${workerId}`);

    const response = await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify({
        input: input || {},
        await: options?.await ?? false,
      }),
      headers: options?.headers,
    });

    return this.handleResponse<WorkerDispatchResponse>(response);
  }

  /**
   * Get worker job status
   * 
   * @param workerId - Worker ID
   * @param jobId - Job ID
   */
  async getWorkerStatus(
    workerId: string,
    jobId: string
  ): Promise<WorkerStatusResponse> {
    const url = this.buildUrl(`/workers/${workerId}/${jobId}`);

    const response = await this.makeRequest(url, {
      method: 'GET',
    });

    return this.handleResponse<WorkerStatusResponse>(response);
  }

  /**
   * Update client configuration
   */
  updateConfig(updates: Partial<WorkflowClientConfig>): void {
    if (updates.baseUrl !== undefined) {
      this.config.baseUrl = updates.baseUrl;
    }
    if (updates.apiPath !== undefined) {
      this.config.apiPath = updates.apiPath;
    }
    if (updates.headers !== undefined) {
      this.config.headers = {
        ...this.config.headers,
        ...updates.headers,
      };
    }
    if (updates.timeout !== undefined) {
      this.config.timeout = updates.timeout;
    }
    if (updates.throwOnError !== undefined) {
      this.config.throwOnError = updates.throwOnError;
    }
    if (updates.fetch !== undefined) {
      this.config.fetch = updates.fetch;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): WorkflowClientConfig {
    return { ...this.config };
  }
}

/**
 * Create a workflow client with default or custom configuration
 * 
 * @example
 * ```typescript
 * // Default configuration (uses relative URLs)
 * const client = createWorkflowClient();
 * 
 * // Custom base URL for production
 * const client = createWorkflowClient({
 *   baseUrl: 'https://api.example.com',
 * });
 * 
 * // With authentication
 * const client = createWorkflowClient({
 *   headers: {
 *     'Authorization': 'Bearer token123',
 *   },
 * });
 * 
 * // Custom API path
 * const client = createWorkflowClient({
 *   apiPath: '/custom/api/workflows',
 * });
 * ```
 */
export function createWorkflowClient(config?: WorkflowClientConfig): WorkflowClient {
  return new WorkflowClient(config);
}

/**
 * Default client instance (can be configured globally)
 */
let defaultClient: WorkflowClient | null = null;

/**
 * Get or create the default client instance
 */
export function getDefaultClient(): WorkflowClient {
  if (!defaultClient) {
    defaultClient = createWorkflowClient();
  }
  return defaultClient;
}

/**
 * Set the default client instance
 */
export function setDefaultClient(client: WorkflowClient): void {
  defaultClient = client;
}

/**
 * Convenience functions using the default client
 */
export const workflowApi = {
  /**
   * Start a workflow (uses default client)
   */
  startWorkflow: async (
    workflowId: string,
    input?: any,
    options?: { messages?: any[]; headers?: Record<string, string> }
  ) => getDefaultClient().startWorkflow(workflowId, input, options),

  /**
   * Get workflow status (uses default client)
   */
  getWorkflowStatus: async (workflowId: string, runId: string) =>
    getDefaultClient().getWorkflowStatus(workflowId, runId),

  /**
   * Send signal (uses default client)
   */
  sendSignal: async (workflowId: string, token: string, payload: any) =>
    getDefaultClient().sendSignal(workflowId, token, payload),

  /**
   * Start orchestration (uses default client)
   */
  startOrchestration: async (
    config: OrchestrationConfig,
    options?: { input?: any; messages?: any[]; headers?: Record<string, string> }
  ) => getDefaultClient().startOrchestration(config, options),

  /**
   * Execute worker (uses default client)
   */
  executeWorker: async (
    workerId: string,
    input?: any,
    options?: { await?: boolean; headers?: Record<string, string> }
  ) => getDefaultClient().executeWorker(workerId, input, options),

  /**
   * Get worker status (uses default client)
   */
  getWorkerStatus: async (workerId: string, jobId: string) =>
    getDefaultClient().getWorkerStatus(workerId, jobId),
};
