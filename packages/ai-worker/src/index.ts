/**
 * @microfox/ai-worker
 * Worker runtime for ai-router - SQS-based async agent execution
 */

import { dispatch, dispatchLocal, type DispatchOptions, type DispatchResult } from './client.js';
import { createLambdaHandler, type WorkerHandler } from './handler.js';
import type { ZodType, z } from 'zod';

export * from './client.js';
export * from './handler.js';
export * from './config.js';

/**
 * Configuration for a worker's Lambda function deployment.
 * 
 * **Best Practice**: Export this as a separate const from your worker file:
 * ```typescript
 * export const workerConfig: WorkerConfig = {
 *   timeout: 900,
 *   memorySize: 2048,
 *   layers: ['arn:aws:lambda:${aws:region}:${aws:accountId}:layer:ffmpeg:1'],
 * };
 * ```
 * 
 * The CLI will automatically extract it from the export. You do not need to pass it to `createWorker()`.
 */
export interface WorkerConfig {
  /**
   * Lambda function timeout in seconds (max 900).
   */
  timeout?: number;
  /**
   * Lambda function memory size in MB (128-10240).
   */
  memorySize?: number;
  /**
   * Optional Lambda layers ARNs to attach to this worker function.
   *
   * This is primarily used by @microfox/ai-worker-cli when generating serverless.yml.
   * Supports CloudFormation pseudo-parameters like ${aws:region} and ${aws:accountId}.
   *
   * Example:
   *   layers: ['arn:aws:lambda:${aws:region}:${aws:accountId}:layer:ffmpeg:1']
   */
  layers?: string[];
}

export interface WorkerAgentConfig<INPUT_SCHEMA extends ZodType<any>, OUTPUT> {
  id: string;
  inputSchema: INPUT_SCHEMA;
  outputSchema: ZodType<OUTPUT>;
  handler: WorkerHandler<z.infer<INPUT_SCHEMA>, OUTPUT>;
  /**
   * @deprecated Prefer exporting `workerConfig` as a separate const from your worker file.
   * The CLI will automatically extract it from the export. This parameter is kept for backward compatibility.
   */
  workerConfig?: WorkerConfig;
}

export interface WorkerAgent<INPUT_SCHEMA extends ZodType<any>, OUTPUT> {
  id: string;
  dispatch: (
    input: z.input<INPUT_SCHEMA>,
    options: DispatchOptions
  ) => Promise<DispatchResult>;
  handler: WorkerHandler<z.infer<INPUT_SCHEMA>, OUTPUT>;
  inputSchema: INPUT_SCHEMA;
  outputSchema: ZodType<OUTPUT>;
  workerConfig?: WorkerConfig;
}

/**
 * Creates a worker agent that can be dispatched to SQS/Lambda.
 *
 * In development mode (NODE_ENV === 'development' and WORKERS_LOCAL_MODE !== 'false'),
 * dispatch() will run the handler immediately in the same process.
 *
 * In production, dispatch() sends a message to SQS which triggers a Lambda function.
 *
 * @template INPUT_SCHEMA - The Zod schema type (e.g., `typeof InputSchema`).
 *                          Used to derive both:
 *                          - Pre-parse input type via `z.input<INPUT_SCHEMA>` for `dispatch()` (preserves optional fields)
 *                          - Parsed input type via `z.infer<INPUT_SCHEMA>` for handler (defaults applied)
 * @template OUTPUT - The output type returned by the handler. Use `z.infer<typeof OutputSchema>`.
 *
 * @param config - Worker agent configuration
 * @returns A worker agent object with a dispatch method
 *
 * @example
 * ```typescript
 * const InputSchema = z.object({
 *   url: z.string().url(),
 *   timeout: z.number().optional().default(5000), // optional with default
 * });
 *
 * export const worker = createWorker<typeof InputSchema, Output>({
 *   // dispatch() accepts { url: string, timeout?: number } (pre-parse, optional preserved)
 *   // handler receives { url: string, timeout: number } (parsed, default applied)
 * });
 * ```
 */
export function createWorker<INPUT_SCHEMA extends ZodType<any>, OUTPUT>(
  config: WorkerAgentConfig<INPUT_SCHEMA, OUTPUT>
): WorkerAgent<INPUT_SCHEMA, OUTPUT> {
  const { id, inputSchema, outputSchema, handler } = config;

  const agent: WorkerAgent<INPUT_SCHEMA, OUTPUT> = {
    id,
    handler,
    inputSchema,
    outputSchema,

    async dispatch(input: z.input<INPUT_SCHEMA>, options: DispatchOptions): Promise<DispatchResult> {
      const mode = options.mode ?? 'auto';
      const envWantsLocal =
        process.env.NODE_ENV === 'development' &&
        process.env.WORKERS_LOCAL_MODE !== 'false';
      // Check if we're in local development mode
      const isLocal = mode === 'local' || (mode === 'auto' && envWantsLocal);

      if (isLocal) {
        // Local mode: run handler immediately
        // Parse input to apply defaults and get the final parsed type
        const parsedInput = inputSchema.parse(input);
        try {
          const output = await dispatchLocal(handler, parsedInput, {
            jobId: options.jobId || `local-${Date.now()}`,
            workerId: id,
          });

          // Still send webhook if provided (useful for testing webhook flow)
          if (options.webhookUrl) {
            try {
              await fetch(options.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jobId: options.jobId || `local-${Date.now()}`,
                  workerId: id,
                  status: 'success',
                  output,
                  metadata: options.metadata,
                }),
              });
            } catch (error) {
              console.warn('Local webhook call failed:', error);
            }
          }

          return {
            messageId: `local-${Date.now()}`,
            status: 'queued',
            jobId: options.jobId || `local-${Date.now()}`,
          };
        } catch (error: any) {
          // Send error webhook if provided
          if (options.webhookUrl) {
            try {
              await fetch(options.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jobId: options.jobId || `local-${Date.now()}`,
                  workerId: id,
                  status: 'error',
                  error: {
                    message: error.message || 'Unknown error',
                    stack: error.stack,
                    name: error.name || 'Error',
                  },
                  metadata: options.metadata,
                }),
              });
            } catch (webhookError) {
              console.warn('Local error webhook call failed:', webhookError);
            }
          }
          throw error;
        }
      }

      // Production mode: dispatch to SQS
      return dispatch(id, input, inputSchema, options);
    },
  };

  return agent;
}

/**
 * Creates a Lambda handler entrypoint for a worker agent.
 * This is used by the deployment script to generate Lambda entrypoints.
 *
 * @param agent - The worker agent
 * @returns A Lambda handler function
 */
export function createLambdaEntrypoint<INPUT_SCHEMA extends ZodType<any>, OUTPUT>(
  agent: WorkerAgent<INPUT_SCHEMA, OUTPUT>
) {
  return createLambdaHandler(agent.handler, agent.outputSchema);
}
