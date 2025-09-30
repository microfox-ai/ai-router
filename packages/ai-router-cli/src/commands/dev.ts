import { Command } from 'commander';
import { generateRegistry } from '../core/registry';
import chokidar from 'chokidar';
import path from 'path';

export const devCommand = new Command()
  .name('dev')
  .description('Watch for changes and automatically rebuild the AI router static registry.')
  .option(
    '-e, --entry <path>',
    'Path to the entry file exporting the AiRouter instance.',
    'app/ai/index.ts'
  )
  .option(
    '-o, --output <path>',
    'Path to the output directory for the static registry file.',
    'app/ai'
  )
  .option(
    '-w, --watch <path>',
    'Directory to watch for changes.',
    'app/ai'
  )
  .action(async (options) => {
    const projectDir = process.cwd();
    const watchDir = path.resolve(projectDir, options.watch);

    console.log(`Watching for changes in: ${watchDir}`);

    const build = async () => {
      console.log('File change detected. Rebuilding AI Router registry...');
      await generateRegistry(projectDir, options.entry, options.output);
    };

    // Initial build
    await build();

    const watcher = chokidar.watch(watchDir, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
    });

    watcher.on('add', build).on('change', build).on('unlink', build);
  });
