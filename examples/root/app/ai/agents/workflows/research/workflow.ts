// import { z } from 'zod';
// import { defineHook, sleep } from 'workflow';

// // Define input/output schemas
// const researchInputSchema = z.object({
//   topic: z.string(),
//   email: z.string().email(),
// });
// const researchOutputSchema = z.object({ status: z.string(), summaryUrl: z.string().optional() });

// // Define approval payload schema for type safety
// const approvalPayloadSchema = z.object({
//   decision: z.enum(['approve', 'reject']),
//   comments: z.string().optional(),
// });

// // Define the hook using defineHook for type safety
// // This creates a typed hook that can be awaited in the workflow
// const approvalHookSchema = defineHook({
//   schema: approvalPayloadSchema,
// });

// // Define step functions using the official workflow package
// // Steps must have the "use step" directive and are called via step()
// async function searchWeb(query: string) {
//   "use step";
//   // Simulate web search - in real app, this would call Brave Search API
//   await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate delay
//   return [
//     `Result 1: Comprehensive analysis of ${query}`,
//     `Result 2: Latest trends in ${query}`,
//     `Result 3: Expert opinions on ${query}`,
//   ];
// }

// async function summarizeResults(results: string[]) {
//   "use step";
//   // Simulate summarization
//   await new Promise(resolve => setTimeout(resolve, 500));
//   return {
//     summary: `Summary of ${results.length} research results`,
//     keyPoints: results.slice(0, 3),
//   };
// }

// async function sendEmail(body: string, recipient: string) {
//   "use step";
//   // Simulate email sending
//   console.log(`[EMAIL] Sending to ${recipient}: ${body.substring(0, 50)}...`);
//   await new Promise(resolve => setTimeout(resolve, 300));
//   return {
//     success: true,
//     messageId: `msg_${Date.now()}`,
//   };
// }

// // External runtime entrypoint: `"use workflow"` function that orchestrates steps.
// // This will be used by the official `workflow` runtime via the adapter.
// // IMPORTANT: This function must be exported directly for the Workflow DevKit
// // to process it at build time. The "use workflow" directive must be the first
// // statement in the function body.
// export async function researchWorkflowFn(input: z.infer<typeof researchInputSchema>) {
//   "use workflow";

//   const { topic, email } = input;

//   // Step 1: Search - call step function directly (Workflow DevKit intercepts via "use step")
//   const results = await searchWeb(topic);

//   if (results.length === 0) {
//     return { status: 'failed', summaryUrl: undefined };
//   }

//   // Step 2: Summarize - call step function directly
//   const summary = await summarizeResults(results);

//   await sleep("1 min");

//   // Step 3: Create hook for human approval (HITL)
//   // Using defineHook pattern - create hook instance with custom token
//   // The workflow will pause at await hook until the hook is resumed
//   // Token pattern: research-approval:${topic}:${email}
//   // NOTE: This is deterministic - the frontend can construct this token
//   // If multiple workflows start with the same input, there will be token conflicts
//   // For production, consider including runId or using unique identifiers
//   const hook = approvalHookSchema.create({
//     token: `research-approval:${topic}:${email}`,
//   });

//   console.log(`[HITL] Waiting for approval of research summary for topic: ${topic}`);
//   console.log(`[HITL] Hook token: ${hook.token}`);

//   // Step 4: Wait for human approval (HITL pause)
//   // Workflow pauses here until someone calls the signal endpoint with approval/rejection
//   // No compute resources are consumed while waiting - the workflow status should be "paused"
//   const approval = await hook;
//   console.log(`[HITL] Received approval decision:`, approval);

//   if (approval.decision === 'reject') {
//     return {
//       status: 'rejected',
//       summaryUrl: undefined,
//     };
//   }

//   // Step 5: Send email with approved summary
//   const emailBody = `${summary.summary}\n\nKey Points:\n${summary.keyPoints.map((p: string) => `- ${p}`).join('\n')}`;
//   const emailResult = await sendEmail(emailBody, email);

//   return {
//     status: 'completed',
//     summaryUrl: `https://example.com/summary/${emailResult.messageId}`,
//   };
// }

// // Export schemas for use in registration file
// export { researchInputSchema, researchOutputSchema };

