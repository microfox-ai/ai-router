import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';

export const newCommand = new Command()
  .name('new')
  .description('Scaffold a new background worker file')
  .argument('<id>', 'Worker ID (used as the worker id and filename)')
  .option('--dir <path>', 'Directory for the worker file', 'app/ai/workers')
  .option('--schedule <expression>', 'Optional schedule expression (e.g. \"cron(0 3 * * ? *)\" or \"rate(1 hour)\")')
  .option('--timeout <seconds>', 'Lambda timeout in seconds', '300')
  .option('--memory <mb>', 'Lambda memory size in MB', '512')
  .action((id: string, options: { dir?: string; schedule?: string; timeout?: string; memory?: string }) => {
    const spinner = ora('Scaffolding worker...').start();
    try {
      const projectRoot = process.cwd();
      const dir = path.resolve(projectRoot, options.dir || 'app/ai/workers');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Derive a file-safe name from id (replace non-word characters with dashes)
      const fileSafeId = id.trim().replace(/[^a-zA-Z0-9_-]+/g, '-');
      const filePath = path.join(dir, `${fileSafeId}.worker.ts`);

      if (fs.existsSync(filePath)) {
        spinner.fail(`File already exists: ${path.relative(projectRoot, filePath)}`);
        process.exitCode = 1;
        return;
      }

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
    const { jobId, workerId, jobStore, dispatchWorker } = ctx;
    console.log('[${id}] start', { jobId, workerId });

    await jobStore?.update({ status: 'running' });

    // TODO: implement your business logic here
    const result: Output = {} as any;

    await jobStore?.update({ status: 'completed', output: result });
    return result;
  },
});
`;

      fs.writeFileSync(filePath, contents, 'utf-8');

      spinner.succeed(
        `Created worker: ${chalk.cyan(path.relative(projectRoot, filePath))}\n` +
          `Next: run ${chalk.yellow('npx @microfox/ai-worker-cli@latest push')} to build & deploy your workers.`
      );
    } catch (error: any) {
      spinner.fail('Failed to scaffold worker');
      console.error(chalk.red(error?.stack || error?.message || String(error)));
      process.exitCode = 1;
    }
  });

