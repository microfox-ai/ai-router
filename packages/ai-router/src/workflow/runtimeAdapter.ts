// /**
//  * Workflow runtime adapter for integrating ai-router with the official
//  * `workflow` runtime.
//  *
//  * This adapter uses the `workflow/api` entrypoint to start workflows,
//  * check status, and resume hooks/webhooks.
//  *
//  * The `workflow` package must be installed separately in your project
//  * as a peer dependency.
//  */

// // Lazy-load workflow API to avoid requiring it at build time
// // This allows the workflow package to be installed separately in the consuming project
// let workflowApi: any = null;

// async function getWorkflowApi() {
//   if (workflowApi) {
//     return workflowApi;
//   }

//   try {
//     // Dynamic import - workflow package must be installed in the consuming project
//     // @ts-expect-error - workflow/api is a peer dependency, types may not be available at build time
//     workflowApi = await import('workflow/api');
//     return workflowApi;
//   } catch (error: any) {
//     const errorMessage = error?.message || String(error);
//     throw new Error(
//       '[ai-router][workflow] Failed to load `workflow/api`. ' +
//         'Make sure the `workflow` package is installed in your project. ' +
//         'Install it with: npm install workflow@^4.0.1-beta.35 ' +
//         `Original error: ${errorMessage}`,
//     );
//   }
// }

// export interface WorkflowAdapterStartResult<Output = unknown> {
//   instanceId: string;
//   status: string;
//   result?: Output;
// }

// export interface WorkflowAdapterStatusResult<Output = unknown> {
//   status: string;
//   result?: Output;
//   error?: string;
//   /**
//    * Optional hook/webhook information if workflow is waiting for HITL.
//    */
//   hook?: {
//     token: string;
//     type: 'hook';
//   };
//   webhook?: {
//     token: string;
//     url: string;
//     type: 'webhook';
//   };
// }

// /**
//  * Minimal contract that ai-router expects from a workflow runtime.
//  *
//  * It is deliberately generic: callers provide whatever metadata object
//  * they like as `def`, as long as it contains enough information for
//  * the adapter to locate the underlying workflow function.
//  */
// export interface WorkflowAdapter {
//   /**
//    * Start a new workflow instance.
//    *
//    * @param def Arbitrary workflow definition object. For the official
//    *           `workflow` runtime this is expected to carry a reference
//    *           to the `"use workflow"` function (e.g. `def.workflowFn`).
//    * @param input Validated workflow input.
//    */
//   startWorkflow<Input, Output>(
//     def: any,
//     input: Input,
//   ): Promise<WorkflowAdapterStartResult<Output>>;

//   /**
//    * Fetch the current status (and optional result/history) for a
//    * workflow instance.
//    */
//   getWorkflowStatus<Output>(
//     def: any,
//     instanceId: string,
//   ): Promise<WorkflowAdapterStatusResult<Output>>;

//   /**
//    * Resume a hook with the given token and payload.
//    */
//   resumeHook<Payload, Output>(
//     token: string,
//     payload: Payload,
//   ): Promise<WorkflowAdapterStatusResult<Output>>;

//   /**
//    * Resume a webhook with the given token and payload.
//    * The payload should be compatible with HTTP Request format.
//    */
//   resumeWebhook<Payload, Output>(
//     token: string,
//     payload: Payload,
//   ): Promise<WorkflowAdapterStatusResult<Output>>;
// }

// /**
//  * Default adapter that integrates with the official `workflow` runtime
//  * via the `workflow/api` entrypoint, following the public docs:
//  *
//  * - https://useworkflow.dev/docs/foundations/workflows-and-steps
//  * - https://useworkflow.dev/docs/foundations/starting-workflows
//  *
//  * It expects the workflow definition object to expose a `workflowFn`
//  * property that is a `"use workflow"` function.
//  */
// export const defaultWorkflowAdapter: WorkflowAdapter = {
//   async startWorkflow(def: any, input: any) {
//     const workflowFn = def?.workflowFn;
//     if (typeof workflowFn !== 'function') {
//       throw new Error(
//         '[ai-router][workflow] Workflow definition is missing `workflowFn`. ' +
//           'Use `createWorkflow({ ..., workflowFn })` with a `"use workflow"` ' +
//           'function when integrating with the external runtime.',
//       );
//     }

//     const api = await getWorkflowApi();
//     const { start } = api;
//     if (!start) {
//       throw new Error(
//         '[ai-router][workflow] `workflow/api` does not export `start`. ' +
//           'Check that you are using a compatible version of the workflow runtime.',
//       );
//     }

//     // Start the workflow as described in the official docs.
//     // The workflow runtime executes steps asynchronously, so we return
//     // immediately with the instanceId. The status endpoint will handle
//     // polling for completion.
//     const run = await start(workflowFn, [input]);
    
//     // Get the current status (may be "pending", "running", "completed", etc.)
//     // We don't wait for completion here - that's handled by the status endpoint
//     const status: string = await run.status;

