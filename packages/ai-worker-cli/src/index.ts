#!/usr/bin/env node

import { Command } from 'commander';
import { pushCommand } from './commands/push.js';
import { newCommand } from './commands/new.js';

const program = new Command();

program
  .name('ai-worker')
  .description('CLI tooling for deploying ai-router background workers')
  .version('1.0.0');

program.addCommand(pushCommand);
program.addCommand(newCommand);

program.parse(process.argv);

const aiWorkerCli = program;
export { aiWorkerCli };
