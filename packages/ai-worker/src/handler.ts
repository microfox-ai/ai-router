/**
 * Generic Lambda handler wrapper for worker agents.
 * Handles SQS events, executes user handlers, and sends webhook callbacks.
 */

import type { SQSEvent, SQSRecord, Context as LambdaContext } from 'aws-lambda';
import type { ZodType } from 'zod';

export interface WorkerHandlerParams<INPUT, OUTPUT> {
  input: INPUT;
  ctx: {
    jobId: string;
    workerId: string;
    requestId?: string;
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
      console.error(
        `Webhook callback failed: ${response.status} ${response.statusText}`
      );
      // Don't throw - webhook failures shouldn't fail the Lambda
    }
  } catch (error) {
    console.error('Webhook callback error:', error);
    // Don't throw - webhook failures shouldn't fail the Lambda
  }
}

/**
 * Creates a Lambda handler function that processes SQS events for workers.
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
    // Process each SQS record
    const promises = event.Records.map(async (record: SQSRecord) => {
      try {
        // Parse message body
        const messageBody: SQSMessageBody = JSON.parse(record.body);

        const { workerId, jobId, input, context, webhookUrl, metadata } =
          messageBody;

        // Reconstruct context for handler
        const handlerContext = {
          jobId,
          workerId,
          requestId: context.requestId || lambdaContext.awsRequestId,
          ...context,
        };

        // Execute handler
        let output: OUTPUT;
        try {
          output = await handler({
            input: input as INPUT,
            ctx: handlerContext,
          });

          // Validate output if schema provided
          if (outputSchema) {
            output = outputSchema.parse(output);
          }
        } catch (error: any) {
          // Handler execution error
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

          if (webhookUrl) {
            await sendWebhook(webhookUrl, errorPayload);
          }
          throw error; // Re-throw to trigger SQS retry
        }

        // Send success webhook
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
        // Log error for CloudWatch
        console.error('Error processing SQS record:', error);

        // If this is a handler error, it was already sent to webhook
        // For other errors (parsing, webhook), we still want to throw
        // to trigger SQS retry mechanism
        throw error;
      }
    });

    // Wait for all records to be processed
    await Promise.all(promises);
  };
}
