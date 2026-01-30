/**
 * Generic Lambda handler wrapper for worker agents.
 * Handles SQS events, executes user handlers, and sends webhook callbacks.
 * Job store: MongoDB only. Never uses HTTP/origin URL for job updates.
 */

import type { SQSEvent, SQSRecord, Context as LambdaContext } from 'aws-lambda';
import type { ZodType } from 'zod';
import {
  createMongoJobStore,
  upsertJob,
  isMongoJobStoreConfigured,
} from './mongoJobStore';

export interface JobStoreUpdate {
  status?: 'queued' | 'running' | 'completed' | 'failed';
  metadata?: Record<string, any>;
  progress?: number;
  progressMessage?: string;
  output?: any;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

export interface JobStore {
  /**
   * Update job in job store.
   * @param update - Update object with status, metadata, progress, output, or error
   */
  update(update: JobStoreUpdate): Promise<void>;
  /**
   * Get current job record from job store.
   * @returns Job record or null if not found
   */
  get(): Promise<{
    jobId: string;
    workerId: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    input: any;
    output?: any;
    error?: { message: string; stack?: string };
    metadata?: Record<string, any>;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
  } | null>;
}

export interface WorkerHandlerParams<INPUT, OUTPUT> {
  input: INPUT;
  ctx: {
    jobId: string;
    workerId: string;
    requestId?: string;
    /**
     * Job store interface for updating and retrieving job state.
     * Uses MongoDB directly when configured; never HTTP/origin URL.
     */
    jobStore?: JobStore;
    [key: string]: any;
  };
}

export type WorkerHandler<INPUT, OUTPUT> = (
  params: WorkerHandlerParams<INPUT, OUTPUT>
) => Promise<OUTPUT>;

export interface SQSMessageBody {
  workerId: string;
  jobId: string;
  input: any;
  context: Record<string, any>;
  webhookUrl?: string;
  /** @deprecated Never use. Job updates use MongoDB only. */
  jobStoreUrl?: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

export interface WebhookPayload {
  jobId: string;
  workerId: string;
  status: 'success' | 'error';
  output?: any;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
  metadata?: Record<string, any>;
}

/**
 * Sends a webhook callback to the specified URL.
 */
async function sendWebhook(
  webhookUrl: string,
  payload: WebhookPayload
): Promise<void> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ai-router-worker/1.0',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('[Worker] Webhook callback failed:', {
        url: webhookUrl,
        status: response.status,
        statusText: response.statusText,
        errorText,
      });
      // Don't throw - webhook failures shouldn't fail the Lambda
    } else {
      console.log('[Worker] Webhook callback successful:', {
        url: webhookUrl,
        status: response.status,
      });
    }
  } catch (error: any) {
    console.error('[Worker] Webhook callback error:', {
      url: webhookUrl,
      error: error?.message || String(error),
      stack: error?.stack,
    });
    // Don't throw - webhook failures shouldn't fail the Lambda
  }
}

/**
 * Creates a Lambda handler function that processes SQS events for workers.
 * Job store: MongoDB only. Never uses HTTP/origin URL for job updates.
 *
 * @param handler - The user's worker handler function
 * @param outputSchema - Optional Zod schema for output validation
 * @returns A Lambda handler function
 */
export function createLambdaHandler<INPUT, OUTPUT>(
  handler: WorkerHandler<INPUT, OUTPUT>,
  outputSchema?: ZodType<OUTPUT>
): (event: SQSEvent, context: LambdaContext) => Promise<void> {
  return async (event: SQSEvent, lambdaContext: LambdaContext) => {
    const promises = event.Records.map(async (record: SQSRecord) => {
      let messageBody: SQSMessageBody | null = null;
      try {
        messageBody = JSON.parse(record.body) as SQSMessageBody;

        const { workerId, jobId, input, context, webhookUrl, metadata = {} } =
          messageBody;

        let jobStore: JobStore | undefined;
        if (isMongoJobStoreConfigured()) {
          await upsertJob(jobId, workerId, input, metadata);
          jobStore = createMongoJobStore(workerId, jobId, input, metadata);
        }

        const handlerContext = {
          jobId,
          workerId,
          requestId: context.requestId || lambdaContext.awsRequestId,
          ...(jobStore ? { jobStore } : {}),
          ...context,
        };

        if (jobStore) {
          try {
            await jobStore.update({ status: 'running' });
            console.log('[Worker] Job status updated to running:', {
              jobId,
              workerId,
            });
          } catch (error: any) {
            console.warn('[Worker] Failed to update status to running:', {
              jobId,
              workerId,
              error: error?.message || String(error),
            });
          }
        }

        let output: OUTPUT;
        try {
          output = await handler({
            input: input as INPUT,
            ctx: handlerContext,
          });

          if (outputSchema) {
            output = outputSchema.parse(output);
          }
        } catch (error: any) {
          const errorPayload: WebhookPayload = {
            jobId,
            workerId,
            status: 'error',
            error: {
              message: error.message || 'Unknown error',
              stack: error.stack,
              name: error.name || 'Error',
            },
            metadata,
          };

          if (jobStore) {
            try {
              await jobStore.update({
                status: 'failed',
                error: errorPayload.error,
              });
              console.log('[Worker] Job status updated to failed:', {
                jobId,
                workerId,
              });
            } catch (updateError: any) {
              console.warn('[Worker] Failed to update job store on error:', {
                jobId,
                workerId,
                error: updateError?.message || String(updateError),
              });
            }
          }

          if (webhookUrl) {
            await sendWebhook(webhookUrl, errorPayload);
          }
          throw error;
        }

        if (jobStore) {
          try {
            await jobStore.update({
              status: 'completed',
              output,
            });
            console.log('[Worker] Job status updated to completed:', {
              jobId,
              workerId,
            });
          } catch (updateError: any) {
            console.warn('[Worker] Failed to update job store on success:', {
              jobId,
              workerId,
              error: updateError?.message || String(updateError),
            });
          }
        }

        console.log('[Worker] Job completed:', {
          jobId,
          workerId,
          output,
        });

        const successPayload: WebhookPayload = {
          jobId,
          workerId,
          status: 'success',
          output,
          metadata,
        };

        if (webhookUrl) {
          await sendWebhook(webhookUrl, successPayload);
        }
      } catch (error: any) {
        console.error('[Worker] Error processing SQS record:', {
          jobId: messageBody?.jobId ?? '(parse failed)',
          workerId: messageBody?.workerId ?? '(parse failed)',
          error: error?.message || String(error),
          stack: error?.stack,
        });
        throw error;
      }
    });

    await Promise.all(promises);
  };
}
