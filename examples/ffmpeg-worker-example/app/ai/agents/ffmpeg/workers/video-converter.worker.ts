/**
 * Video Converter Worker - Convert videos to different formats
 *
 * A fun and useful worker that converts videos between formats using ffmpeg.
 * Supports common conversions like MP4 to WebM, resolution changes, and quality adjustments.
 *
 * Lambda setup:
 * - Attach an ffmpeg Lambda Layer that provides /opt/bin/ffmpeg
 * - Set env: FFMPEG_PATH=/opt/bin/ffmpeg (optional; defaults to /opt/bin/ffmpeg on Lambda)
 */

import { createWorker, type WorkerConfig } from '@microfox/ai-worker';
import { z } from 'zod';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { WorkerHandlerParams } from '@microfox/ai-worker/handler';

const InputSchema = z.object({
  mediaUrl: z.string().url(),
  outputFormat: z.enum(['mp4', 'webm', 'mov', 'avi']).optional().default('mp4'),
  /**
   * Target resolution (e.g., "1920x1080", "1280x720", "854x480")
   * If not provided, keeps original resolution
   */
  resolution: z.string().regex(/^\d+x\d+$/).optional(),
  /**
   * Video quality (0-51 for libx264, lower is better)
   * Default: 23 (good quality)
   */
  quality: z.number().int().min(0).max(51).optional().default(23),
  /**
   * Max file size in bytes (hard cap)
   */
  maxBytes: z.number().int().min(128 * 1024).max(100 * 1024 * 1024).optional().default(50 * 1024 * 1024),
  timeoutMs: z.number().int().min(5000).max(600_000).optional().default(300_000), // 5 minutes default
});

const OutputSchema = z.object({
  mediaUrl: z.string().url(),
  outputFormat: z.string(),
  ffmpegPath: z.string(),
  ffmpegVersion: z.string().optional(),
  inputBytes: z.number(),
  outputBytes: z.number(),
  outputPath: z.string(),
  /**
   * Base64 encoded output file (only if small enough)
   */
  outputBase64: z.string().optional(),
  conversionTimeMs: z.number(),
  notes: z.array(z.string()),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

function isLambda() {
  return Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function resolveFfmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (isLambda()) return '/opt/bin/ffmpeg';
  return 'ffmpeg';
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

  const filePath = path.join('/tmp', `ffmpeg-input-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  await fs.writeFile(filePath, Buffer.from(arrayBuf));
  return { filePath, bytes };
}

async function runCmd(params: {
  cmd: string;
  args: string[];
  timeoutMs: number;
}): Promise<void> {
  const { cmd, args, timeoutMs } = params;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stderr.on('data', (d) => (stderr += d.toString('utf-8')));
    child.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${cmd}): exit=${code} ${stderr}`));
    });
  });
}

export const workerConfig: WorkerConfig = {
  timeout: 600, // 10 minutes
  memorySize: 2048, // 2GB for video processing
  layers: ['arn:aws:lambda:${aws:region}:${aws:accountId}:layer:ffmpeg:1'],
};

export const videoConverterWorker = createWorker<typeof InputSchema, Output>({
  id: 'video-converter',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async ({ input, ctx }: WorkerHandlerParams<Input, Output>) => {
    const start = Date.now();
    const notes: string[] = [];

    // Download input file
    const { filePath: inputPath, bytes: inputBytes } = await downloadToTmp(input.mediaUrl, input.maxBytes);
    notes.push(`Downloaded ${inputBytes} bytes`);

    const ffmpegPath = resolveFfmpegPath();
    if (isLambda()) notes.push('Running in AWS Lambda environment');
    if (process.env.FFMPEG_PATH) notes.push('FFMPEG_PATH provided via env');
    else if (isLambda()) notes.push('Defaulting ffmpegPath to /opt/bin/ffmpeg (Lambda Layer expected)');

    // Get ffmpeg version
    let ffmpegVersion: string | undefined = undefined;
    try {
      const v = await new Promise<{ stdout: string }>((resolve, reject) => {
        const child = spawn(ffmpegPath, ['-version'], { stdio: ['ignore', 'pipe', 'ignore'] });
        let stdout = '';
        child.stdout.on('data', (d) => (stdout += d.toString('utf-8')));
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) resolve({ stdout });
          else reject(new Error(`ffmpeg -version failed with code ${code}`));
        });
      });
      ffmpegVersion = v.stdout.split('\n')[0]?.trim() || undefined;
    } catch (e: any) {
      notes.push(`ffmpeg -version failed: ${String(e?.message || e)}`);
    }

    // Prepare output path
    const outputPath = path.join('/tmp', `ffmpeg-output-${Date.now()}-${Math.random().toString(36).slice(2)}.${input.outputFormat}`);

    // Build ffmpeg command
    const args: string[] = [
      '-y', // Overwrite output file
      '-i', inputPath, // Input file
    ];

    // Add resolution filter if specified
    if (input.resolution) {
      args.push('-vf', `scale=${input.resolution}`);
      notes.push(`Scaling to ${input.resolution}`);
    }

    // Add quality settings
    if (input.outputFormat === 'mp4' || input.outputFormat === 'mov') {
      args.push('-c:v', 'libx264');
      args.push('-crf', String(input.quality));
      args.push('-preset', 'medium');
      args.push('-c:a', 'aac');
      args.push('-b:a', '128k');
    } else if (input.outputFormat === 'webm') {
      args.push('-c:v', 'libvpx-vp9');
      args.push('-crf', String(input.quality));
      args.push('-b:v', '0');
      args.push('-c:a', 'libopus');
      args.push('-b:a', '128k');
    } else {
      args.push('-c:v', 'libx264');
      args.push('-crf', String(input.quality));
      args.push('-c:a', 'copy');
    }

    args.push(outputPath);

    // Run conversion
    notes.push(`Converting to ${input.outputFormat}...`);
    await runCmd({
      cmd: ffmpegPath,
      args,
      timeoutMs: input.timeoutMs,
    });

    // Get output file size
    const outputStat = await fs.stat(outputPath);
    const outputBytes = outputStat.size;
    notes.push(`Output file: ${outputBytes} bytes`);

    // Optionally include base64 if file is small enough (max 10MB)
    let outputBase64: string | undefined = undefined;
    if (outputBytes < 10 * 1024 * 1024) {
      const outputBuffer = await fs.readFile(outputPath);
      outputBase64 = outputBuffer.toString('base64');
      notes.push('Output included as base64 (file is small enough)');
    } else {
      notes.push('Output file too large for base64 inclusion (upload to S3 in production)');
    }

    const conversionTimeMs = Date.now() - start;

    const output: Output = {
      mediaUrl: input.mediaUrl,
      outputFormat: input.outputFormat,
      ffmpegPath,
      ffmpegVersion,
      inputBytes,
      outputBytes,
      outputPath,
      outputBase64,
      conversionTimeMs,
      notes: [
        ...notes,
        `Conversion completed in ${conversionTimeMs}ms`,
        `Tip: In production, upload ${outputPath} to S3 for retrieval.`,
      ],
    };

    // Cleanup input file (keep output for now, caller can decide)
    try {
      await fs.unlink(inputPath);
    } catch {
      // ignore
    }

    return output;
  },
});

