import chalk from 'chalk';
import ora from 'ora';
import { execa } from 'execa';

async function runCommand(command: string, args: string[]) {
  try {
    await execa(command, args, { stdio: 'pipe' });
  } catch (error) {
    throw new Error(`Failed to run command: ${command} ${args.join(' ')}`);
  }
}

export async function installDependencies(
  dependencies: string[],
  devDependencies: string[],
  shadcnComponents: string[]
) {
  const spinner = ora('Installing dependencies...').start();

  try {
    // 1. Install regular dependencies
    if (dependencies.length > 0) {
      spinner.text = `Installing ${dependencies.join(', ')}...`;
      await runCommand('npm', ['install', ...dependencies]);
    }

    // 2. Install dev dependencies
    if (devDependencies.length > 0) {
      spinner.text = `Installing ${devDependencies.join(', ')} (dev)...`;
      await runCommand('npm', ['install', '-D', ...devDependencies]);
    }

    // 3. Initialize shadcn/ui (this is idempotent)
    spinner.text = 'Initializing shadcn/ui...';
    // NOTE: This assumes a default, non-interactive setup.
    // We may need to make this more configurable later.
    await runCommand('npx', ['shadcn-ui@latest', 'init', '-y']);

    // 4. Add shadcn/ui components
    if (shadcnComponents.length > 0) {
      spinner.text = `Adding shadcn/ui components: ${shadcnComponents.join(', ')}...`;
      await runCommand('npx', ['shadcn-ui@latest', 'add', ...shadcnComponents]);
    }

    spinner.succeed(chalk.green('✓ Dependencies installed successfully.'));
  } catch (error) {
    spinner.fail(chalk.red('Failed to install dependencies.'));
    console.error(error);
    process.exit(1);
  }
}
