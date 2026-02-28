/**
 * ffprobe worker – analyze media files.
 * Group: media – extracts metadata (duration, resolution, fps, etc.) using ffprobe.
 *
 * Lambda: attach ffmpeg Layer, set FFPROBE_PATH=/opt/bin/ffprobe if needed.
 */

import { createWorker, type WorkerConfig } from '@microfox/ai-worker';
import { z } from 'zod';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { WorkerHandlerParams } from '@microfox/ai-worker/handler';

const InputSchema = z.object({
  mediaUrl: z.string().url(),
  maxBytes: z.number().int().min(128 * 1024).max(30 * 1024 * 1024).optional().default(8 * 1024 * 1024),
  /** Timeout for download + ffprobe. Default 90s to avoid SIGKILL in Lambda (cold start + layer load). */
  timeoutMs: z.number().int().min(1000).max(300_000).optional().default(90_000),
});

const OutputSchema = z.object({
  mediaUrl: z.string().url(),
  ffprobePath: z.string(),
  ffprobeVersion: z.string().optional(),
  bytesDownloaded: z.number(),
  summary: z.object({
    durationSec: z.number().nullable(),
    containerFormat: z.string().nullable(),
    hasVideo: z.boolean(),
    hasAudio: z.boolean(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    fps: z.number().nullable(),
    orientation: z.enum(['landscape', 'portrait', 'square', 'unknown']),
  }),
  notes: z.array(z.string()),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

function isLambda() {
  return Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function resolveFfprobePath(): string {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  if (isLambda()) return '/opt/bin/ffprobe';
  return 'ffprobe';
}

async function downloadToTmp(url: string, maxBytes: number): Promise<{ filePath: string; bytes: number }> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download media: ${res.status} ${res.statusText}`);
  }

  const contentLengthHeader = res.headers.get('content-length');
  if (contentLengthHeader) {
    const n = Number(contentLengthHeader);
    if (Number.isFinite(n) && n > maxBytes) {
      throw new Error(`media too large (content-length=${n} > maxBytes=${maxBytes})`);
    }
  }

  const arrayBuf = await res.arrayBuffer();
  const bytes = arrayBuf.byteLength;
  if (bytes > maxBytes) {
    throw new Error(`media too large (downloaded=${bytes} > maxBytes=${maxBytes})`);
  }

  const ext = (() => {
    try {
      const u = new URL(url);
      const p = u.pathname;
      const e = p.includes('.') ? p.split('.').pop() : undefined;
      return e && e.length <= 6 ? `.${e}` : '';
    } catch {
      return '';
    }
  })();

  const filePath = path.join('/tmp', `ffprobe-input-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  await fs.writeFile(filePath, Buffer.from(arrayBuf));
  return { filePath, bytes };
}

async function runCmdJson(params: {
  cmd: string;
  args: string[];
  timeoutMs: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number | null; signal: NodeJS.Signals | null }> {
  const { cmd, args, timeoutMs } = params;
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const t = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d.toString('utf-8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf-8')));
    child.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    child.on('close', (code, signal) => {
      clearTimeout(t);
      resolve({ stdout, stderr, exitCode: code, signal: signal ?? null });
    });
  });
}

function safeNumber(x: unknown): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function parseFps(rate: unknown): number | null {
  if (!rate || typeof rate !== 'string') return null;
  const [a, b] = rate.split('/').map((s) => Number(s));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  const fps = a / b;
  return Number.isFinite(fps) ? fps : null;
}

export const workerConfig: WorkerConfig = {
  group: 'media',
  timeout: 300,
  memorySize: 1024,
  layers: ['arn:aws:lambda:${aws:region}:${aws:accountId}:layer:ffmpeg:1'],
};

export default createWorker<typeof InputSchema, Output>({
  id: 'ffprobe-media',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async ({ input, ctx }: WorkerHandlerParams<Input, Output>) => {
    await ctx.jobStore?.update({ status: 'running' });

    const { filePath, bytes } = await downloadToTmp(input.mediaUrl, input.maxBytes);

    const ffprobePath = resolveFfprobePath();
    const notes: string[] = [];
    if (isLambda()) notes.push('Running in AWS Lambda environment');
    if (process.env.FFPROBE_PATH) notes.push('FFPROBE_PATH provided via env');
    else if (isLambda()) notes.push('Defaulting ffprobePath to /opt/bin/ffprobe (Lambda Layer expected)');

    let ffprobeVersion: string | undefined = undefined;
    try {
      const v = await runCmdJson({ cmd: ffprobePath, args: ['-version'], timeoutMs: input.timeoutMs });
      ffprobeVersion = v.stdout.split('\n')[0]?.trim() || undefined;
    } catch (e: unknown) {
      notes.push(`ffprobe -version failed: ${String(e instanceof Error ? e.message : e)}`);
    }

    const probe = await runCmdJson({
      cmd: ffprobePath,
      args: ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      timeoutMs: input.timeoutMs,
    });

    if (probe.exitCode !== 0) {
      const detail = [probe.stderr, probe.stdout].filter(Boolean).join(' ') || 'no output';
      const reason =
        probe.exitCode == null
          ? `Process timed out or was killed (signal=${probe.signal ?? 'unknown'}). In Lambda, ensure the ffmpeg layer is attached and FFPROBE_PATH is set if needed.`
          : `exit=${probe.exitCode}`;
      throw new Error(`ffprobe failed (${reason}): ${detail}`);
    }

    const json = JSON.parse(probe.stdout || '{}') as Record<string, unknown>;
    const streams: unknown[] = Array.isArray(json.streams) ? json.streams : [];
    const format = (json.format || {}) as Record<string, unknown>;

    const video = streams.find((s) => (s as { codec_type?: string })?.codec_type === 'video') as { width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string } | undefined;
    const audio = streams.find((s) => (s as { codec_type?: string })?.codec_type === 'audio');

    const width = video?.width != null ? Number(video.width) : null;
    const height = video?.height != null ? Number(video.height) : null;
    const fps = parseFps(video?.avg_frame_rate) ?? parseFps(video?.r_frame_rate);
    const durationSec = safeNumber(format?.duration);
    const containerFormat = typeof format?.format_name === 'string' ? format.format_name : null;

    const orientation: 'landscape' | 'portrait' | 'square' | 'unknown' =
      width && height
        ? width === height
          ? 'square'
          : width > height
            ? 'landscape'
            : 'portrait'
        : 'unknown';

    const output: Output = {
      mediaUrl: input.mediaUrl,
      ffprobePath,
      ffprobeVersion,
      bytesDownloaded: bytes,
      summary: {
        durationSec,
        containerFormat,
        hasVideo: Boolean(video),
        hasAudio: Boolean(audio),
        width: Number.isFinite(width) ? (width as number) : null,
        height: Number.isFinite(height) ? (height as number) : null,
        fps,
        orientation,
      },
      notes: [
        ...notes,
        'Completed.',
        'Tip: In Lambda, ffprobe is typically provided by a Layer at /opt/bin/ffprobe.',
      ],
    };

    try {
      await fs.unlink(filePath);
    } catch {
      // ignore
    }

    await ctx.jobStore?.update({ status: 'completed', output });
    return output;
  },
});
