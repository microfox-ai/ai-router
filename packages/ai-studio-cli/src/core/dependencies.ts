import chalk from 'chalk';
import ora from 'ora';
import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';

async function runCommand(command: string, args: string[]) {
  try {
    await execa(
      command,
      args
      // { stdio: 'inherit' }
    );
  } catch (error) {
    throw new Error(`Failed to run command: ${command} ${args.join(' ')}`);
  }
}

export async function installDependencies(templateDir: string) {
  const spinner = ora('Installing dependencies...').start();

  try {
    // 1. Merge package.json files
    spinner.text = 'Merging `package.json`...';
    const projectPackageJsonPath = path.join(process.cwd(), 'package.json');
    const templatePackageJsonPath = path.join(templateDir, 'package.json');

    const projectPackageJson = await fs.readJson(projectPackageJsonPath);
    const templatePackageJson = await fs.readJson(templatePackageJsonPath);

    const mergedDependencies = {
      ...projectPackageJson.dependencies,
      ...templatePackageJson.dependencies,
    };
    const mergedDevDependencies = {
      ...projectPackageJson.devDependencies,
      ...templatePackageJson.devDependencies,
    };

    projectPackageJson.dependencies = mergedDependencies;
    projectPackageJson.devDependencies = mergedDevDependencies;

    await fs.writeJson(projectPackageJsonPath, projectPackageJson, {
      spaces: 2,
    });

    // 2. Install all dependencies
    spinner.text = 'Installing dependencies with `npm install`...';
    await runCommand('npm', ['install']);

    // 3. Initialize shadcn/ui (this is idempotent)
    spinner.text = 'Initializing shadcn/ui...';
    await runCommand('npx', [
      'shadcn@latest',
      'init',
      '-y',
      '--base-color',
      'neutral',
    ]);

    // 4. Add shadcn/ui components
    spinner.text = `Adding shadcn/ui components...`;
    await runCommand('npx', ['shadcn@latest', 'add', '--all']);

    spinner.succeed(chalk.green('Dependencies installed successfully.'));
  } catch (error) {
    spinner.fail(chalk.red('Failed to install dependencies.'));
    console.error(error);
    process.exit(1);
  }
}
