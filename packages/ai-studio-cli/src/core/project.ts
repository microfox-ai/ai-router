import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import prompts from 'prompts';
import { execa } from 'execa';
import ora from 'ora';

function isNextJsProject(directory: string): boolean {
  const packageJsonPath = path.join(directory, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return false;

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    if (!dependencies.next) {
      return false;
    }
  } catch (error) {
    return false;
  }

  const nextConfigJsPath = path.join(directory, 'next.config.js');
  const nextConfigMjsPath = path.join(directory, 'next.config.mjs');
  const nextConfigTsPath = path.join(directory, 'next.config.ts');
  if (
    !fs.existsSync(nextConfigJsPath) &&
    !fs.existsSync(nextConfigMjsPath) &&
    !fs.existsSync(nextConfigTsPath)
  ) {
    return false;
  }

  const appDirPath = path.join(directory, 'app');
  if (!fs.existsSync(appDirPath)) {
    return false;
  }

  return true;
}

export async function setupProject() {
  const currentDir = process.cwd();
  if (isNextJsProject(currentDir)) {
    console.log(chalk.green('✓ Valid Next.js project detected.'));
    return;
  }

  console.log(
    chalk.yellow('No Next.js project detected in the current directory.')
  );

  const { projectName } = await prompts({
    type: 'text',
    name: 'projectName',
    message: 'Enter a name for your new Next.js project:',
    initial: 'my-microfox-app',
  });

  if (!projectName) {
    console.log(chalk.red('Project name is required. Exiting.'));
    process.exit(1);
  }

  const spinner = ora(
    chalk.cyan(`Creating a new Next.js app: ${projectName}`)
  ).start();
  try {
    await execa(
      'npx',
      [
        'create-next-app@latest',
        projectName,
        '--typescript',
        '--tailwind',
        '--eslint',
        '--app',
        '--no-src-dir',
        '--no-import-alias',
        '--no-turbopack',
        '@/',
      ]
      // { stdio: 'inherit' }
    );
    spinner.succeed(chalk.green('Next.js project created successfully.'));

    process.chdir(path.join(currentDir, projectName));
    console.log(chalk.cyan(`changed directory to: ${projectName}`));
    return projectName;
  } catch (error) {
    spinner.fail(chalk.red('Failed to create Next.js project.'));
    console.error(error);
    process.exit(1);
  }
}
