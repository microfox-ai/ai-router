import { AiRouter } from '@microfox/ai-router';
import { z } from 'zod';

const aiRouter = new AiRouter();

/**
 * Emitter Agent
 * Emits known values for orchestration-test workflows.
 * Used with whenStep to drive conditionals (e.g. whenStep('emitter', 'label', 'eq', 'go')).
 */
export const emitterAgent = aiRouter
  .agent('/', async (ctx) => {
    ctx.response.writeMessageMetadata({ loader: 'Emitting...' });
    const { seed, label } = ctx.request.params;
    return {
      seed: Number(seed),
      label: String(label),
      emittedAt: new Date().toISOString(),
    };
  })
  .actAsTool('/', {
    id: 'emitter',
    name: 'Emitter',
    description: 'Emits seed and label for orchestration-test workflows',
    inputSchema: z.object({
      seed: z.number().describe('Numeric seed'),
      label: z.string().describe('Label (e.g. "go" for conditionals)'),
    }) as any,
    outputSchema: z.object({
      seed: z.number(),
      label: z.string(),
      emittedAt: z.string(),
    }) as any,
    metadata: { icon: '📤', title: 'Emitter', hideUI: false },
  });
