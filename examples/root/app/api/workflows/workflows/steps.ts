// Step execution functions for orchestration workflow
// These must be separate files to avoid Next.js dependencies in workflow runtime

import { fetch } from 'workflow';
import type { OrchestrationContext } from '@microfox/ai-workflow/orchestrate';

// Helper to extract agent return value from UIMessage array
function extractAgentResult(uiMessages: any[]): any {
  // UIMessage format: [{ id: "...", parts: [{ type: "...", ... }] }]
  // Agent return values can be in various formats
  if (!uiMessages || uiMessages.length === 0) {
    return null;
  }

  // Look for data parts or tool-call-result parts in all messages
  for (const message of uiMessages) {
    if (message.parts && Array.isArray(message.parts)) {
      for (const part of message.parts) {
        // Check for tool-call-result parts (most common for agent returns)
        // writeCustomTool writes with 'output' field
        if (part.type === 'tool-call-result') {
          if (part.output !== undefined) {
            return part.output;
          }
          if (part.result !== undefined) {
            return part.result;
          }
        }
        // Check for tool-{toolName} parts (format: tool-systemCurrentDate, etc.)
        if (part.type?.startsWith('tool-') && part.output !== undefined) {
          return part.output;
        }
        // Check for data parts
        if (part.type === 'data' && part.data !== undefined) {
          return part.data;
        }
        // Check for data-end parts
        if (part.type === 'data-end' && part.data !== undefined) {
          return part.data;
        }
      }
    }
  }

  // If no parts found, the agent might have returned a value directly
  // Check if the message itself contains the return value
  // Some agents return values that get wrapped differently
  if (uiMessages.length === 1) {
    const message = uiMessages[0];
    // If message has no parts, check if it has a result property
    if (!message.parts || message.parts.length === 0) {
      // Check for direct result property
      if (message.result !== undefined) {
        return message.result;
      }
      // Return the message itself if it looks like a result object
      if (typeof message === 'object' && !message.id && !message.parts) {
        return message;
      }
    }
  }

  // If we still haven't found anything, return null
  // This indicates the agent didn't return any data or the format is unexpected
  return null;
}

// Call worker step: POST /workers/trigger directly (no registry).
// Worker ID comes from orchestration config (step.worker).
export async function callWorkerStep(input: {
  workerId: string;
  workerInput: any;
  workerTriggerBaseUrl: string;
  awaitMode?: boolean;
}) {
  "use step";

  const { workerId, workerInput, workerTriggerBaseUrl, awaitMode } = input;

  const base = workerTriggerBaseUrl.replace(/\/workers\/(trigger|config)\/?$/, '').replace(/\/+$/, '');
  const triggerUrl = `${base}/workers/trigger`;

  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  // Webhook optional. Job updates use MongoDB only; never pass jobStoreUrl/origin URL.
  let webhookUrl: string | undefined;
  try {
    const base = typeof process !== 'undefined' ? process?.env?.WORKFLOW_WEBHOOK_BASE_URL : undefined;
    webhookUrl = awaitMode && typeof base === 'string' && base
      ? `${base.replace(/\/+$/, '')}/api/workflows/workers/${workerId}/webhook`
      : undefined;
  } catch {
    webhookUrl = undefined;
  }

  const messageBody = {
    workerId,
    jobId,
    input: workerInput ?? {},
    context: {},
    webhookUrl,
    metadata: { source: 'workflow-orchestration' },
    timestamp: new Date().toISOString(),
  };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const k = typeof process !== 'undefined' ? process?.env?.WORKERS_TRIGGER_API_KEY : undefined;
    if (typeof k === 'string' && k) headers['x-workers-trigger-key'] = k;
  } catch {
    /* env not available in workflow runtime */
  }

  const response = await fetch(triggerUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ workerId, body: messageBody }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Worker trigger failed: ${response.status} ${response.statusText}. ${text}`
    );
  }

  const data = (await response.json().catch(() => ({}))) as any;
  const messageId = data?.messageId ? String(data.messageId) : `trigger-${jobId}`;

  return { jobId, status: 'queued' as const, messageId };
}

export interface PollWorkerJobResult {
  done: boolean;
  status: string;
  output?: any;
  error?: any;
  metadata?: any;
}

/**
 * Single poll of worker job status. Used in a loop for step-based polling.
 * Each poll is a distinct "use step"; `attempt` keeps steps unique for replay.
 */
export async function pollWorkerJobStep(input: {
  baseUrl: string;
  workerId: string;
  jobId: string;
  attempt: number;
}): Promise<PollWorkerJobResult> {
  "use step";

  const { baseUrl, workerId, jobId } = input;
  const url = `${baseUrl.replace(/\/+$/, '')}/api/workflows/workers/${workerId}/${jobId}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return { done: false, status: 'error', error: { message: e?.message ?? String(e) } };
  }

  if (res.status === 404) {
    return { done: false, status: 'queued' };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { done: false, status: 'error', error: { message: `${res.status} ${res.statusText}${text ? ` - ${text}` : ''}` } };
  }

  let job: { status?: string; output?: any; error?: any; metadata?: any };
  try {
    job = (await res.json()) as any;
  } catch {
    return { done: false, status: 'error', error: { message: 'Invalid JSON response' } };
  }

  const status = job.status ?? 'queued';
  if (status === 'completed') {
    return { done: true, status, output: job.output, metadata: job.metadata };
  }
  if (status === 'failed') {
    return { done: true, status: 'failed', error: job.error };
  }
  return { done: false, status };
}

