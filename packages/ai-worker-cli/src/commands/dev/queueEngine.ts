/**
 * In-memory queue standing in for SQS in `ai-worker dev`.
 *
 * Per-worker FIFO lanes with a concurrency cap; failures are re-enqueued up to
 * maxReceiveCount (mirrors the SQS redrive policy), then land in a local DLQ
 * list (printed + queryable via GET /dlq). Every invocation is wrapped in
 * try/catch so one worker's crash never kills the server.
 *
 * Fidelity notes (documented trade-offs): delivery is exactly-once (SQS is
 * at-least-once) and all workers share one event loop, so CPU-bound work
 * blocks other runs. Use a real AWS stage for concurrency/infra fidelity.
 */

import { randomUUID } from 'crypto';
import chalk from 'chalk';
import type { SQSMessageBody } from '@microfox/ai-worker/handler';

export interface DevQueueMessage {
  messageId: string;
  workerId: string;
  body: SQSMessageBody;
  /** 1-based, mirrors SQS ApproximateReceiveCount. */
  receiveCount: number;
  enqueuedAt: string;
}

export interface DevDlqEntry {
  messageId: string;
  workerId: string;
  jobId?: string;
  error: string;
  receiveCount: number;
  failedAt: string;
  body: SQSMessageBody;
}

export interface DevQueueEngineOptions {
  /** Max concurrent invocations per worker (SQS-Lambda-ish). */
  concurrency: number;
  /** Attempts before a message lands in the DLQ (SQS maxReceiveCount). */
  maxReceiveCount: number;
  /** Delay between retry attempts. */
  retryDelayMs?: number;
  /** Invoke the worker for one message; throwing marks the attempt failed. */
  invoke: (message: DevQueueMessage) => Promise<void>;
  /**
   * Decide whether a failed message should be redelivered. Mirrors deployed
   * behavior: once a job is recorded terminal in the job store, SQS redelivery
   * is a no-op (idempotency skip), so redelivering locally is pointless — the
   * failure is already visible on the job record. Returning false skips both
   * the retry AND the DLQ. Failures that never reached the store (module load
   * errors, store outages) stay retriable and eventually land in the DLQ.
   */
  shouldRetry?: (message: DevQueueMessage, error: unknown) => Promise<boolean>;
}

interface Lane {
  pending: DevQueueMessage[];
  active: number;
}

export class DevQueueEngine {
  readonly dlq: DevDlqEntry[] = [];
  private lanes = new Map<string, Lane>();
  private stopped = false;

  constructor(private options: DevQueueEngineOptions) {}

  /** Accepts a message like SQS SendMessage would; returns the local message id. */
  enqueue(workerId: string, body: SQSMessageBody, delaySeconds?: number): string {
    const message: DevQueueMessage = {
      messageId: randomUUID(),
      workerId,
      body,
      receiveCount: 1,
      enqueuedAt: new Date().toISOString(),
    };
    this.schedule(message, Math.max(0, Math.floor(delaySeconds ?? 0)) * 1000);
    return message.messageId;
  }

  private schedule(message: DevQueueMessage, delayMs: number): void {
    if (delayMs > 0) {
      setTimeout(() => this.push(message), delayMs);
    } else {
      this.push(message);
    }
  }

  private lane(workerId: string): Lane {
    let lane = this.lanes.get(workerId);
    if (!lane) {
      lane = { pending: [], active: 0 };
      this.lanes.set(workerId, lane);
    }
    return lane;
  }

  private push(message: DevQueueMessage): void {
    if (this.stopped) return;
    this.lane(message.workerId).pending.push(message);
    this.pump(message.workerId);
  }

  private pump(workerId: string): void {
    const lane = this.lane(workerId);
    while (lane.active < this.options.concurrency && lane.pending.length > 0) {
      const message = lane.pending.shift()!;
      lane.active++;
      void this.run(message, lane);
    }
  }

  private async run(message: DevQueueMessage, lane: Lane): Promise<void> {
    try {
      await this.options.invoke(message);
    } catch (error: any) {
      const errorMessage = error?.message ?? String(error);
      let retriable = true;
      if (this.options.shouldRetry) {
        try {
          retriable = await this.options.shouldRetry(message, error);
        } catch {
          retriable = true;
        }
      }
      if (!retriable) {
        console.warn(
          chalk.yellow(
            `[dev] ${message.workerId} job ${(message.body as { jobId?: string })?.jobId} recorded as failed in the job store — not redelivering (matches deployed idempotency; use the worker's retry config for in-process retries). See GET /jobs/{jobId}.`
          )
        );
      } else if (message.receiveCount < this.options.maxReceiveCount) {
        console.warn(
          chalk.yellow(
            `[dev] ${message.workerId} failed (attempt ${message.receiveCount}/${this.options.maxReceiveCount}), retrying: ${errorMessage}`
          )
        );
        const retry: DevQueueMessage = { ...message, receiveCount: message.receiveCount + 1 };
        setTimeout(() => this.push(retry), this.options.retryDelayMs ?? 1000);
      } else {
        this.dlq.push({
          messageId: message.messageId,
          workerId: message.workerId,
          jobId: (message.body as { jobId?: string })?.jobId,
          error: errorMessage,
          receiveCount: message.receiveCount,
          failedAt: new Date().toISOString(),
          body: message.body,
        });
        console.error(
          chalk.red(
            `[dev] ${message.workerId} failed ${message.receiveCount}× — message moved to local DLQ (GET /dlq): ${errorMessage}`
          )
        );
      }
    } finally {
      lane.active--;
      this.pump(message.workerId);
    }
  }

  stats(): { workers: Record<string, { pending: number; active: number }>; dlqSize: number } {
    const workers: Record<string, { pending: number; active: number }> = {};
    for (const [workerId, lane] of this.lanes) {
      if (lane.pending.length > 0 || lane.active > 0) {
        workers[workerId] = { pending: lane.pending.length, active: lane.active };
      }
    }
    return { workers, dlqSize: this.dlq.length };
  }

  stop(): void {
    this.stopped = true;
  }
}
