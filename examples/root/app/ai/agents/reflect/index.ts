import { AiRouter } from '@microfox/ai-router';
import { z } from 'zod';

const aiRouter = new AiRouter();

/**
 * Reflect Agent
 * Returns branch and note for orchestration-test workflows.
 * Verifies which conditional branch ran (e.g. branch: 'then' | 'else').
 */
export const reflectAgent = aiRouter
  .agent('/', async (ctx) => {
    ctx.response.writeMessageMetadata({ loader: 'Reflecting...' });
    const { branch, note } = ctx.request.params;
    return {
      branch: String(branch ?? 'unknown'),
      note: note != null ? String(note) : undefined,
      reflectedAt: new Date().toISOString(),
    };
  })
  .actAsTool('/', {
    id: 'reflect',
    name: 'Reflect',
    description: 'Reflects branch and note for orchestration-test workflows',
    inputSchema: z.object({
      branch: z.string().describe('Branch identifier (e.g. "then" | "else")'),
      note: z.string().optional().describe('Optional note'),
    }) as any,
    outputSchema: z.object({
      branch: z.string(),
      note: z.string().optional(),
      reflectedAt: z.string(),
    }) as any,
    metadata: { icon: '🪞', title: 'Reflect', hideUI: false },
  });