// Call agent step (await or fire-and-forget)
export async function callAgentStep(input: {
  agentPath: string;
  agentInput: any;
  baseUrl: string;
  messages: any[];
  await: boolean;
}) {
  "use step";
  
  const { agentPath, agentInput, baseUrl, messages, await: shouldAwait } = input;
  
  // Construct the full URL - use chat agent endpoint
  // baseUrl should already include the full path like "http://localhost:3000/api/studio/chat/agent"
  // agentPath is like "/system/current_date"
  // So the final URL should be: "http://localhost:3000/api/studio/chat/agent/system/current_date"
  let url: string;
  if (baseUrl) {
    // baseUrl already includes "/api/studio/chat/agent", so just append agentPath
    url = `${baseUrl}${agentPath.startsWith('/') ? agentPath : '/' + agentPath}`;
  } else {
    // Fallback: try to use VERCEL_URL or construct from agentPath
    const vercelUrl = typeof process !== 'undefined' && process.env?.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';
    url = `${vercelUrl}/api/studio/chat/agent${agentPath.startsWith('/') ? agentPath : '/' + agentPath}`;
  }
  
  // Make HTTP POST request to the agent endpoint
  // Note: In Vercel workflow runtime, fetch calls need to use absolute URLs
  // If localhost fails, it might be because the workflow runtime can't reach localhost
  // In production, this should work fine with the deployed URL
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        input: agentInput,
        params: agentInput,
      }),
    });
  } catch (fetchError: any) {
    // Catch network errors (like fetch failed)
    // This can happen in local dev if the workflow runtime can't reach localhost
    // The error message will help debug the issue
    const errorMessage = fetchError?.message || String(fetchError);
    const errorDetails = {
      url,
      baseUrl,
      agentPath,
      error: errorMessage,
      hint: 'If using localhost, ensure the dev server is running and accessible. In production, ensure the URL is correct.',
    };
    console.error(`[callAgentStep] Fetch error:`, errorDetails);
    throw new Error(
      `Agent call failed: Network error - ${errorMessage}. URL: ${url}. ` +
      `Hint: In local development, Vercel workflows may not be able to reach localhost. ` +
      `Consider using a tunnel (ngrok) or test in production/preview environment.`
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[callAgentStep] Agent call failed:`, {
      url,
      status: response.status,
      statusText: response.statusText,
      error: errorText,
    });
    throw new Error(
      `Agent call failed: ${response.status} ${response.statusText}. ${errorText}`
    );
  }

  // Read the response as JSON (UIMessage array)
  const uiMessages = await response.json();
  
  // Extract the actual agent return value from the UIMessage array
  const agentResult = extractAgentResult(uiMessages);
  
  return agentResult;
}

// Call workflow step (for fire-and-forget or blocking workflow calls)
// Supports both registered workflows (by ID) and agent workflows (by path)
export async function callWorkflowStep(input: {
  workflowPath: string;
  workflowInput: any;
  baseUrl: string;
  messages: any[];
}) {
  "use step";
  
  const { workflowPath, workflowInput, baseUrl, messages } = input;
  
  // Construct the workflow API URL - use new unified route
  // Supports both registered workflow IDs and agent paths
  const workflowApiPath = baseUrl 
    ? `${baseUrl}/api/workflows${workflowPath.startsWith('/') ? workflowPath : '/' + workflowPath}`
    : `/api/workflows${workflowPath.startsWith('/') ? workflowPath : '/' + workflowPath}`;

  // Make HTTP POST request to start workflow (fire-and-forget)
  const response = await fetch(workflowApiPath, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: workflowInput,
      messages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Workflow call failed: ${response.status} ${response.statusText}. ${errorText}`
    );
  }

  const result = await response.json();
  return { runId: result.runId, status: result.status };
}

