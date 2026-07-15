import { Command } from 'commander';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';

// Templates are generated from examples/root — do not edit them here.
// To update: edit the source file in examples/root, then run `npm run sync-boilerplate`.
import { TEMPLATES } from './boilerplate.templates.generated.js';

const WORKFLOW_SETTINGS_SNIPPET = `  // Workflow + worker runtime configuration (job store, etc.)
  workflowSettings: {
    jobStore: {
      // 'mongodb' | 'upstash-redis'
      type:
        (process.env.WORKER_DATABASE_TYPE as
          | 'mongodb'
          | 'upstash-redis') || 'upstash-redis',
      mongodb: {
        uri: process.env.DATABASE_MONGODB_URI || process.env.MONGODB_URI,
        db:
          process.env.DATABASE_MONGODB_DB ||
          process.env.MONGODB_DB ||
          'ai_router',
        workerJobsCollection:
          process.env.MONGODB_WORKER_JOBS_COLLECTION || 'worker_jobs',
        workflowStatusCollection:
          process.env.MONGODB_WORKFLOW_STATUS_COLLECTION || 'workflow_status',
      },
      redis: {
        url:
          process.env.WORKER_UPSTASH_REDIS_REST_URL ||
          process.env.UPSTASH_REDIS_REST_URL,
        token:
          process.env.WORKER_UPSTASH_REDIS_REST_TOKEN ||
          process.env.UPSTASH_REDIS_REST_TOKEN,
        keyPrefix:
          process.env.WORKER_UPSTASH_REDIS_JOBS_PREFIX ||
          'worker:jobs:',
        ttlSeconds:
          Number(process.env.WORKER_JOBS_TTL_SECONDS ?? 60 * 60 * 24 * 7),
      },
    },
    // Optional: Microfox deployment config (alternative to root microfox.json)
    deploymentConfig: {
      projectId: process.env.MICROFOX_PROJECT_ID,
      publish: {
        subdomain: process.env.MICROFOX_SUBDOMAIN,
      },
      deployment: {
        apiMode: process.env.MICROFOX_API_MODE || 'staging',
        apiVersion: process.env.MICROFOX_API_VERSION || 'v2',
      },
      // Optional: control which env vars ship into the deployed Lambda's env.json.
      // Without an env block, behavior is unchanged: the prefix allowlist
      // (OPENAI_*, DATABASE_*, WORKER_*, ...) plus keys referenced via process.env in code.
      // env: {
      //   mode: 'all-detected', // or 'explicit' to ship ONLY the include list (+ platform keys)
      //   include: ['SOME_SDK_KEY', 'MYAPP_*'], // '*' wildcards supported
      //   exclude: ['DEBUG_*', 'LOCAL_ONLY_TOKEN'], // wins over include; never ships
      //   groups: {
      //     video: { include: ['REMOTION_LICENSE_KEY'] }, // per-group overlay
      //   },
      // },
    },
  },`;

function writeFile(filePath: string, content: string, force: boolean): boolean {
  if (fs.existsSync(filePath) && !force) {
    return false; // Skip existing file
  }
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  return true; // File written
}

function mergeMicrofoxConfig(configPath: string, force: boolean): boolean {
  if (!fs.existsSync(configPath)) {
    // Create minimal config file
    const content = `export const StudioConfig = {
  appName: 'My App',
  projectInfo: {
    framework: 'next-js',
  },
  studioSettings: {
    protection: {
      enabled: false,
    },
    database: {
      type: 'local',
    },
  },
${WORKFLOW_SETTINGS_SNIPPET}
};
`;
    fs.writeFileSync(configPath, content, 'utf-8');
    return true;
  }

  // Try to merge workflowSettings into existing config
  const content = fs.readFileSync(configPath, 'utf-8');
  
  // Check if workflowSettings already exists
  if (content.includes('workflowSettings')) {
    if (!force) {
      return false; // Already has workflowSettings, skip
    }
    // TODO: Could do smarter merging here, but for now just skip if exists and not force
    return false;
  }

  // Find the closing brace of StudioConfig and insert workflowSettings before it
  const lines = content.split('\n');
  let insertIndex = -1;
  let braceCount = 0;
  let inStudioConfig = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('StudioConfig') && line.includes('=')) {
      inStudioConfig = true;
    }
    if (inStudioConfig) {
      const openBraces = (line.match(/{/g) || []).length;
      const closeBraces = (line.match(/}/g) || []).length;
      braceCount += openBraces - closeBraces;
      
      if (braceCount === 0 && closeBraces > 0 && insertIndex === -1) {
        insertIndex = i;
        break;
      }
    }
  }

  if (insertIndex === -1) {
    // Couldn't find insertion point, append at end before last }
    const lastBrace = content.lastIndexOf('}');
    if (lastBrace !== -1) {
      const before = content.slice(0, lastBrace);
      const after = content.slice(lastBrace);
      const newContent = before + ',\n' + WORKFLOW_SETTINGS_SNIPPET + '\n' + after;
      fs.writeFileSync(configPath, newContent, 'utf-8');
      return true;
    }
    return false;
  }

  // Insert workflowSettings before the closing brace
  const indent = lines[insertIndex].match(/^(\s*)/)?.[1] || '  ';
  const workflowLines = WORKFLOW_SETTINGS_SNIPPET.split('\n').map((l, idx) => {
    if (idx === 0) return indent + l;
    return indent + l;
  });
  
  lines.splice(insertIndex, 0, ...workflowLines);
  fs.writeFileSync(configPath, lines.join('\n'), 'utf-8');
  return true;
}

