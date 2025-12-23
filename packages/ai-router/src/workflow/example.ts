/**
 * Example usage of the workflow runtime in ai-router.
 * 
 * This demonstrates the complete DX for creating durable workflows
 * with HITL support.
 */

import { AiRouter, createWorkflow, createStep } from '../index.js';
import { z } from 'zod';

// 1. Define Steps
const searchStep = createStep({
  id: 'search-web',
  input: z.object({ query: z.string() }),
  output: z.array(z.string()),
  run: async (input) => {
    // Simulate web search
    return [`Result 1 for ${input.query}`, `Result 2 for ${input.query}`];
  },
  retry: { maxAttempts: 3, backoff: 'exponential' },
});

const emailStep = createStep({
  id: 'send-email',
  input: z.object({
    body: z.string(),
    recipient: z.string().email(),
  }),
  output: z.object({ success: z.boolean() }),
  run: async (input) => {
    // Simulate email sending
    console.log(`Sending email to ${input.recipient}: ${input.body}`);
    return { success: true };
  },
});

// 2. Define Workflow
const researchWorkflow = createWorkflow({
  id: 'research-agent-v1',
  version: '1.0',
  input: z.object({
    topic: z.string(),
    email: z.string().email(),
  }),
  output: z.object({ status: z.string() }),
  handler: async (ctx) => {
    const { topic, email } = ctx.input;

    // Step execution
    const results = await ctx.run(searchStep, { query: topic });

    if (results.length === 0) {
      return ctx.complete({ status: 'failed' });
    }

    // Sleep example (durable timer)
    await ctx.sleep('1h');

    // HITL with full typing
    const review = await ctx.waitForEvent<{ decision: 'approve' | 'reject' }>('review', {
      timeout: '24h',
      schema: z.object({ decision: z.enum(['approve', 'reject']) }),
      ui: {
        title: 'Approve Research',
        description: 'Review the findings before sending',
      },
    });

    if (review.decision === 'reject') {
      return ctx.complete({ status: 'rejected' });
    }

    // Send email
    await ctx.run(emailStep, {
      body: results.join('\n'),
      recipient: email,
    });

    return ctx.complete({ status: 'approved' });
  },
});

// 3. Mount on Router
const router = new AiRouter();
router.useWorkflow('/agent/research', researchWorkflow, {
  exposeAsTool: true, // Also creates .actAsTool() entry
});

// Now available:
// POST /agent/research - start workflow
// GET /agent/research/:id - get status
// POST /agent/research/:id/signal - send HITL signal

export { router, researchWorkflow };

