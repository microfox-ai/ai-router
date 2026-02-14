import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';

const WORKER_DIR_DEFAULT = 'app/ai/workers';
const QUEUES_DIR_DEFAULT = 'app/ai/queues';

type ScaffoldType = 'worker' | 'queue';

function scaffoldWorker(
  projectRoot: string,
  id: string,
  options: { dir?: string; schedule?: string; timeout?: string; memory?: string }
): string {
  const dir = path.resolve(projectRoot, options.dir || WORKER_DIR_DEFAULT);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const fileSafeId = id.trim().replace(/[^a-zA-Z0-9_-]+/g, '-');
  const filePath = path.join(dir, `${fileSafeId}.worker.ts`);

  const timeout = Number(options.timeout || '300') || 300;
  const memorySize = Number(options.memory || '512') || 512;
  const scheduleLine = options.schedule
    ? `  schedule: '${options.schedule}',\n`
    : '';

  const contents = `import { createWorker, type WorkerConfig } from '@microfox/ai-worker';
import { z } from 'zod';
import type { WorkerHandlerParams } from '@microfox/ai-worker/handler';

const InputSchema = z.object({
  // TODO: define input fields
});

const OutputSchema = z.object({
  // TODO: define output fields
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const workerConfig: WorkerConfig = {
  timeout: ${timeout},
  memorySize: ${memorySize},
${scheduleLine}};

export default createWorker<typeof InputSchema, Output>({
  id: '${id}',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  async handler({ input, ctx }: WorkerHandlerParams<Input, Output>) {
    const { jobId, workerId, jobStore, dispatchWorker, logger } = ctx;
    logger.info('start', { jobId, workerId });

    await jobStore?.update({ status: 'running' });

    // TODO: implement your business logic here
    const result: Output = {} as any;

    await jobStore?.update({ status: 'completed', output: result });
    return result;
  },
});
`;

  fs.writeFileSync(filePath, contents, 'utf-8');
  return path.relative(projectRoot, filePath);
}

function scaffoldQueue(projectRoot: string, id: string, options: { dir?: string }): string {
  const dir = path.resolve(projectRoot, options.dir || QUEUES_DIR_DEFAULT);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const fileSafeId = id.trim().replace(/[^a-zA-Z0-9_-]+/g, '-');
  const filePath = path.join(dir, `${fileSafeId}.queue.ts`);

  const contents = `import { defineWorkerQueue } from '@microfox/ai-worker/queue';

/**
 * Worker queue: ${id}
 * Steps run in sequence. Each step's output can be mapped to the next step's input.
 */
export default defineWorkerQueue({
  id: '${id}',
  steps: [
    { workerId: 'first-worker' },
    // Add more steps: { workerId: 'second-worker' }, { workerId: 'third-worker', delaySeconds: 10 }
  ],
  // Optional: run on a schedule (CLI will generate a queue-starter Lambda)
  // schedule: 'cron(0 3 * * ? *)',
});
`;

  fs.writeFileSync(filePath, contents, 'utf-8');
  return path.relative(projectRoot, filePath);
}

export const newCommand = new Command()
  .name('new')
  .description('Scaffold a new worker or queue (interactive: choose type, then enter id)')
  .argument('[id]', 'Worker or queue ID (optional; will prompt if omitted)')
  .option('--type <worker|queue>', 'Scaffold type (skips interactive prompt)')
  .option('--dir <path>', 'Directory for the output file (workers: app/ai/workers, queues: app/ai/queues)', '')
  .option('--schedule <expression>', 'Optional schedule (workers only; e.g. "cron(0 3 * * ? *)")')
  .option('--timeout <seconds>', 'Lambda timeout in seconds (workers only)', '300')
  .option('--memory <mb>', 'Lambda memory in MB (workers only)', '512')
  .action(
    async (
      idArg: string | undefined,
      options: {
        type?: string;
        dir?: string;
        schedule?: string;
        timeout?: string;
        memory?: string;
      }
    ) => {
      const projectRoot = process.cwd();
      let type: ScaffoldType;
      let id: string;

      if (options.type === 'worker' || options.type === 'queue') {
        type = options.type;
        id = (idArg ?? '').trim();
        if (!id) {
          const res = await prompts({
            type: 'text',
            name: 'id',
            message: `Enter ${type} ID:`,
            validate: (v) => (v.trim() ? true : 'ID is required'),
          });
          if (typeof res.id !== 'string') {
            process.exitCode = 1;
            return;
          }
          id = res.id.trim();
        }
      } else {
        const typeRes = await prompts({
          type: 'select',
          name: 'type',
          message: 'What do you want to create?',
          choices: [
            { title: 'Worker', value: 'worker', description: 'A single background worker (.worker.ts)' },
            { title: 'Queue', value: 'queue', description: 'A multi-step worker queue (.queue.ts)' },
          ],
        });
        if (typeRes.type === undefined) {
          process.exitCode = 1;
          return;
        }
        type = typeRes.type as ScaffoldType;
        id = (idArg ?? '').trim();
        if (!id) {
          const idRes = await prompts({
            type: 'text',
            name: 'id',
            message: `Enter ${type} ID:`,
            validate: (v) => (v.trim() ? true : 'ID is required'),
          });
          if (typeof idRes.id !== 'string') {
            process.exitCode = 1;
            return;
          }
          id = idRes.id.trim();
        }
      }

      const spinner = ora(`Scaffolding ${type}...`).start();
      try {
        const dirOpt = options.dir ? { dir: options.dir } : {};
        if (type === 'worker') {
          const relativePath = scaffoldWorker(projectRoot, id, {
            ...dirOpt,
            schedule: options.schedule,
            timeout: options.timeout,
            memory: options.memory,
          });
          spinner.succeed(
            `Created worker: ${chalk.cyan(relativePath)}\n` +
              `Next: run ${chalk.yellow('npx ai-worker push')} to build & deploy.`
          );
        } else {
          const relativePath = scaffoldQueue(projectRoot, id, dirOpt);
          spinner.succeed(
            `Created queue: ${chalk.cyan(relativePath)}\n` +
              `Edit steps (workerId) to match your workers, then run ${chalk.yellow('npx ai-worker push')} to build & deploy.`
          );
        }
      } catch (error: unknown) {
        const err = error as Error;
        spinner.fail(`Failed to scaffold ${type}`);
        console.error(chalk.red(err?.stack || err?.message || String(error)));
        process.exitCode = 1;
      }
    }
  );
