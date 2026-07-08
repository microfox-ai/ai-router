#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { compileCommand, pushCommand } from './commands/compile.js';
import { newCommand } from './commands/new.js';
import { boilerplateCommand } from './commands/boilerplate.js';

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version || '1.0.0';

const program = new Command();

program
  .name('ai-worker')
  .description(
    'Build tooling for ai-router background workers: scaffold worker/queue files and compile them into a deployable serverless build.\nDeployment is handled by the Microfox CLI ("microfox push" / "microfox deploy").'
  )
  .version(version)
  .addHelpText(
    'after',
    `
Typical workflow:
  1. $ ai-worker new                  scaffold a worker or queue in app/ai/
  2. $ ai-worker boilerplate          add the Next.js API routes + job stores (once per app)
  3. $ ai-worker compile              compile workers into .serverless-workers/
  4. $ npx microfox@latest deploy     compile + push to the Microfox platform
`
  );

program.addCommand(compileCommand);
program.addCommand(newCommand);
program.addCommand(boilerplateCommand);
// Deprecated build-only alias of "compile" (kept so older tooling that calls
// "ai-worker push --skip-deploy" keeps working). Hidden from help.
program.addCommand(pushCommand, { hidden: true });

program.parse(process.argv);

const aiWorkerCli = program;
export { aiWorkerCli };
