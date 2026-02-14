#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pushCommand } from './commands/push.js';
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
  .description('CLI tooling for deploying ai-router background workers')
  .version(version);

program.addCommand(pushCommand);
program.addCommand(newCommand);
program.addCommand(boilerplateCommand);

program.parse(process.argv);

const aiWorkerCli = program;
export { aiWorkerCli };
