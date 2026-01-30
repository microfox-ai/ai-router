/**
 * Workflow runtime contracts.
 *
 * These types describe the interface for workflow runtime operations.
 * The system uses Vercel's `workflow` runtime for execution.
 */

export interface WorkflowRuntimeStartResult<Output = unknown> {
  /**
   * Provider-specific run / instance identifier that can be used to query
   * status or send follow-up signals.
   */
  runId: string;

  /**
   * Normalized status string (e.g. "pending", "running", "paused",
   * "completed", "failed").
   *
   * Providers may have richer internal status enums, but they should be
   * mapped into this simplified set at the adapter boundary.
   */
  status: string;

  /**
   * Optional workflow result when it is already available at start time
   * (for very short workflows). Most long-running flows will return
   * `undefined` here and be retrieved via `getWorkflowStatus`.
   */
  result?: Output;
}

export interface WorkflowRuntimeStatusResult<Output = unknown> {
  /**
   * Current normalized status for the workflow instance.
   */
  status: string;

  /**
   * Optional result when the workflow has completed successfully.
   */
  result?: Output;

  /**
   * Optional error message when the workflow has failed.
   */
  error?: string;

  /**
   * Optional hook information when the workflow is waiting for a
   * human-in-the-loop signal identified by a token.
   */
  hook?: {
    token: string;
    type: 'hook';
  };

  /**
   * Optional webhook information when the workflow exposes a resumable
   * HTTP webhook (for advanced HITL patterns).
   */
  webhook?: {
    token: string;
    url: string;
    type: 'webhook';
  };
}

/**
 * Minimal contract that ai-workflow expects from any workflow runtime.
 *
 * It is deliberately generic: callers provide whatever metadata object they
 * like as `def`, as long as it contains enough information for the adapter
 * to locate the underlying workflow definition / function for that runtime.
 */
export interface WorkflowRuntimeAdapter {
  /**
   * Start a new workflow instance.
   *
   * @param def Arbitrary workflow definition object (provider-specific).
   * @param input Validated workflow input.
   */
  startWorkflow<Input, Output>(
    def: any,
    input: Input,
  ): Promise<WorkflowRuntimeStartResult<Output>>;

  /**
   * Fetch the current status (and optional result/history) for a
   * workflow instance.
   *
   * @param def The same workflow definition object that was used to start.
   * @param runId Provider-specific run identifier returned from `startWorkflow`.
   */
  getWorkflowStatus<Output>(
    def: any,
    runId: string,
  ): Promise<WorkflowRuntimeStatusResult<Output>>;

  /**
   * Resume a hook-style human-in-the-loop pause using a logical token
   * (e.g. approval ID). Providers are responsible for mapping this token
   * to their internal run / event identifiers.
   */
  resumeHook<Payload, Output>(
    token: string,
    payload: Payload,
  ): Promise<WorkflowRuntimeStatusResult<Output>>;

  /**
   * Resume a webhook-style pause using a logical token. The payload should
   * be compatible with the provider's HTTP request format.
   */
  resumeWebhook<Payload, Output>(
    token: string,
    payload: Payload,
  ): Promise<WorkflowRuntimeStatusResult<Output>>;
}

