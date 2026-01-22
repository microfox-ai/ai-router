// Step execution functions for orchestration workflow
// These must be separate files to avoid Next.js dependencies in workflow runtime

import type { OrchestrationContext } from '@microfox/ai-router';

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

// Call worker step (fire-and-forget only)
// Workers are long-running background tasks that complete independently.
// Vercel's stateless APIs cannot reliably notify the workflow engine of worker completion,
// so workers only support fire-and-forget mode.
export async function callWorkerStep(input: {
  workerId: string;
  workerInput: any;
  baseUrl: string;
}) {
  "use step";
  
  const { workerId, workerInput, baseUrl } = input;
  
  // Construct the worker API URL
  const workerApiPath = baseUrl 
    ? `${baseUrl}/api/workflows/workers/${workerId}`
    : `/api/workflows/workers/${workerId}`;

  // Always fire-and-forget: dispatch worker and return job info immediately
  const response = await fetch(workerApiPath, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: workerInput,
      await: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Worker dispatch failed: ${response.status} ${response.statusText}. ${errorText}`
    );
  }

  const result = await response.json();
  return { jobId: result.jobId, status: result.status || 'queued' };
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

// Helper to resolve input value (static or function)
export function resolveInput(
  input: any | ((ctx: OrchestrationContext) => any),
  context: OrchestrationContext
): any {
  if (typeof input === 'function') {
    return input(context);
  }
  return input;
}

// Helper to resolve token (static or function)
export function resolveToken(
  token: string | ((ctx: OrchestrationContext) => string),
  context: OrchestrationContext
): string {
  if (typeof token === 'function') {
    return token(context);
  }
  return token;
}
