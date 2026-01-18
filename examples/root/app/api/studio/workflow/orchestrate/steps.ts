// Step execution functions for orchestration workflow
// These must be separate files to avoid Next.js dependencies in workflow runtime

import type { OrchestrationContext, OrchestrationStep } from '@microfox/ai-router/workflow/orchestrate';

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
  const url = baseUrl 
    ? `${baseUrl}${agentPath.startsWith('/') ? agentPath : '/' + agentPath}`
    : agentPath;

  // Make HTTP POST request to the agent endpoint
  const response = await fetch(url, {
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

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Agent call failed: ${response.status} ${response.statusText}. ${errorText}`
    );
  }

  // Read the response as JSON (UIMessage array)
  const uiMessages = await response.json();
  
  // Debug: Log the raw response to understand the format
  console.log(`[callAgentStep] Agent: ${agentPath}, Raw Response:`, JSON.stringify(uiMessages, null, 2));
  
  // Extract the actual agent return value from the UIMessage array
  const agentResult = extractAgentResult(uiMessages);
  
  // Debug: Log the extracted result
  console.log(`[callAgentStep] Agent: ${agentPath}, Extracted Result:`, JSON.stringify(agentResult, null, 2));
  
  return agentResult;
}

// Call workflow step (for fire-and-forget agents)
export async function callWorkflowStep(input: {
  workflowPath: string;
  workflowInput: any;
  baseUrl: string;
  messages: any[];
}) {
  "use step";
  
  const { workflowPath, workflowInput, baseUrl, messages } = input;
  
  // Construct the workflow API URL
  const workflowApiPath = baseUrl 
    ? `${baseUrl}/api/studio/workflow/agent${workflowPath.startsWith('/') ? workflowPath : '/' + workflowPath}`
    : `/api/studio/workflow/agent${workflowPath.startsWith('/') ? workflowPath : '/' + workflowPath}`;

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

// Note: defineHook().create() cannot be called from a step function - it must be called directly
// in the workflow function. The hook step is handled in orchestrateWorkflow.ts
// This function is kept for reference but not used.

// Note: sleep() cannot be called from a step function - it must be called directly
// in the workflow function. The sleep step is handled in orchestrateWorkflow.ts
// This function is kept for reference but not used.

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
