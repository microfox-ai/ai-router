import { Command } from 'commander';
import { setupProject } from '../core/project';
import { promptForConfig, writeConfigFile } from '../core/config';
import { scaffoldProject } from '../core/scaffold';
import chalk from 'chalk';

export const initCommand = new Command()
  .name('init')
  .description('Initialize a new Microfox AI Studio project.')
  .option(
    '-t, --template <template>',
    'The template to use for the project.',
    'root'
  )
  .action(async (options) => {
    const projectName = await setupProject();
    const config = await promptForConfig();
    writeConfigFile(config);
    await scaffoldProject(options.template, config);

    if (typeof projectName === 'string') {
      console.log(chalk.green('\n🎉 Your project is ready!'));
      console.log(chalk.cyan('\nNext steps:'));
      console.log(chalk.yellow(`  cd ${projectName}`));
      console.log(chalk.yellow(`  npm run dev`));
      console.log(
        chalk.yellow(`  Open http://localhost:3000/studio in your browser.`)
      );
      console.log(chalk.green('\nReady to build agents!'));
    }
  });
