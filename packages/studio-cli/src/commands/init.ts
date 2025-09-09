import { Command } from 'commander';
import { validateProject } from '../core/project';
import { promptForConfig, writeConfigFile } from '../core/config';
import { scaffoldProject } from '../core/scaffold';

export const initCommand = new Command()
  .name('init')
  .description('Initialize a new Microfox AI Studio project.')
  .option(
    '-t, --template <template>',
    'The template to use for the project.',
    'root'
  )
  .action(async (options) => {
    validateProject();
    const config = await promptForConfig();
    writeConfigFile(config);
    await scaffoldProject(options.template, config);
  });
