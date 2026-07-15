/**
 * `ai-worker dev` — boots the local dev server:
 *   env cascade (stage `dev`, Plan D) → local bridge + local job store (runtime
 *   seams) → registry scan → in-memory queue engine → hono HTTP server →
 *   chokidar watcher for hot reload without restarts.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { randomUUID } from 'crypto';
import chalk from 'chalk';
import chokidar from 'chokidar';
import { serve } from '@hono/node-server';
import {
  createLambdaHandler,
  wrapHandlerForQueue,
  getJobStoreKind,
  loadJobRecordById,
} from '@microfox/ai-worker/handler';
import { setLocalDispatchBridge, flushLocalJobStore } from '@microfox/ai-worker';
import { loadEnvFiles, collectEnvUsageForWorkers } from '../compile.js';
import { DevRegistry } from './registry.js';
import { DevQueueEngine, type DevQueueMessage } from './queueEngine.js';
import { createDevApp } from './server.js';

export interface DevServerCliOptions {
  port: number;
  aiPath: string;
  concurrency: number;
  maxReceiveCount: number;
}

const DEV_STAGE = 'dev';

/** Colored per-worker prefixes for the unified log stream. */
const PREFIX_COLORS = [
  chalk.cyan,
  chalk.magenta,
  chalk.green,
  chalk.yellow,
  chalk.blue,
  chalk.redBright,
  chalk.greenBright,
  chalk.magentaBright,
] as const;
const prefixColorByWorker = new Map<string, (typeof PREFIX_COLORS)[number]>();
function workerPrefix(workerId: string): string {
  let color = prefixColorByWorker.get(workerId);
  if (!color) {
    color = PREFIX_COLORS[prefixColorByWorker.size % PREFIX_COLORS.length];
    prefixColorByWorker.set(workerId, color);
  }
  return color(`[${workerId}]`);
}

/**
 * Hydrate process.env from the stage-`dev` cascade (`.env` → `.env.local` →
 * `.env.dev` → `.env.dev.local`, later wins; real shell env always wins).
 * Returns the keys WE set so a later .env edit can re-hydrate them.
 */
function hydrateDevEnv(previouslySetKeys: Set<string>): Set<string> {
  for (const key of previouslySetKeys) {
    delete process.env[key];
  }
  const setKeys = new Set<string>();
  const { env: fromFiles, filesRead } = loadEnvFiles(DEV_STAGE, { silent: true });
  for (const [key, value] of Object.entries(fromFiles)) {
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
      setKeys.add(key);
    }
  }
  if (filesRead.length > 0) {
    console.log(chalk.dim(`[dev] env files loaded: ${filesRead.join(' → ')}`));
  }
  return setKeys;
}

/** Platform identity + local-mode env. Called after the cascade so these always win. */
function applyDevPlatformEnv(projectRoot: string): void {
  process.env.ENVIRONMENT = DEV_STAGE;
  process.env.STAGE = DEV_STAGE;
  process.env.NODE_ENV = DEV_STAGE;
  process.env.AI_WORKER_LOCAL = '1';
  if (!process.env.AI_WORKER_LOCAL_STATE_PATH) {
    process.env.AI_WORKER_LOCAL_STATE_PATH = path.join(
      projectRoot,
      '.microfox',
      'dev-state.json'
    );
  }

  // Default to the local job store ONLY when no real store is reachable. An explicit
  // WORKER_DATABASE_TYPE or existing Upstash/Mongo env keeps pointing at the real store.
  if (!process.env.WORKER_DATABASE_TYPE) {
    const hasRedis = Boolean(
      process.env.WORKER_UPSTASH_REDIS_REST_URL ||
        process.env.UPSTASH_REDIS_REST_URL ||
        process.env.UPSTASH_REDIS_URL
    );
    const hasMongo = Boolean(process.env.DATABASE_MONGODB_URI || process.env.MONGODB_URI);
    if (!hasRedis && !hasMongo) {
      process.env.WORKER_DATABASE_TYPE = 'local';
    }
  }
}

