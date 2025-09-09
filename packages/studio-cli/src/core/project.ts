import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

export function validateProject() {
  console.log('Validating project...');

  // 1. Check for package.json
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.error(
      chalk.red(
        'Error: `package.json` not found. Please run this command from the root of your Next.js project.'
      )
    );
    process.exit(1);
  }
  console.log(chalk.green('✓ `package.json` found.'));

  // 2. Check for Next.js config
  const nextConfigJsPath = path.join(process.cwd(), 'next.config.js');
  const nextConfigMjsPath = path.join(process.cwd(), 'next.config.mjs');
  if (!fs.existsSync(nextConfigJsPath) && !fs.existsSync(nextConfigMjsPath)) {
    console.error(
      chalk.red(
        'Error: `next.config.js` or `next.config.mjs` not found. This CLI is designed for Next.js projects.'
      )
    );
    process.exit(1);
  }
  console.log(chalk.green('✓ Next.js project detected.'));

  // 3. Check for app/ directory
  const appDirPath = path.join(process.cwd(), 'app');
  if (!fs.existsSync(appDirPath)) {
    console.error(
      chalk.red(
        'Error: `app/` directory not found. This CLI currently only supports the Next.js App Router.'
      )
    );
    process.exit(1);
  }
  console.log(chalk.green('✓ App Router detected.'));

  console.log(chalk.cyan('Project validation successful!'));
}
