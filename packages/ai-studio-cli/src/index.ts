#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init';

const program = new Command();

program
  .name('ai-studio-cli')
  .description(
    'A CLI for scaffolding and managing Microfox AI Studio projects.'
  )
  .version('0.0.1');

program.addCommand(initCommand);

program.parse(process.argv);