// Packages the boilerplate templates require, with minimum versions from examples/root
const REQUIRED_DEPENDENCIES: Record<string, string> = {
  '@microfox/ai-worker': 'latest',
  '@upstash/redis': '^1.35.3',
  mongodb: '^6.12.0',
  zod: '^4.1.11',
};

function parseVersionTuple(v: string): [number, number, number] | null {
  const clean = v.replace(/^[\^~>=< ]+/, '').split(/[-+]/)[0];
  const parts = clean.split('.').map(Number);
  if (parts.length < 3 || parts.some((n) => isNaN(n))) return null;
  return [parts[0], parts[1], parts[2]];
}

function isVersionLessThan(current: string, required: string): boolean {
  if (current === '*' || current === 'latest' || required === '*' || required === 'latest')
    return false;
  const a = parseVersionTuple(current);
  const b = parseVersionTuple(required);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false;
}

function updatePackageJsonDeps(projectRoot: string): { added: string[]; updated: string[] } {
  const pkgPath = path.join(projectRoot, 'package.json');
  const added: string[] = [];
  const updated: string[] = [];

  if (!fs.existsSync(pkgPath)) return { added, updated };

  let pkg: Record<string, any>;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return { added, updated };
  }

  if (!pkg.dependencies) pkg.dependencies = {};

  for (const [dep, requiredVersion] of Object.entries(REQUIRED_DEPENDENCIES)) {
    const currentInDeps = pkg.dependencies?.[dep] as string | undefined;
    const currentInDev = pkg.devDependencies?.[dep] as string | undefined;
    const current = currentInDeps ?? currentInDev;

    if (!current) {
      pkg.dependencies[dep] = requiredVersion;
      added.push(`${dep}@${requiredVersion}`);
    } else if (isVersionLessThan(current, requiredVersion)) {
      // Update in whichever section it already lives
      if (currentInDeps !== undefined) {
        pkg.dependencies[dep] = requiredVersion;
      } else if (pkg.devDependencies) {
        pkg.devDependencies[dep] = requiredVersion;
      }
      updated.push(`${dep}: ${current} → ${requiredVersion}`);
    }
  }

  if (added.length > 0 || updated.length > 0) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  }

  return { added, updated };
}

/**
 * SEC-4 / Plan B: ensure a stable random WORKERS_API_KEY exists in the project .env
 * so newly scaffolded projects deploy with worker-endpoint auth by default (no
 * per-push rotation). No-op if a non-empty WORKERS_API_KEY is already set.
 */
function ensureWorkersApiKeyEnv(projectRoot: string): 'added' | 'exists' {
  const envPath = path.join(projectRoot, '.env');
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf-8');
    // Match a non-empty assignment (allow optional `export ` / surrounding quotes).
    if (/^\s*(?:export\s+)?WORKERS_API_KEY\s*=\s*["']?\S/m.test(content)) {
      return 'exists';
    }
  }
  const key = crypto.randomBytes(32).toString('hex');
  const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  const block = `${prefix}# Shared secret required by deployed worker endpoints (/workers/trigger, /workers/config, /queues/*/start).\nWORKERS_API_KEY=${key}\n`;
  fs.appendFileSync(envPath, block, 'utf-8');
  return 'added';
}

