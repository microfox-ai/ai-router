#!/usr/bin/env node

import { Command } from 'commander';
import { buildCommand } from './commands/build';
import { devCommand } from './commands/dev';

const program = new Command();

program
  .name('ai-router')
  .description('CLI for managing the AI Router framework')
  .version('0.0.1');

program.addCommand(buildCommand);
program.addCommand(devCommand);

program.parse(process.argv);
