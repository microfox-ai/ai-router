// Step function that calls the agent via HTTP
// This file must be separate to avoid Next.js dependencies in workflow runtime
export async function callAgentStep(input: {
  agentPath: string;
  input: any;
  baseUrl: string;
  messages: any[];
}) {
  "use step";
  
  const { agentPath, input: agentInput, baseUrl, messages } = input;
  
  // Construct the full URL
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

  // Read the response as JSON (UIMessage stream)
  const responseData = await response.json();
  return responseData;
}