export const boilerplateCommand = new Command()
  .name('boilerplate')
  .description('Create or update worker boilerplate files (job store, API routes, config)')
  .option('--force', 'Overwrite existing files', false)
  .option('--app-dir <path>', 'App directory path (default: app)', 'app')
  .option('--skip-config', 'Skip microfox.config.ts updates', false)
  .action((options: { force?: boolean; appDir?: string; skipConfig?: boolean }) => {
    const spinner = ora('Creating boilerplate files...').start();
    try {
      const projectRoot = process.cwd();
      const appDir = options.appDir || 'app';
      const apiDir = path.join(appDir, 'api', 'workflows');
      const force = options.force || false;
      const skipConfig = options.skipConfig || false;

      const filesCreated: string[] = [];
      const filesSkipped: string[] = [];

      // Write template files (normalize so e.g. ../../../hooks/useWorkflowJob.ts resolves)
      for (const [relativePath, template] of Object.entries(TEMPLATES)) {
        const filePath = path.normalize(path.join(projectRoot, apiDir, relativePath));
        const written = writeFile(filePath, template, force);
        if (written) {
          filesCreated.push(path.relative(projectRoot, filePath));
        } else {
          filesSkipped.push(path.relative(projectRoot, filePath));
        }
      }

      // Handle microfox.config.ts
      let configUpdated = false;
      if (!skipConfig) {
        const configPath = path.join(projectRoot, 'microfox.config.ts');
        configUpdated = mergeMicrofoxConfig(configPath, force);
        if (configUpdated) {
          filesCreated.push('microfox.config.ts');
        } else if (fs.existsSync(configPath)) {
          filesSkipped.push('microfox.config.ts');
        }
      }

      // Update package.json dependencies
      const { added: depsAdded, updated: depsUpdated } = updatePackageJsonDeps(projectRoot);

      // Ensure a stable WORKERS_API_KEY so deployed endpoints require auth by default.
      const workersKeyStatus = ensureWorkersApiKeyEnv(projectRoot);

      spinner.succeed('Boilerplate files created');

      if (filesCreated.length > 0) {
        console.log(chalk.green('\n✓ Created files:'));
        filesCreated.forEach((f) => console.log(chalk.gray(`  - ${f}`)));
      }

      if (filesSkipped.length > 0) {
        console.log(chalk.yellow('\n⚠ Skipped existing files (use --force to overwrite):'));
        filesSkipped.forEach((f) => console.log(chalk.gray(`  - ${f}`)));
      }

      if (depsAdded.length > 0) {
        console.log(chalk.green('\n✓ Added dependencies to package.json:'));
        depsAdded.forEach((d) => console.log(chalk.gray(`  - ${d}`)));
      }

      if (depsUpdated.length > 0) {
        console.log(chalk.green('\n✓ Updated dependencies in package.json:'));
        depsUpdated.forEach((d) => console.log(chalk.gray(`  - ${d}`)));
      }

      if (depsAdded.length > 0 || depsUpdated.length > 0) {
        console.log(chalk.yellow('\n  Run npm install (or yarn/pnpm install) to install the updated dependencies.'));
      }

      if (workersKeyStatus === 'added') {
        console.log(
          chalk.green('\n✓ Added a random WORKERS_API_KEY to .env') +
            chalk.gray(
              '\n  Deployed worker endpoints will require this key. Keep .env out of git, and\n' +
                '  set the same WORKERS_API_KEY in any other app that dispatches to these workers.'
            )
        );
      }

      console.log(
        chalk.blue(
          `\n📚 Next steps:\n` +
            `  1. Configure your job store in microfox.config.ts (workflowSettings.jobStore)\n` +
            `  2. Set environment variables (MONGODB_URI or UPSTASH_REDIS_*)\n` +
            `  3. Create your first worker: ${chalk.yellow('npx ai-worker new <worker-id>')}\n` +
            `  4. Deploy workers: ${chalk.yellow('npx microfox@latest deploy')} (compile + push)\n` +
            `  5. Use ${chalk.yellow('hooks/useWorkflowJob.ts')} in client components to trigger and poll workers/queues`
        )
      );
    } catch (error: any) {
      spinner.fail('Failed to create boilerplate files');
      console.error(chalk.red(error?.stack || error?.message || String(error)));
      process.exitCode = 1;
    }
  });
