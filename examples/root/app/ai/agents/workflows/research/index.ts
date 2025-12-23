import { createWorkflow, createStep } from '@microfox/ai-router';
import { z } from 'zod';
import { aiRouter } from '../shared';

// Define Steps - types are automatically inferred from Zod schemas!
const searchInputSchema = z.object({ query: z.string() });
const searchStep = createStep({
  id: 'search-web',
  input: searchInputSchema,
  output: z.array(z.string()),
  run: async (input: z.infer<typeof searchInputSchema>) => {
    // Simulate web search - in real app, this would call Brave Search API
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate delay
    return [
      `Result 1: Comprehensive analysis of ${input.query}`,
      `Result 2: Latest trends in ${input.query}`,
      `Result 3: Expert opinions on ${input.query}`,
    ];
  },
  retry: { maxAttempts: 3, backoff: 'exponential' },
});

const summarizeInputSchema = z.object({ results: z.array(z.string()) });
const summarizeStep = createStep({
  id: 'summarize-results',
  input: summarizeInputSchema,
  output: z.object({ summary: z.string(), keyPoints: z.array(z.string()) }),
  run: async (input: z.infer<typeof summarizeInputSchema>) => {
    // Simulate summarization
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      summary: `Summary of ${input.results.length} research results`,
      keyPoints: input.results.slice(0, 3),
    };
  },
});

const emailInputSchema = z.object({
  body: z.string(),
  recipient: z.string().email(),
});
const emailStep = createStep({
  id: 'send-email',
  input: emailInputSchema,
  output: z.object({ success: z.boolean(), messageId: z.string() }),
  run: async (input: z.infer<typeof emailInputSchema>) => {
    // Simulate email sending
    console.log(`[EMAIL] Sending to ${input.recipient}: ${input.body.substring(0, 50)}...`);
    await new Promise(resolve => setTimeout(resolve, 300));
    return {
      success: true,
      messageId: `msg_${Date.now()}`,
    };
  },
});

// Define Workflow - types inferred from Zod schemas
const researchInputSchema = z.object({
  topic: z.string(),
  email: z.string().email(),
});
const researchOutputSchema = z.object({ status: z.string(), summaryUrl: z.string().optional() });

const researchWorkflow = createWorkflow({
  id: 'research-workflow-v1',
  version: '1.0',
  input: researchInputSchema,
  output: researchOutputSchema,
  handler: async (ctx: any) => {
    // Types are inferred from schemas - ctx.input is properly typed
    const { topic, email } = ctx.input as z.infer<typeof researchInputSchema>;

    // Step 1: Search
    const results = await ctx.run(searchStep, { query: topic });

    if (results.length === 0) {
      return ctx.complete({ status: 'failed', summaryUrl: undefined });
    }

    // Step 2: Summarize
    const summary = await ctx.run(summarizeStep, { results });

    // Step 3: HITL - Wait for human approval
    const reviewSchema = z.object({
      decision: z.enum(['approve', 'reject']),
      feedback: z.string().optional(),
    });
    const review = await ctx.waitForEvent('review', {
      timeout: '24h',
      schema: reviewSchema,
      ui: {
        title: 'Approve Research Report',
        description: `Review the research summary for "${topic}" before sending.`,
        components: [
          {
            type: 'markdown',
            content: `## Summary\n\n${summary.summary}\n\n## Key Points\n\n${summary.keyPoints.map((p: string) => `- ${p}`).join('\n')}`,
          },
        ],
      },
    }) as z.infer<typeof reviewSchema>;

    if (review.decision === 'reject') {
      return ctx.complete({
        status: 'rejected',
        summaryUrl: undefined,
      });
    }

    // Step 4: Send email
    const emailResult = await ctx.run(emailStep, {
      body: `${summary.summary}\n\nKey Points:\n${summary.keyPoints.map((p: string) => `- ${p}`).join('\n')}`,
      recipient: email,
    });

    return ctx.complete({
      status: 'completed',
      summaryUrl: `https://example.com/summary/${emailResult.messageId}`,
    });
  },
});

// Mount workflow on router - storage is auto-configured from microfox.config.ts
aiRouter.useWorkflow(
  '/workflows/research',
  researchWorkflow,
  {
    exposeAsTool: true,
  }
);