/** Keep `.microfox/` out of git without touching the user's root .gitignore. */
function ensureLocalStateDirIgnored(projectRoot: string): void {
  try {
    const dir = path.join(projectRoot, '.microfox');
    fs.mkdirSync(dir, { recursive: true });
    const gitignorePath = path.join(dir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, '# created by ai-worker dev — local state, never commit\n*\n', 'utf-8');
    }
  } catch {
    // best-effort — persistence itself warns on failure
  }
}

async function warnMissingEnvKeys(registry: DevRegistry, projectRoot: string): Promise<void> {
  if (registry.workers.length === 0) return;
  const { runtimeKeys } = await collectEnvUsageForWorkers(
    registry.workers.map((w) => w.filePath),
    projectRoot
  );
  const missing = Array.from(runtimeKeys)
    .filter((key) => !process.env[key])
    .filter((key) => !key.startsWith('AWS_') && !key.startsWith('WORKER_QUEUE_URL_'))
    .sort();
  if (missing.length > 0) {
    console.warn(
      chalk.yellow(
        `⚠️  Env keys referenced in worker code but not set locally (would also be missing on deploy):\n   ${missing.join(', ')}`
      )
    );
  }
}

function printBanner(
  registry: DevRegistry,
  options: DevServerCliOptions,
  projectRoot: string
): void {
  console.log('');
  console.log(chalk.bold(`⚡ ai-worker dev`) + chalk.dim(` — stage ${DEV_STAGE}, no AWS needed`));
  console.log('');
  if (registry.workers.length === 0) {
    console.log(
      chalk.yellow(`   No workers found under ${options.aiPath}/**/*.worker.ts`)
    );
  }
  for (const worker of registry.workers) {
    const inQueue = registry.isWorkerInQueue(worker.id) ? chalk.dim(' (in queue)') : '';
    console.log(`   ${workerPrefix(worker.id)} ${chalk.dim(worker.filePath)}${inQueue}`);
  }
  for (const queue of registry.queues) {
    console.log(
      `   ${chalk.bold(`⛓ ${queue.id}`)} ${chalk.dim(
        queue.steps.map((s) => s.workerId).join(' → ')
      )}`
    );
    if (queue.schedule) {
      const scheduleStr =
        typeof queue.schedule === 'string' ? queue.schedule : JSON.stringify(queue.schedule);
      console.log(
        chalk.dim(
          `     ⏰ schedule ${scheduleStr} — NOT executed locally; start manually: POST /queues/${queue.id}/start`
        )
      );
    }
  }
  console.log('');
  const storeKind = getJobStoreKind();
  const storeNote =
    storeKind === 'local'
      ? `local (persisted to ${path.relative(projectRoot, process.env.AI_WORKER_LOCAL_STATE_PATH!)})`
      : `${storeKind} (real store from your env)`;
  console.log(`   job store   ${storeNote}`);
  console.log(
    `   auth        ${process.env.WORKERS_API_KEY ? 'WORKERS_API_KEY required' : 'open (no WORKERS_API_KEY set)'}`
  );
  console.log(`   server      http://localhost:${options.port}  (routes: GET /)`);
  console.log(chalk.dim(`   hot reload  on — edit workers freely; type "rs" + Enter to force a re-scan`));
  console.log('');
}

