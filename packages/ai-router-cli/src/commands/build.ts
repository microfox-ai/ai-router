import { Command } from 'commander';
import { generateRegistry } from '../core/registry';

export const buildCommand = new Command()
  .name('build')
  .description('Build the AI router static registry.')
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
  .action(async (options) => {
    const projectDir = process.cwd();
    console.log('Building AI Router registry...');
    await generateRegistry(projectDir, options.entry, options.output);
    console.log('Build complete.');
  });