// Helper to resolve input value (static, function, or _fromSteps)
export function resolveInput(
  input: any | ((ctx: OrchestrationContext) => any) | undefined,
  context: OrchestrationContext,
  step?: any
): any {
  if (typeof input === 'function') return input(context);
  if (input === undefined && step?._inputIsFunction) return context.previous || context.input;

  if (input && typeof input === 'object' && Array.isArray((input as any)._fromSteps) && (input as any)._fromSteps.length > 0) {
    const raw = input as { _fromSteps: string[]; _path?: string; _join?: string; [k: string]: any };
    const path = raw._path ?? 'content';
    const stepIds = raw._fromSteps;
    const data = stepIds
      .map((id) => {
        const s = context.steps[id];
        if (s == null) return null;
        const v = path ? (s as any)[path] : s;
        return typeof v === 'string' ? v : v != null ? JSON.stringify(v) : null;
      })
      .filter((x): x is string => x != null && x !== '');
    const out: Record<string, any> = { ...raw };
    delete out._fromSteps;
    delete out._path;
    delete out._join;
    out.data = data;
    if (typeof raw._join === 'string') out.content = data.join(raw._join);
    return out;
  }

  return input;
}

// Get runId from executionId (lookup from status store)
export async function getRunIdFromExecutionId(input: {
  apiBaseUrl: string;
  executionId: string;
}) {
  "use step";
  
  const { apiBaseUrl, executionId } = input;
  
  // Query the status store to get runId from executionId mapping
  const response = await fetch(`${apiBaseUrl}/api/workflows/orchestrate/run-id/${executionId}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to get runId for executionId ${executionId}: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  
  if (!data.runId) {
    throw new Error(`Response from run-id endpoint did not contain runId: ${JSON.stringify(data)}`);
  }
  
  // Ensure we return the actual runId, not the executionId or mapping key
  const actualRunId = data.runId;
  
  // Validate that runId doesn't look like a mapping key (should not start with "executionId:")
  if (actualRunId.startsWith('executionId:')) {
    throw new Error(`Invalid runId returned (looks like mapping key): ${actualRunId}. Expected actual workflow runId.`);
  }
  
  return actualRunId;
}

// Update workflow status via API (must be a step function for Vercel workflows)
export async function updateWorkflowStatus(input: {
  apiBaseUrl: string;
  runId: string;
  status: string;
  hookToken?: string;
  error?: any;
  result?: any;
}) {
  "use step";
  
  const { apiBaseUrl, runId, status, hookToken, error, result } = input;
  
  const response = await fetch(`${apiBaseUrl}/api/workflows/orchestrate/${runId}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status,
      hookToken,
      error,
      result,
    }),
  });
  
  if (!response.ok) {
    console.warn('[OrchestrateWorkflow] Failed to update workflow status:', {
      runId,
      status,
      httpStatus: response.status,
    });
  }
  
  return { success: response.ok };
}

// Helper to resolve token (static or function)
// Handles cases where token was removed during sanitization (marked with _tokenIsFunction)
export function resolveToken(
  token: string | ((ctx: OrchestrationContext) => string) | undefined,
  context: OrchestrationContext,
  step?: any
): string {
  // If token is a function, call it with context
  if (typeof token === 'function') {
    return token(context);
  }
  
  // If token is missing but was marked as a function during sanitization, reconstruct it
  if (!token && step?._tokenIsFunction) {
    // Default pattern: construct token from workflowId in context
    // This matches the pattern used in content-pipeline workflow: content-approval:{workflowId}
    const workflowId = (context.input as any)?.workflowId || 'default';
    return `content-approval:${workflowId}`;
  }
  
  // If token is a string, return it
  if (typeof token === 'string') {
    return token;
  }
  
  // Fallback: throw error if token is missing
  throw new Error('Hook token is missing and could not be resolved');
}

/**
 * Built-in step used by the workflow runtime to serialize workflow return values.
 * The local world does not provide this step; we implement it so workflows can complete.
 * Accepts the return value and returns it as-is (runtime handles persistence).
 */
export async function __builtin_response_json(input: unknown) {
  "use step";
  return input;
}