export async function startDevServer(options: DevServerCliOptions): Promise<void> {
  const projectRoot = process.cwd();
  const startedAt = Date.now();

  // 1. Env: Plan D cascade with stage `dev`, then platform/local-mode keys on top.
  let envFileKeys = hydrateDevEnv(new Set());
  applyDevPlatformEnv(projectRoot);
  if (getJobStoreKind() === 'local') {
    ensureLocalStateDirIgnored(projectRoot);
  } else if (getJobStoreKind() === 'upstash-redis') {
    const hasRedis = Boolean(
      process.env.WORKER_UPSTASH_REDIS_REST_URL ||
        process.env.UPSTASH_REDIS_REST_URL ||
        process.env.UPSTASH_REDIS_URL
    );
    if (!hasRedis) {
      console.warn(
        chalk.yellow(
          '⚠️  WORKER_DATABASE_TYPE=upstash-redis but no Upstash env found — job tracking will fail. Unset it (or set WORKER_DATABASE_TYPE=local) for standalone dev.'
        )
      );
    }
  }

  // 2. Registry: same scanners compile uses.
  const registry = new DevRegistry(projectRoot, options.aiPath);
  await registry.scan();
  await warnMissingEnvKeys(registry, projectRoot);

  // 3. In-memory queue engine + invoker (in-process direct invocation).
  const engine = new DevQueueEngine({
    concurrency: options.concurrency,
    maxReceiveCount: options.maxReceiveCount,
    // Redelivering a job the store already recorded as terminal is a no-op in
    // prod (idempotency skip) — don't bother locally either.
    shouldRetry: async (message) => {
      const jobId = (message.body as { jobId?: string })?.jobId;
      if (!jobId) return true;
      try {
        const job = await loadJobRecordById(jobId);
        return !(job && (job.status === 'failed' || job.status === 'completed'));
      } catch {
        return true;
      }
    },
    invoke: async (message: DevQueueMessage) => {
      const agent = await registry.loadWorkerAgent(message.workerId);
      let handler;
      if (registry.isWorkerInQueue(message.workerId)) {
        await registry.ensureQueueConfigs();
        handler = createLambdaHandler(
          wrapHandlerForQueue(agent.handler, registry.queueRuntime),
          agent.outputSchema
        );
      } else {
        handler = createLambdaHandler(agent.handler, agent.outputSchema);
      }

      // Same event/context shape the deployed wrapper receives (single-record batch).
      const event = {
        Records: [
          {
            messageId: message.messageId,
            receiptHandle: 'local',
            body: JSON.stringify(message.body),
            attributes: {
              ApproximateReceiveCount: String(message.receiveCount),
              SentTimestamp: String(Date.parse(message.enqueuedAt)),
              SenderId: 'local-dev',
              ApproximateFirstReceiveTimestamp: String(Date.now()),
            },
            messageAttributes: {},
            md5OfBody: '',
            eventSource: 'aws:sqs',
            eventSourceARN: `arn:aws:sqs:local:000000000000:local-${message.workerId}`,
            awsRegion: 'local',
          },
        ],
      };
      const lambdaContext = {
        awsRequestId: `local-${randomUUID()}`,
        functionName: `local-${message.workerId}`,
        functionVersion: '$LATEST',
        invokedFunctionArn: `arn:aws:lambda:local:000000000000:function:local-${message.workerId}`,
        memoryLimitInMB: '0',
        logGroupName: `local/${message.workerId}`,
        logStreamName: 'local',
        callbackWaitsForEmptyEventLoop: false,
        getRemainingTimeInMillis: () => 15 * 60 * 1000,
      };

      const jobId = (message.body as { jobId?: string })?.jobId ?? '?';
      console.log(`${workerPrefix(message.workerId)} ▶ run ${jobId} (gen ${registry.generation})`);
      const runStart = Date.now();
      try {
        await handler(event as any, lambdaContext as any);
        console.log(
          `${workerPrefix(message.workerId)} ■ done ${jobId} ${chalk.dim(`${Date.now() - runStart}ms`)}`
        );
      } catch (error) {
        console.log(
          `${workerPrefix(message.workerId)} ✗ failed ${jobId} ${chalk.dim(`${Date.now() - runStart}ms`)}`
        );
        throw error;
      }
    },
  });

  // 4. Runtime seam: dispatchWorker (and queue next-step sends) land here instead of SQS.
  setLocalDispatchBridge({
    enqueue: (workerId, messageBody, delaySeconds) => ({
      messageId: engine.enqueue(workerId, messageBody, delaySeconds),
    }),
  });

  // 5. HTTP server.
  const app = createDevApp({ registry, engine, port: options.port, startedAt });
  const server = serve({ fetch: app.fetch, port: options.port }, () => {
    printBanner(registry, options, projectRoot);
  });

  // 6. Hot reload: watch project source; invalidate the module graph on change,
  //    re-scan topology when worker/queue files appear/disappear or config changes.
  const IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    '.next',
    'dist',
    'build',
    'coverage',
    '.serverless-workers',
    '.microfox',
    '.turbo',
  ]);
  const watcher = chokidar.watch(projectRoot, {
    ignored: (watchedPath: string) => {
      const rel = path.relative(projectRoot, watchedPath);
      if (!rel || rel.startsWith('..')) return false;
      return rel.split(path.sep).some((segment) => IGNORED_DIRS.has(segment));
    },
    ignoreInitial: true,
  });

  let pendingChanges: Array<{ eventName: string; filePath: string }> = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const rescan = async (reason: string) => {
    const before = new Set(registry.workers.map((w) => w.id));
    await registry.scan();
    const after = new Set(registry.workers.map((w) => w.id));
    const added = [...after].filter((id) => !before.has(id));
    const removed = [...before].filter((id) => !after.has(id));
    if (added.length > 0) console.log(chalk.green(`[dev] workers added: ${added.join(', ')}`));
    if (removed.length > 0) console.log(chalk.yellow(`[dev] workers removed: ${removed.join(', ')}`));
    registry.invalidate(reason);
  };

  const flushChanges = async () => {
    flushTimer = null;
    const changes = pendingChanges;
    pendingChanges = [];
    if (changes.length === 0) return;

    const relPaths = changes.map((chg) => path.relative(projectRoot, chg.filePath));
    const touchesEnv = relPaths.some((p) => path.basename(p).startsWith('.env'));
    const topologyChange = changes.some(
      (chg) =>
        (chg.eventName === 'add' || chg.eventName === 'unlink') &&
        (chg.filePath.endsWith('.worker.ts') || chg.filePath.endsWith('.queue.ts'))
    );
    const configChange = relPaths.some(
      (p) => path.basename(p) === 'microfox.config.ts' || path.basename(p) === 'microfox.json'
    );

    // Only source-ish changes matter; ignore stray artifacts.
    const relevant = relPaths.filter(
      (p) =>
        /\.(ts|tsx|mts|cts|js|mjs|cjs|json)$/.test(p) || path.basename(p).startsWith('.env')
    );
    if (relevant.length === 0) return;

    if (touchesEnv) {
      envFileKeys = hydrateDevEnv(envFileKeys);
      applyDevPlatformEnv(projectRoot);
      console.log(chalk.dim('[dev] env files re-loaded'));
    }
    if (topologyChange || configChange) {
      await rescan(relevant.length === 1 ? relevant[0] : `${relevant.length} files changed`);
    } else {
      registry.invalidate(relevant.length === 1 ? relevant[0] : `${relevant.length} files changed`);
    }
  };

  watcher.on('all', (eventName, filePath) => {
    if (eventName !== 'add' && eventName !== 'change' && eventName !== 'unlink') return;
    pendingChanges.push({ eventName, filePath });
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => void flushChanges(), 200);
  });

  // 7. `rs` + Enter = manual full re-scan (nodemon habit).
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (line.trim() === 'rs') void rescan('manual rs');
  });

  // 8. Graceful shutdown: flush the persisted local store.
  const shutdown = () => {
    console.log(chalk.dim('\n[dev] shutting down — flushing local state'));
    engine.stop();
    void watcher.close();
    rl.close();
    flushLocalJobStore();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