//     let result: any;
//     // Only try to get the result if the workflow completed synchronously
//     // (unlikely, but possible for very fast workflows)
//     if (status === 'completed') {
//       try {
//         result = await run.returnValue;
//       } catch (error) {
//         // If returnValue isn't available yet, that's fine - status endpoint will handle it
//       }
//     }

//     return {
//       instanceId: run.runId,
//       status,
//       result,
//     };
//   },

//   async getWorkflowStatus(def: any, instanceId: string) {
//     const api = await getWorkflowApi();
//     const { getRun } = api;
//     if (!getRun) {
//       throw new Error(
//         '[ai-router][workflow] `workflow/api` does not export `getRun`. ' +
//           'Check that you are using a compatible version of the workflow runtime.',
//       );
//     }

//     const run = getRun(instanceId);
//     if (!run) {
//       throw new Error(
//         `[ai-router][workflow] Workflow run ${instanceId} not found.`,
//       );
//     }

//     // Get the current status - the workflow runtime's run.status is a promise
//     // that resolves to the current status. It may be reactive and update as the workflow progresses.
//     let status: string;
//     let workflowError: any;
//     try {
//       // Get the latest status - run.status is a promise that resolves to current status
//       // Note: The workflow runtime updates status to "paused" when it hits a hook/webhook
//       // If the workflow is still executing steps, it will be "running"
//       // Once it reaches `await hook`, the runtime should update it to "paused"
//       status = await run.status;
      
//       // Also check for errors - the workflow might have failed while creating the hook
//       // (e.g., "Hook with token ... already exists")
//       try {
//         const errorValue = await run.error;
//         if (errorValue) {
//           workflowError = errorValue;
//           // If there's an error but status is still "running", update status to "failed"
//           if (status === 'running' || status === 'pending') {
//             status = 'failed';
//           }
//         }
//       } catch {
//         // run.error might not be available or might throw - that's okay
//       }
//     } catch (err: any) {
//       status = 'error';
//       workflowError = err;
//     }
    
//     let result: any;
//     let error: any;
    
//     // Try to get the result if the workflow is completed
//     if (status === 'completed') {
//       try {
//           result = await run.returnValue;
//       } catch (err: any) {
//         error = err;
//       }
//     } else if (status === 'failed' || status === 'error') {
//       // If the workflow failed, use the error we detected
//       error = workflowError;
//     }

//     // The workflow runtime returns "paused" status when waiting for hooks/webhooks
//     // Valid workflow runtime statuses: "pending" | "running" | "completed" | "failed" | "paused" | "cancelled"
//     const finalStatus = status;

//     const resultObj: WorkflowAdapterStatusResult<any> = {
//       status: finalStatus,
//       result,
//       error: error?.message || (error ? String(error) : undefined),
//     };

//     // If status is "paused", the workflow is waiting for HITL (hook or webhook)
//     // Tokens must be custom/deterministic and constructed by the caller using workflow input and runId
//     if (finalStatus === 'paused') {
//       resultObj.hook = {
//         token: '', // Token must be provided by caller - construct it using workflow input and runId
//         type: 'hook',
//       };
//     }

//     // Debug: If status is "running" for a while, it might be stuck waiting for a hook
//     // but the runtime hasn't updated the status yet. This can happen if:
//     // 1. The hook creation fails (e.g., "Hook with token ... already exists")
//     // 2. The runtime hasn't processed the hook suspension yet
//     // In this case, we should check for errors that might indicate hook-related issues
//     if (finalStatus === 'running' && error) {
//       // If there's an error but status is still "running", it might be a hook creation error
//       // The error should already be in resultObj.error, but we make sure it's reported
//     }

//     return resultObj;
//   },

//   async resumeHook(token: string, payload: any) {
//     const api = await getWorkflowApi();
//     const { resumeHook } = api;
//     if (!resumeHook) {
//       throw new Error(
//         '[ai-router][workflow] `workflow/api` does not export `resumeHook`. ' +
//           'Check that you are using a compatible version of the workflow runtime.',
//       );
//     }

//     try {
//       await resumeHook(token, payload);
      
//       // Get the run to return updated status
//       // We need to find the runId from the token - this is a limitation
//       // For now, we'll return a simple success status
//       return {
//         status: 'resumed',
//       };
//     } catch (error: any) {
//       throw new Error(
//         `[ai-router][workflow] Failed to resume hook with token ${token}: ${error?.message || String(error)}`,
//       );
//     }
//   },

//   async resumeWebhook(token: string, payload: any) {
//     const api = await getWorkflowApi();
//     const { resumeWebhook } = api;
//     if (!resumeWebhook) {
//       throw new Error(
//         '[ai-router][workflow] `workflow/api` does not export `resumeWebhook`. ' +
//           'Check that you are using a compatible version of the workflow runtime.',
//       );
//     }

//     try {
//       await resumeWebhook(token, payload);
      
//       return {
//         status: 'resumed',
//       };
//     } catch (error: any) {
//       throw new Error(
//         `[ai-router][workflow] Failed to resume webhook with token ${token}: ${error?.message || String(error)}`,
//       );
//     }
//   },
// };
