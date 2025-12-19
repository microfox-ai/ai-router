/**
 * ffprobe worker - Analyze media files
 *
 * A simple and cool worker that analyzes media files using ffprobe.
 * Downloads a media file, runs ffprobe to extract metadata, and returns
 * a clean summary with duration, resolution, fps, and more.
 *
 * Lambda setup:
 * - Attach an ffmpeg/ffprobe Lambda Layer that provides /opt/bin/ffprobe
 * - Set env: FFPROBE_PATH=/opt/bin/ffprobe (optional; defaults to /opt/bin/ffprobe on Lambda)
 */

import { createWorker, type WorkerConfig } from '@microfox/ai-worker';
import { z } from 'zod';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { WorkerHandlerParams } from '@microfox/ai-worker/handler';

const InputSchema = z.object({
  mediaUrl: z.string().url(),
  /**
   * Hard cap to avoid downloading huge files in this example worker.
   */
  maxBytes: z.number().int().min(128 * 1024).max(30 * 1024 * 1024).optional().default(8 * 1024 * 1024),
  timeoutMs: z.number().int().min(1000).max(120_000).optional().default(30_000),
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
}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
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
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

function safeNumber(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function parseFps(rate: any): number | null {
  if (!rate || typeof rate !== 'string') return null;
  const [a, b] = rate.split('/').map((s) => Number(s));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  const fps = a / b;
  return Number.isFinite(fps) ? fps : null;
}

export const workerConfig: WorkerConfig = {
  timeout: 300,
  memorySize: 1024,
  layers: ['arn:aws:lambda:${aws:region}:${aws:accountId}:layer:ffmpeg:1'],
};

export const ffprobeWorker = createWorker<typeof InputSchema, Output>({
  id: 'ffprobe-media-summary',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async ({ input, ctx }: WorkerHandlerParams<Input, Output>) => {
    const start = Date.now();

    const { filePath, bytes } = await downloadToTmp(input.mediaUrl, input.maxBytes);

    const ffprobePath = resolveFfprobePath();
    const notes: string[] = [];
    if (isLambda()) notes.push('Running in AWS Lambda environment');
    if (process.env.FFPROBE_PATH) notes.push('FFPROBE_PATH provided via env');
    else if (isLambda()) notes.push('Defaulting ffprobePath to /opt/bin/ffprobe (Lambda Layer expected)');

    // Version (helps debug "works in Lambda" quickly)
    let ffprobeVersion: string | undefined = undefined;
    try {
      const v = await runCmdJson({ cmd: ffprobePath, args: ['-version'], timeoutMs: input.timeoutMs });
      ffprobeVersion = v.stdout.split('\n')[0]?.trim() || undefined;
    } catch (e: any) {
      notes.push(`ffprobe -version failed: ${String(e?.message || e)}`);
    }

    const probe = await runCmdJson({
      cmd: ffprobePath,
      args: ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      timeoutMs: input.timeoutMs,
    });

    if (probe.exitCode !== 0) {
      throw new Error(`ffprobe failed (exit=${probe.exitCode}): ${probe.stderr || probe.stdout || 'unknown error'}`);
    }

    const json = JSON.parse(probe.stdout || '{}') as any;
    const streams: any[] = Array.isArray(json.streams) ? json.streams : [];
    const format: any = json.format || {};

    const video = streams.find((s) => s?.codec_type === 'video');
    const audio = streams.find((s) => s?.codec_type === 'audio');

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

    const output = {
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
        `Completed in ${Date.now() - start}ms`,
        'Tip: In Lambda, ffprobe is typically provided by a Layer at /opt/bin/ffprobe.',
      ],
    };

    // Cleanup best-effort
    try {
      await fs.unlink(filePath);
    } catch {
      // ignore
    }

    return output;
  },
});

