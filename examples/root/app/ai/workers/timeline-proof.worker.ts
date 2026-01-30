import { createWorker } from '@microfox/ai-worker';
import { z } from 'zod';

type TimedSleepOutput = {
  label: string;
  sleepMs: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

function safeParseJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Timeline Proof Worker
 *
 * Input is produced via orchestration `_fromSteps` and is therefore an array of JSON strings.
 * We parse them and compute proof of:
 * - sequential ordering (seq2 starts after seq1 ends)
 * - parallel overlap (parA and parB overlap in time)
 */
export default createWorker({
  id: 'timeline-proof',
  inputSchema: z.object({
    data: z.array(z.string()).describe('JSON strings of step outputs (_fromSteps with _path:"")'),
    expected: z.object({
      seq1: z.string(),
      seq2: z.string(),
      parA: z.string(),
      parB: z.string(),
    }),
    gate: z.object({
      token: z.string().optional(),
      payload: z.any().optional(),
    }).optional(),
  }),
  outputSchema: z.object({
    generatedAt: z.string(),
    steps: z.array(
      z.object({
        label: z.string(),
        sleepMs: z.number(),
        startedAt: z.string(),
        finishedAt: z.string(),
        durationMs: z.number(),
      }),
    ),
    proof: z.object({
      sequential: z.object({
        ok: z.boolean(),
        seq1FinishedAt: z.string().optional(),
        seq2StartedAt: z.string().optional(),
        gapMs: z.number().optional(),
      }),
      parallel: z.object({
        ok: z.boolean(),
        overlapMs: z.number().optional(),
        parA: z.object({
          startedAt: z.string().optional(),
          finishedAt: z.string().optional(),
        }),
        parB: z.object({
          startedAt: z.string().optional(),
          finishedAt: z.string().optional(),
        }),
      }),
    }),
    gate: z.object({
      token: z.string().optional(),
      payload: z.any().optional(),
    }).optional(),
    rawCount: z.number(),
    parseFailures: z.number(),
  }),
  handler: async ({ input, ctx }) => {
    await ctx.jobStore?.update({ status: 'running' });

    const parsed = input.data.map((s) => safeParseJson(s)).filter(Boolean);
    const parseFailures = input.data.length - parsed.length;

    const timed: TimedSleepOutput[] = [];
    for (const obj of parsed) {
      if (
        obj &&
        typeof obj === 'object' &&
        typeof obj.label === 'string' &&
        typeof obj.startedAt === 'string' &&
        typeof obj.finishedAt === 'string'
      ) {
        timed.push(obj as TimedSleepOutput);
      }
    }

    // Index by label
    const byLabel = new Map<string, TimedSleepOutput>();
    for (const t of timed) byLabel.set(t.label, t);

    const seq1 = byLabel.get(input.expected.seq1);
    const seq2 = byLabel.get(input.expected.seq2);
    const parA = byLabel.get(input.expected.parA);
    const parB = byLabel.get(input.expected.parB);

    // Sequential proof
    const seq1End = seq1?.finishedAt ? toMs(seq1.finishedAt) : NaN;
    const seq2Start = seq2?.startedAt ? toMs(seq2.startedAt) : NaN;
    const gapMs =
      Number.isFinite(seq1End) && Number.isFinite(seq2Start) ? seq2Start - seq1End : undefined;
    const sequentialOk = typeof gapMs === 'number' ? gapMs >= 0 : false;

    // Parallel overlap proof
    const aStart = parA?.startedAt ? toMs(parA.startedAt) : NaN;
    const aEnd = parA?.finishedAt ? toMs(parA.finishedAt) : NaN;
    const bStart = parB?.startedAt ? toMs(parB.startedAt) : NaN;
    const bEnd = parB?.finishedAt ? toMs(parB.finishedAt) : NaN;

    let overlapMs: number | undefined;
    if ([aStart, aEnd, bStart, bEnd].every((x) => Number.isFinite(x))) {
      overlapMs = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
    }
    const parallelOk = typeof overlapMs === 'number' ? overlapMs > 0 : false;

    // Timeline output sorted by startedAt
    const steps = [...timed].sort((x, y) => toMs(x.startedAt) - toMs(y.startedAt));

    const output = {
      generatedAt: new Date().toISOString(),
      steps,
      proof: {
        sequential: {
          ok: sequentialOk,
          seq1FinishedAt: seq1?.finishedAt,
          seq2StartedAt: seq2?.startedAt,
          gapMs,
        },
        parallel: {
          ok: parallelOk,
          overlapMs,
          parA: { startedAt: parA?.startedAt, finishedAt: parA?.finishedAt },
          parB: { startedAt: parB?.startedAt, finishedAt: parB?.finishedAt },
        },
      },
      gate: input.gate,
      rawCount: input.data.length,
      parseFailures,
    };

    await ctx.jobStore?.update({ status: 'completed', output });
    return output;
  },
});

