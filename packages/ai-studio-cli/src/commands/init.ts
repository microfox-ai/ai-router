import { Command } from 'commander';
import { setupProject } from '../core/project';
import {
  promptForConfig,
  writeConfigFile,
  Config,
  loadConfig,
} from '../core/config';
import { scaffoldProject } from '../core/scaffold';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';

export const initCommand = new Command()
  .name('init')
  .description('Initialize a new Microfox AI Studio project.')
  .option(
    '-t, --template <template>',
    'The template to use for the project.',
    'root'
  )
  .option('--local', 'Use a local template path.', false)
  .action(async (options) => {
    const projectName = await setupProject();
    let config: Config | null = await loadConfig();

    if (config) {
      console.log(chalk.green('✓ Existing configuration loaded.'));
    } else {
      config = await promptForConfig();
      writeConfigFile(config);
    }

    await scaffoldProject(options.template, config, options.local);

    if (typeof projectName === 'string') {
      console.log(chalk.green('\n🎉 Your project is ready!'));
      console.log(chalk.cyan('\nNext steps:'));
      console.log(chalk.yellow(`  cd ${projectName}`));
      console.log(chalk.yellow(`  npm i`));
      console.log(chalk.yellow(`  npm run dev`));
      console.log(
        chalk.yellow(`  Open http://localhost:3000/studio in your browser.`)
      );
      console.log(chalk.green('\nReady to build agents!'));
    }
  });
