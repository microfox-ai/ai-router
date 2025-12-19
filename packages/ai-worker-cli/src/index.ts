#!/usr/bin/env node

import { Command } from 'commander';
import { pushCommand } from './commands/push.js';

const program = new Command();

program
  .name('ai-worker')
  .description('CLI tooling for deploying ai-router background workers')
  .version('0.1.0');

program.addCommand(pushCommand);

program.parse(process.argv);

const aiWorkerCli = program;
export { aiWorkerCli };
