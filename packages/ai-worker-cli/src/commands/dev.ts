/**
 * `ai-worker dev` — local dev server (Plan F): one HTTP server exposing the
 * deployed core-group surface, workers invoked in-process, in-memory queue
 * standing in for SQS, local file-persisted job store, hot reload without
 * restarts. Zero AWS, zero microfox platform required.
 */

import { Command } from 'commander';
import chalk from 'chalk';

function parsePositiveInt(label: string, raw: string, fallback: number): number {
  const value = parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    console.warn(chalk.yellow(`⚠️  Invalid ${label} "${raw}" — using ${fallback}`));
    return fallback;
  }
  return value;
}

export const devCommand = new Command('dev')
  .description(
    'Run workers locally: one HTTP server (same routes as a deployed core group), in-process worker invocation, in-memory queue, hot reload. No AWS or microfox account needed.'
  )
  .option('-p, --port <port>', 'HTTP port', '4100')
  .option('--ai-path <path>', 'directory scanned for *.worker.ts / queues/*.queue.ts', 'app/ai')
  .option('-c, --concurrency <n>', 'max concurrent runs per worker', '5')
  .option(
    '--max-receive-count <n>',
    'delivery attempts before a message lands in the local DLQ',
    '3'
  )
  .addHelpText(
    'after',
    `
Environment:
  Loads .env → .env.local → .env.dev → .env.dev.local (later wins; shell env wins over files).
  Sets ENVIRONMENT/STAGE/NODE_ENV=dev. Uses a local file-persisted job store
  (.microfox/dev-state.json) unless Upstash/Mongo env or WORKER_DATABASE_TYPE says otherwise.

Point your app at it:
  WORKER_BASE_URL=http://localhost:4100

Routes:
  POST /workers/trigger, GET /workers/config, GET /docs.json, POST /queues/{id}/start
  Dev extras: GET /jobs/{jobId}, GET /jobs, GET /dlq, GET /health
`
  )
  .action(async (options: { port: string; aiPath: string; concurrency: string; maxReceiveCount: string }) => {
    const { startDevServer } = await import('./dev/start.js');
    await startDevServer({
      port: parsePositiveInt('--port', options.port, 4100),
      aiPath: options.aiPath,
      concurrency: parsePositiveInt('--concurrency', options.concurrency, 5),
      maxReceiveCount: parsePositiveInt('--max-receive-count', options.maxReceiveCount, 3),
    });
  });
