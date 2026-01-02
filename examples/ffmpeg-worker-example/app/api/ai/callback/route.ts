/**
 * Webhook receiver for background worker callbacks.
 * Receives completion notifications from Lambda workers and updates application state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const WebhookPayloadSchema = z.object({
  jobId: z.string(),
  workerId: z.string(),
  status: z.enum(['success', 'error']),
  output: z.any().optional(),
  error: z
    .object({
      message: z.string(),
      stack: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

/**
 * Verifies the webhook signature if WEBHOOK_SECRET is configured.
 */
function verifySignature(
  payload: string,
  signature: string | null
): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    // If no secret is configured, allow all requests (development mode)
    return true;
  }

  // Simple HMAC verification (you may want to use crypto.createHmac for production)
  // For now, we'll use a simple comparison - in production, use proper HMAC
  const expectedSignature = Buffer.from(secret).toString('base64');
  return signature === expectedSignature;
}

/**
 * Handles webhook callbacks from background workers.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate payload
    const payload = WebhookPayloadSchema.parse(body);
    console.log("got webhook payload", payload);
    // Optional: Verify signature if configured
    const signature = request.headers.get('x-webhook-signature');
    if (!verifySignature(JSON.stringify(body), signature)) {
      console.log("invalid signature", signature);
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    const { jobId, workerId, status, output, error, metadata } = payload;

    // Log the callback
    console.log(`[Webhook] Worker ${workerId} job ${jobId}: ${status}`);

    // Update job store in the agent layer (not in the worker)
    const { markSuccess, markError, appendLog } = await import('../../worker-jobs/jobStore');

    if (status === 'success') {
      // Handle successful completion
      console.log(`[Webhook] Job ${jobId} completed successfully`);
      await markSuccess(jobId, output);
      await appendLog(jobId, 'Job completed successfully');
    } else if (status === 'error' && error) {
      // Handle error
      console.error(`[Webhook] Job ${jobId} failed:`, error);
      await markError(jobId, error);
      await appendLog(jobId, `Job failed: ${error.message}`);
    }

    // Return success response
    return NextResponse.json(
      { success: true, jobId, workerId },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[Webhook] Error processing callback:', error);

    // If it's a validation error, return 400
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid payload', details: error?.message || 'Unknown error' },
        { status: 400 }
      );
    }

    // Otherwise, return 500
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Health check endpoint.
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'ai-router-webhook-receiver',
  });
}

