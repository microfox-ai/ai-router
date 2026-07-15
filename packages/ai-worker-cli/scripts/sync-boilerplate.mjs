#!/usr/bin/env node
/**
 * Sync boilerplate templates from examples/root into the CLI.
 *
 * The `ai-worker boilerplate` command scaffolds Next.js files (job stores, API
 * routes, hooks) into user projects. The source of truth for those files is the
 * working example app at examples/root. This script reads the live files and
 * regenerates src/commands/boilerplate.templates.generated.ts so the CLI never
 * drifts from the example.
 *
 * Usage:
 *   node scripts/sync-boilerplate.mjs           # regenerate templates
 *   node scripts/sync-boilerplate.mjs --check   # exit 1 if out of date (CI)
 *
 * Add new boilerplate files by appending to TEMPLATE_SOURCES below.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(cliRoot, '..', '..');
const exampleRoot = path.join(repoRoot, 'examples', 'root');

/**
 * Map of template key (destination path relative to app/api/workflows in the
 * user's project) -> source file relative to examples/root.
 * Keys starting with ../ escape the api dir (e.g. hooks).
 */
const TEMPLATE_SOURCES = {
  'auth.ts': 'app/api/workflows/auth.ts',
  'stores/jobStore.ts': 'app/api/workflows/stores/jobStore.ts',
  'stores/mongoAdapter.ts': 'app/api/workflows/stores/mongoAdapter.ts',
  'stores/redisAdapter.ts': 'app/api/workflows/stores/redisAdapter.ts',
  'stores/queueJobStore.ts': 'app/api/workflows/stores/queueJobStore.ts',
  'stores/localDevAdapter.ts': 'app/api/workflows/stores/localDevAdapter.ts',
  'registry/workers.ts': 'app/api/workflows/registry/workers.ts',
  'workers/[...slug]/route.ts': 'app/api/workflows/workers/[...slug]/route.ts',
  'queues/[...slug]/route.ts': 'app/api/workflows/queues/[...slug]/route.ts',
  '../../../hooks/useWorkflowJob.ts': 'hooks/useWorkflowJob.ts',
};

const OUTPUT_FILE = path.join(cliRoot, 'src', 'commands', 'boilerplate.templates.generated.ts');

/** Escape file content for embedding inside a TypeScript template literal. */
function escapeForTemplateLiteral(content) {
  return content
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

function generate() {
  const entries = [];
  for (const [key, relSource] of Object.entries(TEMPLATE_SOURCES)) {
    const sourcePath = path.join(exampleRoot, relSource);
    if (!fs.existsSync(sourcePath)) {
      console.error(`✗ Missing source file: ${sourcePath}`);
      process.exit(1);
    }
    // Normalize CRLF so generated output is stable across platforms.
    const raw = fs.readFileSync(sourcePath, 'utf-8').replace(/\r\n/g, '\n');
    entries.push(`  ${JSON.stringify(key)}: \`${escapeForTemplateLiteral(raw)}\`,`);
  }

  return `/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Boilerplate templates synced from examples/root by scripts/sync-boilerplate.mjs.
 * To change a template, edit the source file in examples/root and run:
 *
 *   npm run sync-boilerplate   (from packages/ai-worker-cli)
 */

export const TEMPLATES: Record<string, string> = {
${entries.join('\n\n')}
};
`;
}

const next = generate();
const checkMode = process.argv.includes('--check');

if (checkMode) {
  const current = fs.existsSync(OUTPUT_FILE) ? fs.readFileSync(OUTPUT_FILE, 'utf-8') : '';
  if (current.replace(/\r\n/g, '\n') !== next) {
    console.error('✗ boilerplate.templates.generated.ts is out of date with examples/root.');
    console.error('  Run: npm run sync-boilerplate (in packages/ai-worker-cli)');
    process.exit(1);
  }
  console.log('✓ Boilerplate templates are in sync with examples/root.');
} else {
  fs.writeFileSync(OUTPUT_FILE, next, 'utf-8');
  console.log(`✓ Wrote ${path.relative(cliRoot, OUTPUT_FILE)} (${Object.keys(TEMPLATE_SOURCES).length} templates from examples/root)`);
}
