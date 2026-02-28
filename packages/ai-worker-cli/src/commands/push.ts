import { Command } from 'commander';
import * as esbuild from 'esbuild';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { builtinModules } from 'module';
import { glob } from 'glob';
import * as yaml from 'js-yaml';
import chalk from 'chalk';
import ora from 'ora';

const NODE_BUILTINS = new Set(
  builtinModules.map((m) => (m.startsWith('node:') ? m.slice('node:'.length) : m))
);

function isBuiltinModule(specifier: string): boolean {
  const s = specifier.startsWith('node:')
    ? specifier.slice('node:'.length)
    : specifier;
  return NODE_BUILTINS.has(s);
}

function getPackageNameFromSpecifier(specifier: string): string {
  // Scoped packages: @scope/name/...
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/');
    return name ? `${scope}/${name}` : specifier;
  }
  // Unscoped: name/...
  return specifier.split('/')[0];
}

function tryResolveLocalImport(fromFile: string, specifier: string): string | null {
  const baseDir = path.dirname(fromFile);
  const raw = path.resolve(baseDir, specifier);

  // Direct file hits
  const candidates = [
    raw,
    `${raw}.ts`,
    `${raw}.tsx`,
    `${raw}.js`,
    `${raw}.mjs`,
    `${raw}.cjs`,
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }

  // Directory index hits
  if (fs.existsSync(raw) && fs.statSync(raw).isDirectory()) {
    const idxCandidates = [
      path.join(raw, 'index.ts'),
      path.join(raw, 'index.tsx'),
      path.join(raw, 'index.js'),
      path.join(raw, 'index.mjs'),
      path.join(raw, 'index.cjs'),
    ];
    for (const c of idxCandidates) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    }
  }

  return null;
}

function extractImportSpecifiers(source: string): string[] {
  const specs: string[] = [];

  // import ... from 'x' / export ... from 'x'
  // NOTE: we intentionally ignore "import type ... from" because it's type-only.
  const re1 =
    /(?:^|\n)\s*(?!import\s+type)(?:import|export)\s+[\s\S]*?\sfrom\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(re1)) {
    if (match[1]) specs.push(match[1]);
  }

  // import('x')
  const re2 = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(re2)) {
    if (match[1]) specs.push(match[1]);
  }

  // require('x')
  const re3 = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(re3)) {
    if (match[1]) specs.push(match[1]);
  }

  return specs;
}

function extractEnvVarUsageFromSource(source: string): {
  runtimeKeys: Set<string>;
  buildtimeKeys: Set<string>;
} {
  const runtimeKeys = new Set<string>();
  const buildtimeKeys = new Set<string>();

  // process.env.KEY / process.env?.KEY
  const reProcessDot = /\bprocess\.env\??\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
  for (const match of source.matchAll(reProcessDot)) {
    const key = match[1];
    if (key) runtimeKeys.add(key);
  }

  // process.env['KEY'] / process.env["KEY"]
  const reProcessBracket = /\bprocess\.env\[\s*['"]([^'"]+)['"]\s*\]/g;
  for (const match of source.matchAll(reProcessBracket)) {
    const key = match[1];
    if (key) runtimeKeys.add(key);
  }

  // import.meta.env.KEY
  const reImportMetaDot = /\bimport\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
  for (const match of source.matchAll(reImportMetaDot)) {
    const key = match[1];
    if (key) buildtimeKeys.add(key);
  }

  // import.meta.env['KEY']
  const reImportMetaBracket = /\bimport\.meta\.env\[\s*['"]([^'"]+)['"]\s*\]/g;
  for (const match of source.matchAll(reImportMetaBracket)) {
    const key = match[1];
    if (key) buildtimeKeys.add(key);
  }

  return { runtimeKeys, buildtimeKeys };
}

async function collectEnvUsageForWorkers(
  workerEntryFiles: string[],
  projectRoot: string
): Promise<{ runtimeKeys: Set<string>; buildtimeKeys: Set<string> }> {
  void projectRoot; // reserved for future improvements (tsconfig path aliases, etc.)

  const runtimeKeys = new Set<string>();
  const buildtimeKeys = new Set<string>();

  const visited = new Set<string>();
  const queue: string[] = [...workerEntryFiles];

  while (queue.length > 0) {
    const file = queue.pop()!;
    const normalized = path.resolve(file);
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) continue;
    const src = fs.readFileSync(normalized, 'utf-8');

    const usage = extractEnvVarUsageFromSource(src);
    usage.runtimeKeys.forEach((k) => runtimeKeys.add(k));
    usage.buildtimeKeys.forEach((k) => buildtimeKeys.add(k));

    const specifiers = extractImportSpecifiers(src);
    for (const spec of specifiers) {
      if (!spec) continue;
      if (spec.startsWith('.')) {
        const resolved = tryResolveLocalImport(normalized, spec);
        if (resolved) queue.push(resolved);
        continue;
      }

      // Ignore absolute paths and non-node specifiers.
      if (spec.startsWith('/')) continue;
      if (isBuiltinModule(spec)) continue;
      // External packages are ignored; we only scan local files.
    }
  }

  runtimeKeys.delete('');
  buildtimeKeys.delete('');
  runtimeKeys.delete('node');
  buildtimeKeys.delete('node');

  return { runtimeKeys, buildtimeKeys };
}

/**
 * Collect callee worker IDs per worker (ctx.dispatchWorker('id', ...) in handler code).
 * Walks from each worker entry file and its local imports, extracts string literal IDs.
 */
async function collectCalleeWorkerIds(
  workers: WorkerInfo[],
  projectRoot: string
): Promise<Map<string, Set<string>>> {
  void projectRoot;
  const calleeIdsByWorker = new Map<string, Set<string>>();

  const workerIds = new Set(workers.map((w) => w.id));

  for (const worker of workers) {
    const calleeIds = new Set<string>();
    const visited = new Set<string>();
    const queue: string[] = [worker.filePath];

    while (queue.length > 0) {
      const file = queue.pop()!;
      const normalized = path.resolve(file);
      if (visited.has(normalized)) continue;
      visited.add(normalized);

      if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) continue;
      const src = fs.readFileSync(normalized, 'utf-8');

      // ctx.dispatchWorker('id', ...) or ctx.dispatchWorker("id", ...)
      const re = /(?:ctx\.)?dispatchWorker\s*\(\s*['"]([^'"]+)['"]/g;
      for (const match of src.matchAll(re)) {
        if (match[1]) calleeIds.add(match[1]);
      }

      const specifiers = extractImportSpecifiers(src);
      for (const spec of specifiers) {
        if (!spec || !spec.startsWith('.')) continue;
        const resolved = tryResolveLocalImport(normalized, spec);
        if (resolved) queue.push(resolved);
      }
    }

    if (calleeIds.size > 0) {
      for (const calleeId of calleeIds) {
        if (!workerIds.has(calleeId)) {
          console.warn(
            chalk.yellow(
              `⚠️  Worker "${worker.id}" calls "${calleeId}" which is not in scanned workers (typo or other service?). Queue URL will not be auto-injected.`
            )
          );
        }
      }
      calleeIdsByWorker.set(worker.id, calleeIds);
    }
  }

  return calleeIdsByWorker;
}

function sanitizeWorkerIdForEnv(workerId: string): string {
  return workerId.replace(/-/g, '_').toUpperCase();
}

/** Converts kebab/dotted id to camelCase segment (e.g. "results-aggregator" -> "resultsAggregator"). */
function toCamelCase(id: string): string {
  return id
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part, i) =>
      i === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    )
    .join('');
}

/** Prefix + camelCase id with first letter capitalized (e.g. "worker", "results-aggregator" -> "workerResultsAggregator"). */
function toPrefixedCamel(prefix: string, id: string): string {
  const camel = toCamelCase(id);
  return prefix + (camel.charAt(0).toUpperCase() + camel.slice(1));
}

function readJsonFile<T = any>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function findMonorepoRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  // Walk up until we find a package.json with "workspaces" or we hit filesystem root.
  while (true) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = readJsonFile<any>(pkgPath);
      if (pkg?.workspaces) return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) return startDir; // fallback
    dir = parent;
  }
}

async function collectRuntimeDependenciesForWorkers(
  workerEntryFiles: string[],
  projectRoot: string
): Promise<Set<string>> {
  // Always include these: they're used by generated workers-config / lambda wrapper logic,
  // and are safe to install even if handlers are bundled.
  const deps = new Set<string>(['@microfox/ai-worker', '@aws-sdk/client-sqs']);
  const visited = new Set<string>();
  const queue: string[] = [...workerEntryFiles];

  while (queue.length > 0) {
    const file = queue.pop()!;
    const normalized = path.resolve(file);
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) continue;
    const src = fs.readFileSync(normalized, 'utf-8');
    const specifiers = extractImportSpecifiers(src);

    for (const spec of specifiers) {
      if (!spec) continue;
      if (spec.startsWith('.')) {
        const resolved = tryResolveLocalImport(normalized, spec);
        if (resolved) queue.push(resolved);
        continue;
      }

      // Ignore absolute paths and non-node specifiers.
      if (spec.startsWith('/')) continue;
      if (isBuiltinModule(spec)) continue;

      deps.add(getPackageNameFromSpecifier(spec));
    }
  }

  // Filter out anything that isn't an npm package name
  deps.delete('');
  deps.delete('node');

  // Filter devDependencies
  deps.delete('serverless');
  deps.delete('serverless-offline');
  deps.delete('@aws-sdk/client-sqs');
  deps.delete('@microfox/ai-worker')
  return deps;
}

/** Resolve job store type from env (used for conditional deps). Default: upstash-redis. */
function getJobStoreType(): 'mongodb' | 'upstash-redis' {
  const raw = process.env.WORKER_DATABASE_TYPE?.toLowerCase();
  if (raw === 'mongodb' || raw === 'upstash-redis') return raw;
  return 'upstash-redis';
}

/**
 * Filter runtime deps so only the chosen job-store backend is included (+ mongodb if user code uses it).
 * - type mongodb: include only mongodb for job store.
 * - type upstash-redis: include only @upstash/redis for job store.
 * - If user code imports mongodb (e.g. worker uses Mongo for its own logic), always add mongodb.
 */
function filterDepsForJobStore(
  runtimeDeps: Set<string>,
  jobStoreType: 'mongodb' | 'upstash-redis'
): Set<string> {
  const filtered = new Set(runtimeDeps);
  filtered.delete('mongodb');
  filtered.delete('@upstash/redis');
  if (jobStoreType === 'mongodb') filtered.add('mongodb');
  else filtered.add('@upstash/redis');
  if (runtimeDeps.has('mongodb')) filtered.add('mongodb');
  return filtered;
}

function buildDependenciesMap(projectRoot: string, deps: Set<string>): Record<string, string> {
  const projectPkg =
    readJsonFile<any>(path.join(projectRoot, 'package.json')) || {};
  const projectDeps: Record<string, string> = projectPkg.dependencies || {};
  const projectDevDeps: Record<string, string> = projectPkg.devDependencies || {};

  // Try to also source versions from workspace packages (ai-worker / ai-worker-cli)
  const repoRoot = findMonorepoRoot(projectRoot);
  const workerPkg =
    readJsonFile<any>(path.join(repoRoot, 'packages', 'ai-worker', 'package.json')) ||
    {};
  const workerCliPkg =
    readJsonFile<any>(
      path.join(repoRoot, 'packages', 'ai-worker-cli', 'package.json')
    ) || {};

  const workspaceDeps: Record<string, string> = {
    ...(workerPkg.dependencies || {}),
    ...(workerPkg.devDependencies || {}),
    ...(workerCliPkg.dependencies || {}),
    ...(workerCliPkg.devDependencies || {}),
  };

  const out: Record<string, string> = {};
  for (const dep of Array.from(deps).sort()) {
    const range =
      projectDeps[dep] ||
      projectDevDeps[dep] ||
      workspaceDeps[dep];
    // Only add deps that the project or workspace already declares (e.g. in package.json).
    // Skip subpath imports like @tokenlens/helpers that are not real packages and not in package.json.
    if (range) {
      out[dep] = String(range);
    }
  }

  return out;
}

interface QueueStepInfo {
  workerId: string;
  delaySeconds?: number;
  mapInputFromPrev?: string;
}

interface QueueInfo {
  id: string;
  filePath: string;
  steps: QueueStepInfo[];
  schedule?: string | { rate: string; enabled?: boolean; input?: Record<string, any> };
}

interface WorkerInfo {
  id: string;
  filePath: string;
  // Module path WITHOUT extension and WITHOUT ".handler" suffix.
  // Example: "handlers/agents/test/test"
  handlerPath: string;
  /** Deployment group (default 'default'). Used to assign worker to a serverless project. */
  group: string;
  workerConfig?: {
    timeout?: number;
    memorySize?: number;
    layers?: string[];
    schedule?: any; // Schedule config: string, object, or array of either
    group?: string;
    sqs?: {
      maxReceiveCount?: number;
      messageRetentionPeriod?: number;
      visibilityTimeout?: number;
      deadLetterMessageRetentionPeriod?: number;
    };
  };
}

interface ServerlessConfig {
  service: string;
  custom?: Record<string, any>;
  package: {
    excludeDevDependencies: boolean;
    individually?: boolean;
    patterns: string[];
  };
  provider: {
    name: string;
    runtime: string;
    region: string;
    stage: string;
    versionFunctions?: boolean;
    environment: Record<string, string | Record<string, any>> | string;
    iam: {
      role: {
        statements: Array<{
          Effect: string;
          Action: string[];
          Resource: string | Array<string | Record<string, any>>;
        }>;
      };
    };
  };
  plugins: string[];
  functions: Record<string, any>;
  resources: {
    Resources: Record<string, any>;
    Outputs: Record<string, any>;
  };
}

export function getServiceNameFromProjectId(projectId: string, group?: string): string {
  const cleanedProjectId = projectId.replace(/-/g, '').slice(0, 15);
  if (!group || group === 'default') {
    return `p-${cleanedProjectId}`;
  }
  const groupSlug = group.replace(/-/g, '').slice(0, 12);
  return `p-${cleanedProjectId}-${groupSlug}`;
}

/** Default external for esbuild (aws-sdk is always available in Lambda runtime). */
const DEFAULT_EXTERNAL_PACKAGES = ['aws-sdk'];

/**
 * Effective worker config for a group (worker.* merged with worker.groups[groupName]).
 * externalDeps is project-level only (worker.externalDeps); includeNodeModules and excludeNodeModules can be overridden per group.
 */
function getGroupWorkerConfig(
  microfoxConfig: Record<string, any> | null,
  group?: string | null
): { includeNodeModules?: boolean; excludeNodeModules?: string[]; externalDeps?: string[] } {
  const base = {
    includeNodeModules: microfoxConfig?.worker?.includeNodeModules,
    excludeNodeModules: microfoxConfig?.worker?.excludeNodeModules as string[] | undefined,
    externalDeps: microfoxConfig?.worker?.externalDeps as string[] | undefined,
  };
  if (!group || !microfoxConfig?.worker?.groups?.[group] || typeof microfoxConfig.worker.groups[group] !== 'object') {
    return base;
  }
  const g = microfoxConfig.worker.groups[group] as Record<string, any>;
  return {
    includeNodeModules: g.includeNodeModules !== undefined ? !!g.includeNodeModules : base.includeNodeModules,
    excludeNodeModules: Array.isArray(g.excludeNodeModules)
      ? g.excludeNodeModules
      : base.excludeNodeModules,
    externalDeps: base.externalDeps,
  };
}

/**
 * Resolve external packages from microfox.json (worker.externalDeps, project-level only).
 * Default is only aws-sdk; any worker.externalDeps are appended. Used for esbuild external and package patterns.
 * @param group Optional; when building per-group configs, group is passed but externalDeps are not overridden per group.
 */
function getExternalPackages(microfoxConfig: Record<string, any> | null, group?: string | null): string[] {
  const base = [...DEFAULT_EXTERNAL_PACKAGES];
  if (!microfoxConfig) return base;
  const { externalDeps } = getGroupWorkerConfig(microfoxConfig, group);
  const list = externalDeps;
  if (Array.isArray(list) && list.length > 0) {
    const extra = list.filter((p: any) => typeof p === 'string' && p && !base.includes(p));
    return [...base, ...extra];
  }
  return base;
}

/**
 * Build serverless package include patterns for external packages (node_modules/<pkg>/**).
 * Excludes aws-sdk since it is always available in Lambda runtime and must not be in serverless.yml.
 */
function getExternalPackagePatterns(externalPackages: string[]): string[] {
  return externalPackages
    .filter((pkg) => pkg !== 'aws-sdk')
    .map((pkg) => `node_modules/${pkg}/**`);
}

/** Default node_modules packages to exclude when includeNodeModules is true (dev/build only). */
const DEFAULT_EXCLUDE_NODE_MODULES = ['serverless-offline', 'typescript', '@types', 'aws-sdk', '@aws-sdk'];

/**
 * Build full serverless package.patterns array.
 * - When worker.includeNodeModules (or worker.groups[group].includeNodeModules) is true: include all node_modules except listed packages.
 * - Otherwise: exclude node_modules and include only externalDeps (and aws-sdk is not in patterns).
 * @param group When set, uses worker.groups[group] overrides for includeNodeModules / excludeNodeModules.
 */
function getPackagePatterns(
  microfoxConfig: Record<string, any> | null,
  externalPackages: string[],
  group?: string | null
): string[] {
  const base = ['!venv/**', '!.idea/**', '!.vscode/**', '!src/**'];
  const groupConfig = microfoxConfig ? getGroupWorkerConfig(microfoxConfig, group) : null;
  const includeNodeModules = groupConfig?.includeNodeModules === true;
  const customExclude = groupConfig?.excludeNodeModules;
  const excludePkgs = Array.isArray(customExclude)
    ? [...DEFAULT_EXCLUDE_NODE_MODULES, ...customExclude.filter((p: any) => typeof p === 'string')]
    : DEFAULT_EXCLUDE_NODE_MODULES;

  if (includeNodeModules) {
    const excludePatterns = excludePkgs.map((pkg) => `!node_modules/${pkg}/**`);
    return [...base, ...excludePatterns];
  }
  const nodeExcludes = [
    '!node_modules/**',
    '!node_modules/serverless-offline/**',
    '!node_modules/typescript/**',
    '!node_modules/@types/**',
    '!node_modules/aws-sdk/**',
    '!node_modules/@aws-sdk/**',
  ];
  const includeExternals = getExternalPackagePatterns(externalPackages.length > 0 ? externalPackages : DEFAULT_EXTERNAL_PACKAGES);
  return [...base, ...nodeExcludes, ...includeExternals];
}

/**
 * Validates group names: reject reserved 'core', max 12 characters.
 */
function validateGroupNames(workers: WorkerInfo[]): void {
  for (const w of workers) {
    if (w.group === 'core') {
      console.error(chalk.red("Group name 'core' is reserved. Use another group name for your workers."));
      process.exit(1);
    }
    if (w.group.length > 12) {
      console.error(chalk.red('Group name must be at most 12 characters.'));
      process.exit(1);
    }
  }
}

/**
 * Validates the environment and dependencies.
 */
function validateEnvironment(): void {
  // We no longer strictly require global serverless since we'll install it locally in the temp dir
  // But we do need npm
  try {
    execSync('npm --version', { stdio: 'ignore' });
  } catch (error) {
    console.error(chalk.red('❌ npm is not installed or not in PATH.'));
    process.exit(1);
  }
}

/**
 * Scans for all *.worker.ts files in app/ai directory.
 */
async function scanWorkers(aiPath: string = 'app/ai'): Promise<WorkerInfo[]> {
  const pattern = path.join(aiPath, '**/*.worker.ts').replace(/\\/g, '/');
  const files = await glob(pattern);

  const workers: WorkerInfo[] = [];

  for (const filePath of files) {
    try {
      // Try to dynamically import the worker file to get the actual workerConfig
      // This is more reliable than parsing the file as text
      let workerConfig: WorkerInfo['workerConfig'] | undefined;
      let workerId: string | undefined;

      // For now, just extract the ID using regex
      // We'll import the workerConfig from the bundled handlers later

      // Fallback to regex parsing if import didn't work
      let groupFromSource = 'default';
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!workerId) {
        // Match createWorker with optional type parameters: createWorker<...>({ id: '...' })
        // or createWorker({ id: '...' })
        const idMatch = content.match(/createWorker\s*(?:<[^>]+>)?\s*\(\s*\{[\s\S]*?id:\s*['"]([^'"]+)['"]/);
        if (!idMatch) {
          console.warn(chalk.yellow(`⚠️  Skipping ${filePath}: No worker ID found`));
          continue;
        }
        workerId = idMatch[1];
      }
      // Extract group from exported workerConfig if present (e.g. workerConfig: { group: 'workflows' })
      const groupMatch = content.match(/group:\s*['"]([^'"]+)['"]/);
      if (groupMatch) {
        groupFromSource = groupMatch[1];
      }

      // Generate handler path (relative to serverless root)
      // Convert app/ai/agents/my-worker.worker.ts -> handlers/my-worker
      const relativePath = path.relative(aiPath, filePath);
      const handlerDir = path.dirname(relativePath);
      const handlerName = path.basename(relativePath, '.worker.ts');
      const handlerPath = path.join('handlers', handlerDir, `${handlerName}`).replace(/\\/g, '/');

      workers.push({
        id: workerId,
        filePath,
        handlerPath,
        group: groupFromSource,
        workerConfig,
      });
    } catch (error) {
      console.error(chalk.red(`❌ Error processing ${filePath}:`), error);
    }
  }

  return workers;
}

/**
 * Scans for *.queue.ts files and parses defineWorkerQueue configs.
 */
async function scanQueues(aiPath: string = 'app/ai'): Promise<QueueInfo[]> {
  const base = aiPath.replace(/\\/g, '/');
  const pattern = `${base}/queues/**/*.queue.ts`;
  const files = await glob(pattern);

  const queues: QueueInfo[] = [];

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      // Match defineWorkerQueue({ id: '...', steps: [...], schedule?: ... })
      const idMatch = content.match(/defineWorkerQueue\s*\(\s*\{[\s\S]*?id:\s*['"]([^'"]+)['"]/);
      if (!idMatch) {
        console.warn(chalk.yellow(`⚠️  Skipping ${filePath}: No queue id found in defineWorkerQueue`));
        continue;
      }
      const queueId = idMatch[1];

      const steps: QueueStepInfo[] = [];
      const stepsMatch = content.match(/steps:\s*\[([\s\S]*?)\]/);
      if (stepsMatch) {
        const stepsStr = stepsMatch[1];
        // Match step objects: { workerId: 'x', delaySeconds?: N, mapInputFromPrev?: 'y' }
        // Allow optional comment line between properties; comment before } only (lookahead); no trailing \s*
        const stepRegex = /\{\s*workerId:\s*['"]([^'"]+)['"](?:,\s*(?:\/\/[^\r\n]*\r?\n\s*)?delaySeconds:\s*(\d+))?(?:,\s*(?:\/\/[^\r\n]*\r?\n\s*)?mapInputFromPrev:\s*['"]([^'"]+)['"])?\s*,?\s*(?:\/\/[^\r\n]*\r?\n\s*)?(?=\s*\})\s*\},?/g;
        let m;
        while ((m = stepRegex.exec(stepsStr)) !== null) {
          steps.push({
            workerId: m[1],
            delaySeconds: m[2] ? parseInt(m[2], 10) : undefined,
            mapInputFromPrev: m[3],
          });
        }
      }

      let schedule: QueueInfo['schedule'];
      // Strip single-line comments so commented-out schedule is not picked up
      const contentWithoutLineComments = content.replace(/\/\/[^\n]*/g, '');
      const scheduleStrMatch = contentWithoutLineComments.match(/schedule:\s*['"]([^'"]+)['"]/);
      const scheduleObjMatch = contentWithoutLineComments.match(/schedule:\s*(\{[^}]+(?:\{[^}]*\}[^}]*)*\})/);
      if (scheduleStrMatch) {
        schedule = scheduleStrMatch[1];
      } else if (scheduleObjMatch) {
        try {
          schedule = new Function('return ' + scheduleObjMatch[1])();
        } catch {
          schedule = undefined;
        }
      }

      queues.push({ id: queueId, filePath, steps, schedule });
    } catch (error) {
      console.error(chalk.red(`❌ Error processing ${filePath}:`), error);
    }
  }

  return queues;
}

/**
 * Generates the queue registry module for runtime lookup.
 * For queues with mapInputFromPrev, imports the .queue.ts module so mapping can use any previous step or initial input.
 */
function generateQueueRegistry(queues: QueueInfo[], outputDir: string, projectRoot: string): void {
  const generatedDir = path.join(outputDir, 'generated');
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }

  const relToRoot = path.relative(generatedDir, projectRoot).replace(/\\/g, '/');
  const queueModulesLines: string[] = [];
  const queueModulesEntries: string[] = [];
  const queuesWithMapping = queues.filter(
    (q) => q.steps?.some((s) => s.mapInputFromPrev)
  );
  for (let i = 0; i < queuesWithMapping.length; i++) {
    const q = queuesWithMapping[i];
    const relPath = (relToRoot + '/' + q.filePath.replace(/\\/g, '/')).replace(/\.ts$/, '');
    const safeId = q.id.replace(/[^a-zA-Z0-9]/g, '');
    queueModulesLines.push(`const queueModule_${safeId} = require('${relPath}');`);
    queueModulesEntries.push(`  '${q.id}': queueModule_${safeId},`);
  }
  const queueModulesBlock =
    queueModulesLines.length > 0
      ? `
${queueModulesLines.join('\n')}
const queueModules = {
${queueModulesEntries.join('\n')}
};
`
      : `
const queueModules = {};
`;

  const registryContent = `/**
 * Auto-generated queue registry. DO NOT EDIT.
 * Generated by @microfox/ai-worker-cli from .queue.ts files.
 */
${queueModulesBlock}

const QUEUES = ${JSON.stringify(queues.map((q) => ({ id: q.id, steps: q.steps, schedule: q.schedule })), null, 2)};

export function getQueueById(queueId) {
  return QUEUES.find((q) => q.id === queueId);
}

export function getNextStep(queueId, stepIndex) {
  const queue = getQueueById(queueId);
  if (!queue || !queue.steps || stepIndex < 0 || stepIndex >= queue.steps.length - 1) {
    return undefined;
  }
  const step = queue.steps[stepIndex + 1];
  return step ? { workerId: step.workerId, delaySeconds: step.delaySeconds, mapInputFromPrev: step.mapInputFromPrev } : undefined;
}

export function invokeMapInput(queueId, stepIndex, initialInput, previousOutputs) {
  const queue = getQueueById(queueId);
  const step = queue?.steps?.[stepIndex];
  const fnName = step?.mapInputFromPrev;
  if (!fnName) return previousOutputs.length ? previousOutputs[previousOutputs.length - 1].output : initialInput;
  const mod = queueModules[queueId];
  if (!mod || typeof mod[fnName] !== 'function') return previousOutputs.length ? previousOutputs[previousOutputs.length - 1].output : initialInput;
  return mod[fnName](initialInput, previousOutputs);
}
`;

  const registryPath = path.join(generatedDir, 'workerQueues.registry.js');
  fs.writeFileSync(registryPath, registryContent);
  console.log(chalk.green(`✓ Generated queue registry: ${registryPath}`));

  // Note: For dispatchQueue in app (e.g. Vercel), use in-memory registry:
  // app/ai/queues/registry.ts imports from .queue.ts and exports queueRegistry.
}

/**
 * Returns worker IDs that participate in any queue (for wrapping and callee injection).
 */
function getWorkersInQueues(queues: QueueInfo[]): Set<string> {
  const set = new Set<string>();
  for (const q of queues) {
    for (const step of q.steps) {
      set.add(step.workerId);
    }
  }
  return set;
}

/**
 * Merges queue next-step worker IDs into calleeIds so WORKER_QUEUE_URL_* gets injected.
 */
function mergeQueueCallees(
  calleeIds: Map<string, Set<string>>,
  queues: QueueInfo[],
  workers: WorkerInfo[]
): Map<string, Set<string>> {
  const merged = new Map(calleeIds);
  const workerIds = new Set(workers.map((w) => w.id));

  for (const queue of queues) {
    for (let i = 0; i < queue.steps.length - 1; i++) {
      const fromWorkerId = queue.steps[i].workerId;
      const toWorkerId = queue.steps[i + 1].workerId;
      if (!workerIds.has(toWorkerId)) continue;
      let callees = merged.get(fromWorkerId);
      if (!callees) {
        callees = new Set<string>();
        merged.set(fromWorkerId, callees);
      }
      callees.add(toWorkerId);
    }
  }
  return merged;
}

/**
 * Generates Lambda handler entrypoints for each worker.
 */
async function generateHandlers(
  workers: WorkerInfo[],
  outputDir: string,
  queues: QueueInfo[] = [],
  externalPackages: string[] = []
): Promise<void> {
  const handlersDir = path.join(outputDir, 'handlers');
  const workersSubdir = path.join(handlersDir, 'workers');
  const workersInQueues = getWorkersInQueues(queues);

  // Only clean workers subdir so handlers/api and handlers/queues can coexist
  if (fs.existsSync(workersSubdir)) {
    fs.rmSync(workersSubdir, { recursive: true, force: true });
  }
  fs.mkdirSync(handlersDir, { recursive: true });
  fs.mkdirSync(workersSubdir, { recursive: true });

  for (const worker of workers) {
    // Create directory structure
    // We output JS files now, so change extension in path
    const handlerFile = path.join(handlersDir, worker.handlerPath.replace('handlers/', '') + '.js');
    const handlerDir = path.dirname(handlerFile);

    if (!fs.existsSync(handlerDir)) {
      fs.mkdirSync(handlerDir, { recursive: true });
    }

    // Generate handler entrypoint
    // Convert app/ai/agents/my-worker.worker.ts to import path
    // We need relative path from .serverless-workers/handlers/agent/ to original source
    // Original: /path/to/project/app/ai/agents/my-worker.worker.ts
    // Handler: /path/to/project/.serverless-workers/handlers/agent/my-worker.handler.ts
    // Import should look like: ../../../app/ai/agents/my-worker.worker

    const handlerAbsPath = path.resolve(handlerFile);
    const workerAbsPath = path.resolve(worker.filePath);

    // Calculate relative path from handler directory to worker file
    let relativeImportPath = path.relative(path.dirname(handlerAbsPath), workerAbsPath);

    // Ensure it starts with ./ or ../
    if (!relativeImportPath.startsWith('.')) {
      relativeImportPath = './' + relativeImportPath;
    }

    // Remove extension for import
    relativeImportPath = relativeImportPath.replace(/\.ts$/, '');
    // Normalize slashes for Windows
    relativeImportPath = relativeImportPath.split(path.sep).join('/');

    // Detect export: "export default createWorker" vs "export const X = createWorker"
    const fileContent = fs.readFileSync(worker.filePath, 'utf-8');
    const defaultExport = /export\s+default\s+createWorker/.test(fileContent);
    const exportMatch = fileContent.match(/export\s+(const|let)\s+(\w+)\s*=\s*createWorker/);
    const exportName = exportMatch ? exportMatch[2] : 'worker';

    // 1. Create a temporary TS entrypoint
    const tempEntryFile = handlerFile.replace('.js', '.temp.ts');

    const workerRef = defaultExport
      ? 'workerModule.default'
      : `workerModule.${exportName}`;

    const inQueue = workersInQueues.has(worker.id);
    const registryRelPath = path
      .relative(path.dirname(path.resolve(handlerFile)), path.join(outputDir, 'generated', 'workerQueues.registry'))
      .split(path.sep)
      .join('/');
    const registryImportPath = registryRelPath.startsWith('.') ? registryRelPath : './' + registryRelPath;

    const handlerCreation = inQueue
      ? `
import { createLambdaHandler, wrapHandlerForQueue } from '@microfox/ai-worker/handler';
import { getQueueJob } from '@microfox/ai-worker/queueJobStore';
import * as queueRegistry from '${registryImportPath}';
import * as workerModule from '${relativeImportPath}';

const WORKER_LOG_PREFIX = '[WorkerEntrypoint]';

const workerAgent = ${workerRef};
if (!workerAgent || typeof workerAgent.handler !== 'function') {
  throw new Error('Worker module must export a createWorker result (default or named) with .handler');
}

const queueRuntime = {
  getNextStep: queueRegistry.getNextStep,
  invokeMapInput: queueRegistry.invokeMapInput,
  getQueueJob,
};
const wrappedHandler = wrapHandlerForQueue(workerAgent.handler, queueRuntime);

const baseHandler = createLambdaHandler(wrappedHandler, workerAgent.outputSchema);

export const handler = async (event: any, context: any) => {
  const records = Array.isArray((event as any)?.Records) ? (event as any).Records.length : 0;
  let queueId, queueJobId;
  try {
    const first = (event as any)?.Records?.[0];
    if (first?.body) {
      const body = typeof first.body === 'string' ? JSON.parse(first.body) : first.body;
      const qc = body?.input?.__workerQueue ?? body?.metadata?.__workerQueue;
      if (qc?.id) queueId = qc.id;
      if (qc?.queueJobId) queueJobId = qc.queueJobId;
    }
    console.log(WORKER_LOG_PREFIX, {
      workerId: workerAgent.id,
      inQueue: true,
      ...(queueId && { queueId }),
      ...(queueJobId && { queueJobId }),
      records,
      requestId: (context as any)?.awsRequestId,
    });
  } catch {
    // Best-effort logging only
  }
  return baseHandler(event, context);
};

export const exportedWorkerConfig = workerModule.workerConfig || workerAgent?.workerConfig;
`
      : `
import { createLambdaHandler } from '@microfox/ai-worker/handler';
import * as workerModule from '${relativeImportPath}';

const WORKER_LOG_PREFIX = '[WorkerEntrypoint]';

const workerAgent = ${workerRef};
if (!workerAgent || typeof workerAgent.handler !== 'function') {
  throw new Error('Worker module must export a createWorker result (default or named) with .handler');
}

const baseHandler = createLambdaHandler(workerAgent.handler, workerAgent.outputSchema);

export const handler = async (event: any, context: any) => {
  const records = Array.isArray((event as any)?.Records) ? (event as any).Records.length : 0;
  try {
    console.log(WORKER_LOG_PREFIX, {
      workerId: workerAgent.id,
      inQueue: false,
      records,
      requestId: (context as any)?.awsRequestId,
    });
  } catch {
    // Best-effort logging only
  }
  return baseHandler(event, context);
};

export const exportedWorkerConfig = workerModule.workerConfig || workerAgent?.workerConfig;
`;

    const tempEntryContent = handlerCreation;
    fs.writeFileSync(tempEntryFile, tempEntryContent);

    // 2. Bundle using esbuild
    try {
      // Plugin to fix lazy-cache issue where forOwn is not properly added to utils
      // The issue: require_for_own() is called directly instead of through the lazy-cache proxy
      const fixLazyCachePlugin: esbuild.Plugin = {
        name: 'fix-lazy-cache',
        setup(build) {
          build.onEnd(async (result) => {
            if (result.errors.length > 0) return;

            // Read the bundled file
            let bundledCode = fs.readFileSync(handlerFile, 'utf-8');
            let modified = false;

            // Fix the lazy-cache pattern in clone-deep/utils.js
            // Pattern: require_for_own(); should be require("for-own", "forOwn");
            // This ensures forOwn is properly added to the utils object via lazy-cache
            // Match the pattern more flexibly to handle different whitespace
            const pattern = /(require\("kind-of",\s*"typeOf"\);\s*)require_for_own\(\);/g;

            if (pattern.test(bundledCode)) {
              bundledCode = bundledCode.replace(
                pattern,
                '$1require("for-own", "forOwn");'
              );
              modified = true;
            }

            // Fix (0, import_node_module.createRequire)(import_meta.url) - esbuild emits import_meta.url
            // which is undefined in CJS Lambda. Polyfill so createRequire gets a valid file URL.
            if (bundledCode.includes('import_meta.url')) {
              bundledCode = bundledCode.replace(
                /import_meta\.url/g,
                'require("url").pathToFileURL(__filename).href'
              );
              modified = true;
            }

            // Fix createRequire(undefined) / createRequire(void 0) if any dependency emits that
            const beforeCreateRequire = bundledCode;
            bundledCode = bundledCode.replace(
              /\bcreateRequire\s*\(\s*(?:undefined|void\s*0)\s*\)/g,
              'createRequire(require("url").pathToFileURL(__filename).href)'
            );
            if (bundledCode !== beforeCreateRequire) modified = true;

            if (modified) {
              fs.writeFileSync(handlerFile, bundledCode, 'utf-8');
            }
          });
        },
      };

      await esbuild.build({
        entryPoints: [tempEntryFile],
        bundle: true,
        platform: 'node',
        target: 'node20',
        format: 'cjs',
        outfile: handlerFile,
        external: externalPackages.length > 0 ? externalPackages : DEFAULT_EXTERNAL_PACKAGES,
        // Force lazy-cache to eagerly load modules during bundling
        // This prevents runtime dynamic require() calls that fail in bundled code
        define: {
          'process.env.UNLAZY': '"true"',
        },
        // Force bundling of all packages to avoid runtime module resolution issues
        // This ensures clone-deep, lazy-cache, and all transitive deps are bundled
        packages: 'bundle',
        plugins: [fixLazyCachePlugin],
        logLevel: 'error',
      });

      // 3. Cleanup temp file
      fs.unlinkSync(tempEntryFile);

    } catch (error) {
      console.error(chalk.red(`Error bundling handler for ${worker.id}:`), error);
      // Don't delete temp file on error for debugging
    }
  }
  console.log(chalk.green(`✓ Generated ${workers.length} bundled handlers`));
}

function generateDocsHandler(outputDir: string, serviceName: string, stage: string, region: string, externalPackages: string[] = []): void {
  const apiDir = path.join(outputDir, 'handlers', 'api');
  const handlerFile = path.join(apiDir, 'docs.js');
  const tempEntryFile = handlerFile.replace('.js', '.temp.ts');
  const handlerDir = path.dirname(handlerFile);

  if (!fs.existsSync(handlerDir)) {
    fs.mkdirSync(handlerDir, { recursive: true });
  }

  const handlerContent = `/**
 * Auto-generated docs handler for Microfox compatibility
 * DO NOT EDIT - This file is generated by @microfox/ai-worker-cli
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  // Return OpenAPI JSON for Microfox
  const openapi = {
    openapi: '3.0.3',
    info: {
      title: 'AI Worker Service',
      version: '1.0.0',
      description: 'Auto-generated OpenAPI for background workers service',
    },
    servers: [
      {
        url: 'https://{apiId}.execute-api.{region}.amazonaws.com/{stage}',
        variables: {
          apiId: { default: 'REPLACE_ME' },
          region: { default: '${region}' },
          stage: { default: '${stage}' },
        },
      },
    ],
    paths: {
      '/docs.json': {
        get: {
          operationId: 'getDocs',
          summary: 'Get OpenAPI schema',
          responses: {
            '200': {
              description: 'OpenAPI JSON',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/workers/config': {
        get: {
          operationId: 'getWorkersConfig',
          summary: 'Get workers config (queue urls map)',
          parameters: [
            {
              name: 'x-workers-config-key',
              in: 'header',
              required: false,
              schema: { type: 'string' },
              description: 'Optional API key header (if configured)',
            },
          ],
          responses: {
            '200': {
              description: 'Workers config map',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      version: { type: 'string' },
                      stage: { type: 'string' },
                      region: { type: 'string' },
                      workers: { type: 'object' },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Unauthorized',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { error: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      '/workers/trigger': {
        post: {
          operationId: 'triggerWorker',
          summary: 'Trigger a worker by sending a raw SQS message body',
          parameters: [
            {
              name: 'workerId',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Worker ID (can also be provided in JSON body as workerId)',
            },
            {
              name: 'x-workers-trigger-key',
              in: 'header',
              required: false,
              schema: { type: 'string' },
              description: 'Optional API key header (if configured)',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    workerId: { type: 'string' },
                    // Prefer sending the exact SQS message body your worker expects
                    body: { type: 'object' },
                    messageBody: { type: 'string' },
                  },
                  additionalProperties: true,
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Enqueued',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean' },
                      workerId: { type: 'string' },
                      stage: { type: 'string' },
                      queueName: { type: 'string' },
                      queueUrl: { type: 'string' },
                      messageId: { type: 'string' },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Bad request',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { error: { type: 'string' } },
                  },
                },
              },
            },
            '401': {
              description: 'Unauthorized',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { error: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    'x-service': {
      serviceName: '${serviceName}',
      stage: '${stage}',
      region: '${region}',
    },
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(openapi, null, 2),
  };
};
`;

  fs.writeFileSync(tempEntryFile, handlerContent);

  // Bundle it
  const externals = externalPackages.length > 0 ? externalPackages : DEFAULT_EXTERNAL_PACKAGES;
  esbuild.buildSync({
    entryPoints: [tempEntryFile],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: handlerFile,
    external: externals,
    define: {
      'process.env.UNLAZY': '"true"',
    },
    packages: 'bundle'
  });

  fs.unlinkSync(tempEntryFile);
  console.log(chalk.green(`✓ Generated docs.json handler`));
}

function generateTriggerHandler(outputDir: string, serviceName: string, externalPackages: string[] = []): void {
  const apiDir = path.join(outputDir, 'handlers', 'api');
  const handlerFile = path.join(apiDir, 'workers-trigger.js');
  const tempEntryFile = handlerFile.replace('.js', '.temp.ts');
  const handlerDir = path.dirname(handlerFile);

  if (!fs.existsSync(handlerDir)) {
    fs.mkdirSync(handlerDir, { recursive: true });
  }

  const handlerContent = `/**
 * Auto-generated worker trigger handler
 * DO NOT EDIT - This file is generated by @microfox/ai-worker-cli
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SQSClient, GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs';

const SERVICE_NAME = ${JSON.stringify(serviceName)};

function jsonResponse(statusCode: number, body: any): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Optional API key
  const apiKey = process.env.WORKERS_TRIGGER_API_KEY;
  if (apiKey) {
    const providedKey = event.headers['x-workers-trigger-key'] || event.headers['X-Workers-Trigger-Key'];
    if (providedKey !== apiKey) {
      return jsonResponse(401, { error: 'Unauthorized' });
    }
  }

  const stage =
    (event as any)?.requestContext?.stage ||
    process.env.ENVIRONMENT ||
    process.env.STAGE ||
    'prod';
  const region = process.env.AWS_REGION || 'us-east-1';

  const qsWorkerId = event.queryStringParameters?.workerId;

  let parsedBody: any = undefined;
  if (event.body) {
    try {
      parsedBody = JSON.parse(event.body);
    } catch {
      parsedBody = undefined;
    }
  }

  const workerId = (parsedBody && parsedBody.workerId) || qsWorkerId;
  if (!workerId || typeof workerId !== 'string') {
    return jsonResponse(400, { error: 'workerId is required (query param workerId or JSON body workerId)' });
  }

  // Prefer JSON body fields, otherwise send raw event.body
  let messageBody: string | undefined;
  if (parsedBody && typeof parsedBody.messageBody === 'string') {
    messageBody = parsedBody.messageBody;
  } else if (parsedBody && parsedBody.body !== undefined) {
    messageBody = typeof parsedBody.body === 'string' ? parsedBody.body : JSON.stringify(parsedBody.body);
  } else if (event.body) {
    messageBody = event.body;
  }

  if (!messageBody) {
    return jsonResponse(400, { error: 'body/messageBody is required' });
  }

  const envKey = 'WORKER_QUEUE_URL_' + workerId.replace(/-/g, '_').toUpperCase();
  let queueUrl: string | undefined = process.env[envKey];
  const sqs = new SQSClient({ region });
  let queueName: string | undefined;
  if (!queueUrl) {
    queueName = \`\${SERVICE_NAME}-\${workerId}-\${stage}\`;
    try {
      const urlRes = await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }));
      if (!urlRes.QueueUrl) {
        return jsonResponse(404, { error: 'Queue URL not found', queueName });
      }
      queueUrl = String(urlRes.QueueUrl);
    } catch (e: any) {
      return jsonResponse(404, { error: 'Queue does not exist or not accessible', queueName, message: String(e?.message || e) });
    }
  }

  try {
    const sendRes = await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: messageBody }));
    return jsonResponse(200, {
      ok: true,
      workerId,
      stage,
      queueName,
      queueUrl,
      messageId: sendRes.MessageId || null,
    });
  } catch (e: any) {
    return jsonResponse(500, { error: 'Failed to send message', message: String(e?.message || e) });
  }
};
`;

  fs.writeFileSync(tempEntryFile, handlerContent);

  const externals = externalPackages.length > 0 ? externalPackages : DEFAULT_EXTERNAL_PACKAGES;
  esbuild.buildSync({
    entryPoints: [tempEntryFile],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: handlerFile,
    external: externals,
    define: {
      'process.env.UNLAZY': '"true"',
    },
    packages: 'bundle',
    logLevel: 'error',
  });

  fs.unlinkSync(tempEntryFile);
  console.log(chalk.green(`✓ Generated /workers/trigger handler`));
}

/**
 * Generates queue Lambda for each queue. Invoked by schedule (if any) or by HTTP POST
 * (dispatch proxy). Single place to log "queue X started" and send first worker message.
 */
function generateQueueHandler(
  outputDir: string,
  queue: QueueInfo,
  serviceName: string,
  externalPackages: string[] = []
): void {
  // File-safe queue id for path (keep dashes for readability, e.g. demo-data-processor)
  const queueFileId = queue.id.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
  const queuesDir = path.join(outputDir, 'handlers', 'queues');
  const handlerFile = path.join(queuesDir, `${queueFileId}.js`);
  const tempEntryFile = handlerFile.replace('.js', '.temp.ts');
  const handlerDir = path.dirname(handlerFile);

  if (!fs.existsSync(handlerDir)) {
    fs.mkdirSync(handlerDir, { recursive: true });
  }

  const firstWorkerId = queue.steps[0]?.workerId;
  if (!firstWorkerId) return;

  const handlerContent = `/**
 * Auto-generated queue handler for queue "${queue.id}"
 * DO NOT EDIT - This file is generated by @microfox/ai-worker-cli
 * Invoked by schedule (if configured) or HTTP POST /queues/${queue.id}/start (dispatch proxy).
 */

import { SQSClient, GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { upsertInitialQueueJob } from '@microfox/ai-worker/queueJobStore';

const QUEUE_ID = ${JSON.stringify(queue.id)};
const FIRST_WORKER_ID = ${JSON.stringify(firstWorkerId)};
const SERVICE_NAME = ${JSON.stringify(serviceName)};

function isHttpEvent(event: any): event is { body?: string; requestContext?: any } {
  return event && typeof event.requestContext === 'object' && (event.body !== undefined || event.httpMethod === 'POST');
}

async function getFirstWorkerQueueUrl(region: string, stage: string): Promise<string> {
  const envKey = 'WORKER_QUEUE_URL_' + FIRST_WORKER_ID.replace(/-/g, '_').toUpperCase();
  const fromEnv = process.env[envKey];
  if (fromEnv) return fromEnv;
  const queueName = \`\${SERVICE_NAME}-\${FIRST_WORKER_ID}-\${stage}\`;
  const sqs = new SQSClient({ region });
  const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }));
  if (!QueueUrl) throw new Error('Queue URL not found: ' + queueName);
  return QueueUrl;
}

export const handler = async (event: any) => {
  const stage = process.env.ENVIRONMENT || process.env.STAGE || 'prod';
  const region = process.env.AWS_REGION || 'us-east-1';

  let jobId: string;
  let initialInput: Record<string, any>;
  let context: Record<string, any> = {};
  let metadata: Record<string, any> = {};
  let webhookUrl: string | undefined;

  if (isHttpEvent(event)) {
    const apiKey = process.env.WORKERS_TRIGGER_API_KEY;
    if (apiKey) {
      const provided = (event.headers && (event.headers['x-workers-trigger-key'] || event.headers['X-Workers-Trigger-Key'])) || '';
      if (provided !== apiKey) {
        return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
    }
    let body: { input?: any; initialInput?: any; jobId?: string; metadata?: any; context?: any; webhookUrl?: string } = {};
    if (event.body) {
      try {
        body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      } catch (_) {}
    }
    jobId = (body.jobId && String(body.jobId).trim()) || 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2, 11);
    const rawInput = body.input != null ? body.input : body.initialInput;
    initialInput = rawInput != null && typeof rawInput === 'object' ? rawInput : {};
    context = body.context && typeof body.context === 'object' ? body.context : {};
    metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
    webhookUrl = typeof body.webhookUrl === 'string' ? body.webhookUrl : undefined;

    const response = { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '' };
    try {
      await upsertInitialQueueJob({ queueJobId: jobId, queueId: QUEUE_ID, firstWorkerId: FIRST_WORKER_ID, firstWorkerJobId: jobId, metadata });
      const queueUrl = await getFirstWorkerQueueUrl(region, stage);
      await sendFirstMessage(region, queueUrl, jobId, initialInput, context, metadata, webhookUrl, 'http');
      response.body = JSON.stringify({ queueId: QUEUE_ID, jobId, status: 'queued' });
    } catch (err: any) {
      response.statusCode = 500;
      response.body = JSON.stringify({ error: err?.message || String(err) });
    }
    return response;
  }

  // Scheduled invocation
  jobId = 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2, 11);
  initialInput = {};
  try {
    await upsertInitialQueueJob({ queueJobId: jobId, queueId: QUEUE_ID, firstWorkerId: FIRST_WORKER_ID, firstWorkerJobId: jobId, metadata: {} });
  } catch (_) {}
  const queueUrl = await getFirstWorkerQueueUrl(region, stage);
  await sendFirstMessage(region, queueUrl, jobId, initialInput, context, metadata, webhookUrl, 'schedule');
};

async function sendFirstMessage(
  region: string,
  queueUrlOrName: string,
  jobId: string,
  initialInput: Record<string, any>,
  context: Record<string, any>,
  metadata: Record<string, any>,
  webhookUrl?: string,
  trigger?: 'schedule' | 'http'
) {
  const sqs = new SQSClient({ region });
  const QueueUrl = queueUrlOrName.startsWith('http') ? queueUrlOrName : (await sqs.send(new GetQueueUrlCommand({ QueueName: queueUrlOrName }))).QueueUrl;
  if (!QueueUrl) {
    throw new Error('Queue URL not found: ' + queueUrlOrName);
  }

  const queueContext = { id: QUEUE_ID, stepIndex: 0, initialInput, queueJobId: jobId };
  const messageBody = {
    workerId: FIRST_WORKER_ID,
    jobId,
    input: { ...initialInput, __workerQueue: queueContext },
    context,
    metadata: { ...metadata, __workerQueue: queueContext },
    ...(webhookUrl ? { webhookUrl } : {}),
    timestamp: new Date().toISOString(),
  };

  await sqs.send(new SendMessageCommand({
    QueueUrl,
    MessageBody: JSON.stringify(messageBody),
  }));

  console.log('[queue] Dispatched first worker', { queueId: QUEUE_ID, jobId, workerId: FIRST_WORKER_ID, trigger: trigger ?? 'unknown' });
}
`;

  fs.writeFileSync(tempEntryFile, handlerContent);
  const queueExternals = externalPackages.length > 0 ? externalPackages : DEFAULT_EXTERNAL_PACKAGES;
  esbuild.buildSync({
    entryPoints: [tempEntryFile],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: handlerFile,
    external: queueExternals,
    packages: 'bundle',
    logLevel: 'error',
  });
  fs.unlinkSync(tempEntryFile);
  console.log(chalk.green(`✓ Generated queue handler for ${queue.id}`));
}

/**
 * Generates workers-config Lambda handler.
 */
function generateWorkersConfigHandler(
  outputDir: string,
  workers: WorkerInfo[],
  serviceName: string,
  queues: QueueInfo[] = [],
  externalPackages: string[] = []
): void {
  // We'll bundle this one too
  const apiDir = path.join(outputDir, 'handlers', 'api');
  const handlerFile = path.join(apiDir, 'workers-config.js');
  const tempEntryFile = handlerFile.replace('.js', '.temp.ts');
  const handlerDir = path.dirname(handlerFile);

  if (!fs.existsSync(handlerDir)) {
    fs.mkdirSync(handlerDir, { recursive: true });
  }

  const handlerContent = `/**
 * Auto-generated workers-config Lambda handler
 * DO NOT EDIT - This file is generated by @microfox/ai-worker-cli
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SQSClient, GetQueueUrlCommand } from '@aws-sdk/client-sqs';

// Worker IDs and queue definitions embedded at build time.
const WORKER_IDS: string[] = ${JSON.stringify(workers.map(w => w.id), null, 2)};
const QUEUES = ${JSON.stringify(queues.map(q => ({ id: q.id, steps: q.steps, schedule: q.schedule })), null, 2)};
const SERVICE_NAME = ${JSON.stringify(serviceName)};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
// ... same logic ...
  // Check API key if configured
  const apiKey = process.env.WORKERS_CONFIG_API_KEY;
  if (apiKey) {
    const providedKey = event.headers['x-workers-config-key'] || event.headers['X-Workers-Config-Key'];
    if (providedKey !== apiKey) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }
  }

  // Stage resolution:
  // - Prefer API Gateway stage (microfox tends to deploy APIs on "prod")
  // - Fallback to ENVIRONMENT/STAGE env vars
  // - Default to "prod" (safer for microfox) if nothing else is set
  const stage =
    (event as any)?.requestContext?.stage ||
    process.env.ENVIRONMENT ||
    process.env.STAGE ||
    'prod';
  const region = process.env.AWS_REGION || 'us-east-1';

  // Resolve queue URLs dynamically via SQS so we return actual URLs.
  // NOTE: Node 20 Lambda runtime does NOT guarantee 'aws-sdk' v2 is available.
  // We use AWS SDK v3 and bundle it into this handler.
  const sqs = new SQSClient({ region });
  const workers: Record<string, { queueUrl: string; region: string }> = {};
  const attemptedQueueNames: string[] = [];
  const errors: Array<{ workerId: string; queueName: string; message: string; name?: string }> = [];
  const debug = event.queryStringParameters?.debug === '1' || event.queryStringParameters?.debug === 'true';

  await Promise.all(
    WORKER_IDS.map(async (workerId) => {
      // Prefer convention-based env vars generated in core stack so we can support multiple groups.
      const envKey = 'WORKER_QUEUE_URL_' + workerId.replace(/-/g, '_').toUpperCase();
      const fromEnv = process.env[envKey];
      if (fromEnv) {
        workers[workerId] = { queueUrl: fromEnv, region };
        return;
      }

      // Fallback: resolve via SQS GetQueueUrl for backward compatibility.
      const queueName = \`\${SERVICE_NAME}-\${workerId}-\${stage}\`;
      attemptedQueueNames.push(queueName);
      try {
        const result = await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }));
        if (result?.QueueUrl) {
          workers[workerId] = { queueUrl: String(result.QueueUrl), region };
        }
      } catch (e) {
        const err = e as any;
        const message = String(err?.message || err || 'Unknown error');
        const name = err?.name ? String(err.name) : undefined;
        // Log so CloudWatch shows what's going on (nonexistent queue vs permission vs region).
        console.error('[workers-config] getQueueUrl failed', { workerId, queueName, name, message });
        errors.push({ workerId, queueName, name, message });
      }
    })
  );

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      version: '1.0.0',
      stage,
      region,
      workers,
      queues: QUEUES,
      ...(debug ? { attemptedQueueNames, errors } : {}),
    }),
  };
};
`;

  fs.writeFileSync(tempEntryFile, handlerContent);

  // Bundle it
  const configExternals = externalPackages.length > 0 ? externalPackages : DEFAULT_EXTERNAL_PACKAGES;
  esbuild.buildSync({
    entryPoints: [tempEntryFile],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: handlerFile,
    external: configExternals,
    define: {
      'process.env.UNLAZY': '"true"',
    },
    packages: 'bundle'
  });

  fs.unlinkSync(tempEntryFile);
  console.log(chalk.green(`✓ Generated workers-config handler`));
}

/**
 * Reads environment variables from .env file.
 */
function loadEnvVars(envPath: string = '.env'): Record<string, string> {
  const env: Record<string, string> = {};

  if (!fs.existsSync(envPath)) {
    console.warn(chalk.yellow(`⚠️  .env file not found at ${envPath}`));
    return env;
  }

  const content = fs.readFileSync(envPath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      env[key] = value;
    }
  }

  return env;
}

/**
 * Converts schedule configuration to serverless.yml schedule event format.
 * Supports simple strings, configuration objects, and arrays of both.
 */
function processScheduleEvents(scheduleConfig: any): any[] {
  if (!scheduleConfig) {
    return [];
  }

  const events: any[] = [];

  // Normalize to array
  const schedules = Array.isArray(scheduleConfig) ? scheduleConfig : [scheduleConfig];

  for (const schedule of schedules) {
    // Simple string format: 'rate(2 hours)' or 'cron(0 12 * * ? *)'
    if (typeof schedule === 'string') {
      events.push({
        schedule: schedule,
      });
      continue;
    }

    // Full configuration object
    if (typeof schedule === 'object' && schedule !== null) {
      const scheduleEvent: any = { schedule: {} };

      // Handle rate - can be string or array of strings
      if (schedule.rate) {
        if (Array.isArray(schedule.rate)) {
          // Multiple rate expressions
          scheduleEvent.schedule.rate = schedule.rate;
        } else {
          // Single rate expression
          scheduleEvent.schedule.rate = schedule.rate;
        }
      } else {
        // If no rate specified but we have a schedule object, skip it
        continue;
      }

      // Optional fields
      if (schedule.enabled !== undefined) {
        scheduleEvent.schedule.enabled = schedule.enabled;
      }
      if (schedule.input !== undefined) {
        scheduleEvent.schedule.input = schedule.input;
      }
      if (schedule.inputPath !== undefined) {
        scheduleEvent.schedule.inputPath = schedule.inputPath;
      }
      if (schedule.inputTransformer !== undefined) {
        scheduleEvent.schedule.inputTransformer = schedule.inputTransformer;
      }
      if (schedule.name !== undefined) {
        scheduleEvent.schedule.name = schedule.name;
      }
      if (schedule.description !== undefined) {
        scheduleEvent.schedule.description = schedule.description;
      }
      if (schedule.method !== undefined) {
        scheduleEvent.schedule.method = schedule.method;
      }
      if (schedule.timezone !== undefined) {
        scheduleEvent.schedule.timezone = schedule.timezone;
      }

      // If schedule object only has rate (or is minimal), we can simplify it
      // Serverless Framework accepts both { schedule: 'rate(...)' } and { schedule: { rate: 'rate(...)' } }
      if (Object.keys(scheduleEvent.schedule).length === 1 && scheduleEvent.schedule.rate) {
        // Simplify to string format if it's just a single rate
        if (typeof scheduleEvent.schedule.rate === 'string') {
          events.push({
            schedule: scheduleEvent.schedule.rate,
          });
        } else {
          // Keep object format for arrays
          events.push(scheduleEvent);
        }
      } else {
        events.push(scheduleEvent);
      }
    }
  }

  return events;
}

/** Options for user-group-only serverless config (no trigger/config/docs/queue starters). */
interface GenerateServerlessConfigOptions {
  userGroupOnly?: boolean;
  projectId?: string;
  /** All workers across groups (for cross-group queue next-step env + IAM). */
  allWorkers?: WorkerInfo[];
  /** External packages to include in Lambda package (node_modules/<pkg>/**). */
  externalPackages?: string[];
  /** microfox.json config for package pattern control (worker.includeNodeModules, worker.excludeNodeModules, worker.groups[group]). */
  microfoxConfig?: Record<string, any> | null;
  /** Group name for per-group overrides (worker.groups[group].includeNodeModules, excludeNodeModules). */
  group?: string | null;
}

/**
 * Generates serverless.yml configuration.
 */
function generateServerlessConfig(
  workers: WorkerInfo[],
  stage: string,
  region: string,
  envVars: Record<string, string>,
  serviceName: string,
  calleeIds: Map<string, Set<string>> = new Map(),
  queues: QueueInfo[] = [],
  options: GenerateServerlessConfigOptions = {}
): ServerlessConfig {
  const { userGroupOnly = false, projectId, allWorkers: allWorkersForCallee = [], externalPackages = [], microfoxConfig = null, group: optionsGroup = null } = options;
  const workerIdsInThisGroup = new Set(workers.map((w) => w.id));
  // Create SQS queues for each worker
  const resources: ServerlessConfig['resources'] = {
    Resources: {},
    Outputs: {},
  };

  const queueArns: Array<string | Record<string, any>> = [];

  // Update provider environment to use file(env.json)
  const providerEnvironment: any = {
    STAGE: stage,
    NODE_ENV: stage,
  };

  // Custom configuration including serverless-offline
  const customConfig: Record<string, any> = {
    stage: `\${env:ENVIRONMENT, '${stage}'}`,
    'serverless-offline': {
      httpPort: 4000,
      lambdaPort: 4002,
      useChildProcesses: true,
      useWorkerThreads: true,
      noCookieValidation: true,
      allowCache: true,
      hideStackTraces: false,
      disableCookieValidation: true,
      noTimeout: true,
      environment: '\${file(env.json)}',
    }
  };

  for (const worker of workers) {
    const queueName = `WorkerQueue${worker.id.replace(/[^a-zA-Z0-9]/g, '')}`;
    const queueLogicalId = `${queueName}${stage}`;
    const dlqLogicalId = `${queueName}DLQ${stage}`;

    const sqsCfg = worker.workerConfig?.sqs;
    const retention =
      typeof sqsCfg?.messageRetentionPeriod === 'number'
        ? sqsCfg.messageRetentionPeriod
        : 1209600; // 14 days
    const dlqRetention =
      typeof sqsCfg?.deadLetterMessageRetentionPeriod === 'number'
        ? sqsCfg.deadLetterMessageRetentionPeriod
        : retention;
    const visibilityTimeout =
      typeof sqsCfg?.visibilityTimeout === 'number'
        ? sqsCfg.visibilityTimeout
        : (worker.workerConfig?.timeout || 300) + 60; // Add buffer
    const maxReceiveCountRaw =
      typeof sqsCfg?.maxReceiveCount === 'number' ? sqsCfg.maxReceiveCount : 1;
    // SQS does not support 0; treat <=0 as 1.
    const maxReceiveCount = Math.max(1, Math.floor(maxReceiveCountRaw));

    // DLQ (always create so we can support "no retries" mode safely)
    resources.Resources[dlqLogicalId] = {
      Type: 'AWS::SQS::Queue',
      Properties: {
        QueueName: `\${self:service}-${worker.id}-dlq-\${opt:stage, env:ENVIRONMENT, '${stage}'}`,
        MessageRetentionPeriod: dlqRetention,
      },
    };

    resources.Resources[queueLogicalId] = {
      Type: 'AWS::SQS::Queue',
      Properties: {
        // Use ${self:service} to avoid hardcoding service name
        QueueName: `\${self:service}-${worker.id}-\${opt:stage, env:ENVIRONMENT, '${stage}'}`,
        VisibilityTimeout: visibilityTimeout,
        MessageRetentionPeriod: retention,
        RedrivePolicy: {
          deadLetterTargetArn: { 'Fn::GetAtt': [dlqLogicalId, 'Arn'] },
          maxReceiveCount,
        },
      },
    };

    resources.Outputs[`${queueLogicalId}Url`] = {
      Description: `Queue URL for worker ${worker.id}`,
      Value: { Ref: queueLogicalId },
      Export: {
        Name: `\${self:service}-${worker.id}-queue-url`,
      },
    };

    queueArns.push({ 'Fn::GetAtt': [queueLogicalId, 'Arn'] });
  }

  // Create functions for each worker
  const functions: Record<string, any> = {};

  for (const worker of workers) {
    const functionName = toPrefixedCamel('worker', worker.id);

    // Start with SQS event (default)
    const events: any[] = [
      {
        sqs: {
          arn: { 'Fn::GetAtt': [`WorkerQueue${worker.id.replace(/[^a-zA-Z0-9]/g, '')}${stage}`, 'Arn'] },
          batchSize: 1,
        },
      },
    ];

    // Add schedule events if configured
    if (worker.workerConfig?.schedule) {
      const scheduleEvents = processScheduleEvents(worker.workerConfig.schedule);
      events.push(...scheduleEvents);
    }

    functions[functionName] = {
      // IMPORTANT: Keep AWS handler string to exactly one dot: "<modulePath>.handler"
      handler: `${worker.handlerPath}.handler`,
      timeout: worker.workerConfig?.timeout || 300,
      memorySize: worker.workerConfig?.memorySize || 512,
      events,
    };

    if (worker.workerConfig?.layers?.length) {
      functions[functionName].layers = worker.workerConfig.layers;
    }

    // Per-function env: queue URLs for workers this Lambda calls (ctx.dispatchWorker)
    const callees = calleeIds.get(worker.id);
    if (callees && callees.size > 0) {
      const env: Record<string, any> = {};
      for (const calleeId of callees) {
        const calleeWorker = workers.find((w) => w.id === calleeId);
        if (calleeWorker) {
          const queueLogicalId = `WorkerQueue${calleeWorker.id.replace(/[^a-zA-Z0-9]/g, '')}${stage}`;
          const envKey = `WORKER_QUEUE_URL_${sanitizeWorkerIdForEnv(calleeId)}`;
          env[envKey] = { Ref: queueLogicalId };
        } else if (userGroupOnly && projectId && allWorkersForCallee.length > 0) {
          const crossCallee = allWorkersForCallee.find((w) => w.id === calleeId);
          if (crossCallee) {
            const svc = getServiceNameFromProjectId(projectId, crossCallee.group);
            const url = `https://sqs.\${aws:region}.amazonaws.com/\${aws:accountId}/${svc}-${calleeId}-\${opt:stage, env:ENVIRONMENT, '${stage}'}`;
            env[`WORKER_QUEUE_URL_${sanitizeWorkerIdForEnv(calleeId)}`] = url;
          }
        }
      }
      if (Object.keys(env).length > 0) {
        functions[functionName].environment = env;
      }
    }
  }

  // Cross-group queue ARN patterns for IAM (userGroupOnly, queue next-step)
  let crossGroupArnPatterns: string[] = [];
  if (userGroupOnly && projectId && allWorkersForCallee.length > 0) {
    const set = new Set<string>();
    for (const worker of workers) {
      const callees = calleeIds.get(worker.id);
      if (callees) {
        for (const calleeId of callees) {
          const calleeWorker = allWorkersForCallee.find((w) => w.id === calleeId);
          if (calleeWorker && !workerIdsInThisGroup.has(calleeId)) {
            const svc = getServiceNameFromProjectId(projectId, calleeWorker.group);
            set.add(`arn:aws:sqs:\${aws:region}:\${aws:accountId}:${svc}-${calleeId}-*`);
          }
        }
      }
    }
    crossGroupArnPatterns = Array.from(set);
  }

  // Add docs.json function for Microfox compatibility (skip when userGroupOnly)
  if (!userGroupOnly) {
  functions['getDocs'] = {
    handler: 'handlers/api/docs.handler',
    events: [
      {
        http: {
          path: '/docs.json',
          method: 'GET',
          cors: true,
        },
      },
    ],
  };

  }

  // Add workers trigger endpoint (HTTP -> SQS SendMessage) - skip when userGroupOnly
  if (!userGroupOnly) {
  functions['triggerWorker'] = {
    handler: 'handlers/api/workers-trigger.handler',
    events: [
      {
        http: {
          path: '/workers/trigger',
          method: 'POST',
          cors: true,
        },
      },
    ],
  };

  functions['workersConfig'] = {
    handler: 'handlers/api/workers-config.handler',
    events: [
      {
        http: {
          path: 'workers/config',
          method: 'GET',
          cors: true,
        },
      },
    ],
  };

  }

  // One function per queue: HTTP POST /queues/:queueId/start (dispatch proxy) + optional schedule - skip when userGroupOnly
  if (!userGroupOnly) {
  for (const queue of queues) {
    const queueFileId = queue.id.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
    const fnName = toPrefixedCamel('queue', queue.id);
    const events: any[] = [
      {
        http: {
          path: `queues/${queueFileId}/start`,
          method: 'POST',
          cors: true,
        },
      },
    ];
    if (queue.schedule) {
      events.push(...processScheduleEvents(queue.schedule));
    }
    functions[fnName] = {
      handler: `handlers/queues/${queueFileId}.handler`,
      timeout: 60,
      memorySize: 128,
      events,
    };
  }
  }

  // Filter env vars - only include safe ones (exclude secrets that should be in AWS Secrets Manager)
  const safeEnvVars: Record<string, string> = {};
  const allowedPrefixes = ['OPENAI_', 'ANTHROPIC_', 'DATABASE_', 'MONGODB_', 'REDIS_', 'UPSTASH_', 'WORKER_', 'WORKERS_', 'WORKFLOW_', 'REMOTION_', 'QUEUE_JOB_', 'DEBUG_WORKER_QUEUES'];

  // AWS_ prefix is reserved by Lambda, do not include it in environment variables
  // https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html

  for (const [key, value] of Object.entries(envVars)) {
    if (allowedPrefixes.some(prefix => key.startsWith(prefix))) {
      safeEnvVars[key] = value;
    }
  }

  // ApiEndpoints output only when this stack has HTTP (core/single-group). Non-core groups have no ApiGatewayRestApi.
  if (!userGroupOnly) {
    resources.Outputs['ApiEndpoints'] = {
      Description: "API Endpoints",
      Value: {
        "Fn::Join": [
          "",
          [
            "API: https://",
            { "Ref": "ApiGatewayRestApi" },
            ".execute-api.",
            { "Ref": "AWS::Region" },
            `.amazonaws.com/\${env:ENVIRONMENT, '${stage}'}`
          ]
        ]
      }
    };
  }

  const patterns = getPackagePatterns(microfoxConfig, externalPackages.length > 0 ? externalPackages : DEFAULT_EXTERNAL_PACKAGES, optionsGroup);

  return {
    service: serviceName,
    package: {
      excludeDevDependencies: true,
      individually: true,
      patterns,
    },
    custom: customConfig,
    provider: {
      name: 'aws',
      runtime: 'nodejs20.x',
      region,
      versionFunctions: false,
      // Use ENVIRONMENT from env.json to drive the actual deployed stage (Microfox defaults to prod).
      stage: `\${env:ENVIRONMENT, '${stage}'}`,
      environment: '\${file(env.json)}',
      iam: {
        role: {
          statements: [
            {
              Effect: 'Allow',
              Action: [
                'sqs:SendMessage',
                'sqs:ReceiveMessage',
                'sqs:DeleteMessage',
                'sqs:GetQueueAttributes',
              ],
              Resource: queueArns,
            },
            ...(crossGroupArnPatterns.length > 0
              ? [{ Effect: 'Allow', Action: ['sqs:SendMessage'], Resource: crossGroupArnPatterns }]
              : []),
            {
              Effect: 'Allow',
              Action: ['sqs:GetQueueUrl'],
              // GetQueueUrl is not resource-scoped for unknown queue ARNs, must be '*'
              Resource: '*',
            }
          ],
        },
      },
    },
    plugins: ['serverless-offline'],
    functions,
    resources,
  };
}

/**
 * Generates serverless.yml for the core group only: trigger, workers-config, docs, queue starters.
 * No worker Lambdas or worker SQS. Env + IAM for all workers in all groups (convention-based queue URLs).
 */
function generateServerlessConfigCore(
  projectId: string,
  allWorkersByGroup: Map<string, WorkerInfo[]>,
  queues: QueueInfo[],
  stage: string,
  region: string,
  envVars: Record<string, string>,
  serviceName: string,
  externalPackages: string[] = [],
  microfoxConfig: Record<string, any> | null = null
): ServerlessConfig {
  const allWorkers = Array.from(allWorkersByGroup.values()).flat();
  const allGroups = Array.from(allWorkersByGroup.keys()).sort();

  const queueUrlEnv: Record<string, string> = {};
  for (const w of allWorkers) {
    const svc = getServiceNameFromProjectId(projectId, w.group);
    const queueNamePart = `${svc}-${w.id}`;
    const url = `https://sqs.\${aws:region}.amazonaws.com/\${aws:accountId}/${queueNamePart}-\${opt:stage, env:ENVIRONMENT, '${stage}'}`;
    queueUrlEnv[`WORKER_QUEUE_URL_${sanitizeWorkerIdForEnv(w.id)}`] = url;
  }

  const queueArnPatterns: string[] = allGroups.map((g) => {
    const svc = getServiceNameFromProjectId(projectId, g);
    return `arn:aws:sqs:\${aws:region}:\${aws:accountId}:${svc}-*`;
  });

  const customConfig: Record<string, any> = {
    stage: `\${env:ENVIRONMENT, '${stage}'}`,
    'serverless-offline': {
      httpPort: 4000,
      lambdaPort: 4002,
      useChildProcesses: true,
      useWorkerThreads: true,
      noCookieValidation: true,
      allowCache: true,
      hideStackTraces: false,
      disableCookieValidation: true,
      noTimeout: true,
      environment: '\${file(env.json)}',
    },
  };

  const functions: Record<string, any> = {};
  functions['getDocs'] = {
    handler: 'handlers/api/docs.handler',
    events: [{ http: { path: '/docs.json', method: 'GET', cors: true } }],
  };
  functions['triggerWorker'] = {
    handler: 'handlers/api/workers-trigger.handler',
    events: [{ http: { path: '/workers/trigger', method: 'POST', cors: true } }],
    environment: queueUrlEnv,
  };
  functions['workersConfig'] = {
    handler: 'handlers/api/workers-config.handler',
    events: [{ http: { path: 'workers/config', method: 'GET', cors: true } }],
    environment: queueUrlEnv,
  };
  for (const queue of queues) {
    const queueFileId = queue.id.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
    const fnName = toPrefixedCamel('queue', queue.id);
    const events: any[] = [{ http: { path: `queues/${queueFileId}/start`, method: 'POST', cors: true } }];
    if (queue.schedule) {
      events.push(...processScheduleEvents(queue.schedule));
    }
    functions[fnName] = {
      handler: `handlers/queues/${queueFileId}.handler`,
      timeout: 60,
      memorySize: 128,
      events,
      environment: queueUrlEnv,
    };
  }

  const allowedPrefixes = ['OPENAI_', 'ANTHROPIC_', 'DATABASE_', 'MONGODB_', 'REDIS_', 'UPSTASH_', 'WORKER_', 'WORKERS_', 'WORKFLOW_', 'REMOTION_', 'QUEUE_JOB_', 'DEBUG_WORKER_QUEUES'];
  const safeEnvVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(envVars)) {
    if (allowedPrefixes.some((prefix) => key.startsWith(prefix))) {
      safeEnvVars[key] = value;
    }
  }

  const corePatterns = getPackagePatterns(microfoxConfig, externalPackages.length > 0 ? externalPackages : DEFAULT_EXTERNAL_PACKAGES, 'core');

  return {
    service: serviceName,
    package: {
      excludeDevDependencies: true,
      individually: true,
      patterns: corePatterns,
    },
    custom: customConfig,
    provider: {
      name: 'aws',
      runtime: 'nodejs20.x',
      region,
      versionFunctions: false,
      stage: `\${env:ENVIRONMENT, '${stage}'}`,
      environment: '\${file(env.json)}',
      iam: {
        role: {
          statements: [
            {
              Effect: 'Allow',
              Action: ['sqs:SendMessage', 'sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
              Resource: queueArnPatterns,
            },
            { Effect: 'Allow', Action: ['sqs:GetQueueUrl'], Resource: '*' },
          ],
        },
      },
    },
    plugins: ['serverless-offline'],
    functions,
    resources: {
      Resources: {},
      Outputs: {
        ApiEndpoints: {
          Description: 'API Endpoints',
          Value: {
            'Fn::Join': [
              '',
              ['API: https://', { Ref: 'ApiGatewayRestApi' }, '.execute-api.', { Ref: 'AWS::Region' }, `.amazonaws.com/\${env:ENVIRONMENT, '${stage}'}`],
            ],
          },
        },
      },
    },
  };
}

/**
 * Resolves queue URLs after deployment and generates workers-map.generated.ts
 */
async function generateWorkersMap(
  stage: string,
  region: string,
  outputDir: string
): Promise<void> {
  const serverlessDir = path.join(outputDir, '.serverless');
  if (!fs.existsSync(serverlessDir)) {
    fs.mkdirSync(serverlessDir, { recursive: true });
  }

  // Need to scan workers again to get IDs for map generation
  // Or we could save this metadata in the build step.
  // For now, re-scanning is fine.
  const workers = await scanWorkers();

  // Try to read CloudFormation outputs
  const stackName = `ai-router-workers-${stage}-${stage}`;
  let queueUrls: Record<string, { queueUrl: string; region: string }> = {};

  const spinner = ora('Fetching CloudFormation outputs...').start();

  try {
    // Use AWS CLI to get stack outputs
    const output = execSync(
      `aws cloudformation describe-stacks --stack-name ${stackName} --region ${region} --query "Stacks[0].Outputs" --output json`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );

    const outputs = JSON.parse(output);
    const outputMap: Record<string, string> = {};

    for (const output of outputs) {
      const key = output.OutputKey;
      if (key && key.endsWith('Url')) {
        const workerId = key.replace('WorkerQueue', '').replace('Url', '').toLowerCase();
        // The workerId from CF output might have stripped characters, need fuzzy match or consistent naming
        // Currently we use replace(/[^a-zA-Z0-9]/g, '') in CF output name
        outputMap[key] = output.OutputValue;
      }
    }

    // Match workers to queue URLs
    for (const worker of workers) {
      const sanitizedId = worker.id.replace(/[^a-zA-Z0-9]/g, '');
      const queueKey = `WorkerQueue${sanitizedId}${stage}Url`;

      // Look for key ending with this pattern to handle casing issues if any
      const matchingKey = Object.keys(outputMap).find(k => k.toLowerCase() === queueKey.toLowerCase());

      if (matchingKey && outputMap[matchingKey]) {
        queueUrls[worker.id] = {
          queueUrl: outputMap[matchingKey],
          region,
        };
      }
    }
    spinner.succeed('Fetched CloudFormation outputs');
  } catch (error) {
    spinner.warn('Could not fetch CloudFormation outputs. Using deterministic queue URLs.');
    for (const worker of workers) {
      queueUrls[worker.id] = {
        queueUrl: `https://sqs.${'${aws:region}'}.amazonaws.com/${'${aws:accountId}'}/${'${self:service}'}-${worker.id}-${stage}`,
        region,
      };
    }
  }

  // Generate TypeScript file
  const mapContent = `/**
 * Auto-generated workers map
 * DO NOT EDIT - This file is generated by deploy-workers script
 */

export const workersMap = ${JSON.stringify(queueUrls, null, 2)} as const;
`;

  const mapFile = path.join(serverlessDir, 'workers-map.generated.ts');
  fs.writeFileSync(mapFile, mapContent);
  console.log(chalk.green(`✓ Generated workers map: ${mapFile}`));
}

async function build(args: any) {
  const stage = args.stage || process.env.STAGE || 'prod';
  const region = args.region || process.env.AWS_REGION || 'us-east-1';
  const aiPath = args['ai-path'] || 'app/ai';

  console.log(chalk.blue(`📦 Building workers (stage: ${stage}, region: ${region})...`));

  const spinner = ora('Scanning workers...').start();
  const workers = await scanWorkers(aiPath);

  if (workers.length === 0) {
    spinner.warn('No workers found.');
    return;
  }
  spinner.succeed(`Found ${workers.length} worker(s)`);
  workers.forEach(w => console.log(chalk.gray(`  - ${w.id} (${w.filePath})`)));

  const serverlessDir = path.join(process.cwd(), '.serverless-workers');
  // Clean .serverless-workers contents but keep node_modules for faster rebuilds.
  if (!fs.existsSync(serverlessDir)) {
    fs.mkdirSync(serverlessDir, { recursive: true });
  } else {
    const entries = fs.readdirSync(serverlessDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      if (entry.name === 'deployments.json') continue;
      const target = path.join(serverlessDir, entry.name);
      fs.rmSync(target, { recursive: true, force: true });
    }
  }

  // Build an accurate dependencies map for Microfox installs:
  // include any npm packages imported by the worker entrypoints (and their local imports),
  // plus runtime packages used by generated handlers.
  // Job store backend is conditional on WORKER_DATABASE_TYPE; include only that backend (+ mongodb if user code uses it).
  const runtimeDeps = await collectRuntimeDependenciesForWorkers(
    workers.map((w) => w.filePath),
    process.cwd()
  );
  const jobStoreType = getJobStoreType();
  const filteredDeps = filterDepsForJobStore(runtimeDeps, jobStoreType);
  const dependencies = buildDependenciesMap(process.cwd(), filteredDeps);

  // Generate package.json for the serverless service (used by Microfox push)
  const packageJson = {
    name: 'ai-router-workers',
    version: '1.0.0',
    description: 'Auto-generated serverless workers',
    private: true,
    dependencies,
    scripts: {
      build: "echo 'Already compiled.'",
    },
    devDependencies: {
      serverless: '^3.38.0',
      'serverless-offline': '^13.3.3',
      '@aws-sdk/client-sqs': '^3.700.0',
    },
  };
  fs.writeFileSync(
    path.join(serverlessDir, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );

  // No tsconfig.json needed as we are deploying bundled JS

  const envVars = loadEnvVars();

  // Detect env usage from worker entry files + their local dependency graph.
  // We use this to populate env.json with only envs that are actually referenced,
  // but ONLY if they exist in .env (we don't invent values).
  const workerEntryFiles = workers.map((w) => w.filePath);
  const { runtimeKeys: runtimeEnvKeys, buildtimeKeys: buildtimeEnvKeys } =
    await collectEnvUsageForWorkers(workerEntryFiles, process.cwd());
  const referencedEnvKeys = new Set<string>([
    ...Array.from(runtimeEnvKeys),
    ...Array.from(buildtimeEnvKeys),
  ]);

  // Light, helpful logging (avoid noisy huge dumps)
  const runtimeList = Array.from(runtimeEnvKeys).sort();
  const buildtimeList = Array.from(buildtimeEnvKeys).sort();
  const missingFromDotEnv = Array.from(referencedEnvKeys)
    .filter((k) => !(k in envVars))
    .sort();
  if (runtimeList.length || buildtimeList.length) {
    console.log(
      chalk.blue(
        `ℹ️  Detected env usage from worker code: runtime=${runtimeList.length}, buildtime=${buildtimeList.length}`
      )
    );
    if (missingFromDotEnv.length > 0) {
      console.log(
        chalk.yellow(
          `⚠️  These referenced envs were not found in .env (so they will NOT be written to env.json): ${missingFromDotEnv
            .slice(0, 25)
            .join(', ')}${missingFromDotEnv.length > 25 ? ' ...' : ''}`
        )
      );
    }
  }

  let serviceName = (args['service-name'] as string | undefined)?.trim() || `ai-router-workers-${stage}`;
  let externalPackages = getExternalPackages(null);
  let microfoxConfig: Record<string, any> | null = null;

  // Check for microfox.json to customize service name and external packages
  const microfoxJsonPath = path.join(process.cwd(), 'microfox.json');
  if (fs.existsSync(microfoxJsonPath)) {
    try {
      microfoxConfig = JSON.parse(fs.readFileSync(microfoxJsonPath, 'utf-8'));
      externalPackages = getExternalPackages(microfoxConfig);
      if (microfoxConfig.projectId) {
        // Only override if user did not explicitly provide a service name
        if (!(args['service-name'] as string | undefined)?.trim()) {
          serviceName = getServiceNameFromProjectId(microfoxConfig.projectId);
        }
        console.log(chalk.blue(`ℹ️  Using service name from microfox.json: ${serviceName}`));
      }
    } catch (error) {
      console.warn(chalk.yellow('⚠️  Failed to parse microfox.json, using default service name'));
    }
  }

  const queues = await scanQueues(aiPath);
  if (queues.length > 0) {
    console.log(chalk.blue(`ℹ️  Found ${queues.length} queue(s): ${queues.map((q) => q.id).join(', ')}`));
    generateQueueRegistry(queues, serverlessDir, process.cwd());
  }

  ora('Generating handlers...').start().succeed('Generated handlers');
  await generateHandlers(workers, serverlessDir, queues, externalPackages);

  // Now import the bundled handlers to extract workerConfig
  const extractSpinner = ora('Extracting worker configs from bundled handlers...').start();
  for (const worker of workers) {
    try {
      const handlerFile = path.join(serverlessDir, worker.handlerPath + '.js');
      if (fs.existsSync(handlerFile)) {
        // Convert absolute path to file:// URL for ESM import (required on Windows)
        const handlerUrl = pathToFileURL(path.resolve(handlerFile)).href;

        try {
          // Import the bundled handler (which exports exportedWorkerConfig)
          // Note: The handler might have runtime errors, but we only need the exportedWorkerConfig
          const module = await import(handlerUrl);

          // exportedWorkerConfig is exported directly from the handler file
          if (module.exportedWorkerConfig) {
            worker.workerConfig = module.exportedWorkerConfig;
            if (module.exportedWorkerConfig.group != null) {
              worker.group = module.exportedWorkerConfig.group;
            }
            if (module.exportedWorkerConfig.layers?.length) {
              console.log(chalk.gray(`  ✓ ${worker.id}: found ${module.exportedWorkerConfig.layers.length} layer(s)`));
            }
          } else {
            worker.workerConfig = worker.workerConfig ?? { timeout: 300, memorySize: 512 };
            console.log(chalk.gray(`  ℹ ${worker.id}: using default config (exportedWorkerConfig not in bundle)`));
          }
        } catch (importError: any) {
          // If import fails due to runtime errors (e.g., lazy-cache initialization in bundled code),
          // try to extract config from source file as fallback. This is expected for some bundled handlers.
          // The fallback will work fine, and the Lambda runtime will handle the bundled code correctly.
          console.log(chalk.gray(`  ℹ ${worker.id}: extracting config from source (import failed: ${importError?.message?.slice(0, 50) || 'runtime error'}...)`));

          // Fallback: try to read the source worker file and extract workerConfig
          try {
            const sourceContent = fs.readFileSync(worker.filePath, 'utf-8');
            // Look for exported workerConfig
            const workerConfigMatch = sourceContent.match(/export\s+const\s+workerConfig[^=]*=\s*(\{[\s\S]*?\});/);
            if (workerConfigMatch) {
              // Try to parse it as JSON (after cleaning up comments)
              let configStr = workerConfigMatch[1]
                .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
                .replace(/(^|\s)\/\/[^\n]*/gm, '$1'); // Remove line comments

              // Use Function constructor to parse the object (safer than eval)
              const configObj = new Function('return ' + configStr)();
              if (configObj && (configObj.layers || configObj.timeout || configObj.memorySize || configObj.schedule || configObj.group != null)) {
                worker.workerConfig = configObj;
                if (configObj.group != null) {
                  worker.group = configObj.group;
                }
                if (configObj.layers?.length) {
                  console.log(chalk.gray(`  ✓ ${worker.id}: found ${configObj.layers.length} layer(s) from source file`));
                }
                if (configObj.schedule) {
                  console.log(chalk.gray(`  ✓ ${worker.id}: found schedule configuration`));
                }
              }
            }
          } catch (fallbackError) {
            // If fallback also fails, apply defaults
            worker.workerConfig = worker.workerConfig ?? { timeout: 300, memorySize: 512 };
            console.log(chalk.gray(`  ℹ ${worker.id}: using default config (fallback extraction failed)`));
          }
        }
      } else {
        worker.workerConfig = worker.workerConfig ?? { timeout: 300, memorySize: 512 };
        console.warn(chalk.yellow(`  ⚠ ${worker.id}: handler file not found: ${handlerFile}, using defaults`));
      }
      // Ensure every worker has a config (defaults if still missing)
      if (!worker.workerConfig) {
        worker.workerConfig = { timeout: 300, memorySize: 512 };
        console.log(chalk.gray(`  ℹ ${worker.id}: using default config`));
      }
    } catch (error: any) {
      worker.workerConfig = worker.workerConfig ?? { timeout: 300, memorySize: 512 };
      console.warn(chalk.yellow(`  ⚠ ${worker.id}: failed to extract config: ${error?.message || error}, using defaults`));
    }
  }
  extractSpinner.succeed('Extracted configs');

  validateGroupNames(workers);

  const userGroups = [...new Set(workers.map((w) => w.group))].sort((a, b) =>
    a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b)
  );
  const isMultiGroup = userGroups.length > 1;
  let projectId: string | undefined;
  if (fs.existsSync(microfoxJsonPath)) {
    try {
      const microfoxConfig = JSON.parse(fs.readFileSync(microfoxJsonPath, 'utf-8'));
      projectId = microfoxConfig.projectId;
    } catch {}
  }

  if (isMultiGroup) {
    if (!projectId) {
      console.error(chalk.red('❌ Multi-group build requires projectId in microfox.json'));
      process.exit(1);
    }
    const allWorkersByGroup = new Map<string, WorkerInfo[]>();
    for (const g of userGroups) {
      allWorkersByGroup.set(g, workers.filter((w) => w.group === g));
    }
    const allowedPrefixes = ['OPENAI_', 'ANTHROPIC_', 'DATABASE_', 'MONGODB_', 'REDIS_', 'UPSTASH_', 'WORKER_', 'WORKERS_', 'WORKFLOW_', 'REMOTION_', 'QUEUE_JOB_', 'DEBUG_WORKER_QUEUES'];

    const coreDir = path.join(serverlessDir, 'core');
    fs.mkdirSync(coreDir, { recursive: true });
    // Core: minimal deps (no user workers; only job store + devDeps for serverless tooling)
    const coreFilteredDeps = filterDepsForJobStore(new Set(), jobStoreType);
    const coreDependencies = buildDependenciesMap(process.cwd(), coreFilteredDeps);
    const packageJsonCore = {
      name: 'ai-router-workers',
      version: '1.0.0',
      description: 'Auto-generated serverless workers (core)',
      private: true,
      dependencies: coreDependencies,
      scripts: { build: "echo 'Already compiled.'" },
      devDependencies: {
        serverless: '^3.38.0',
        'serverless-offline': '^13.3.3',
        '@aws-sdk/client-sqs': '^3.700.0',
      },
    };
    fs.writeFileSync(path.join(coreDir, 'package.json'), JSON.stringify(packageJsonCore, null, 2));
    if (fs.existsSync(microfoxJsonPath)) {
      fs.copyFileSync(microfoxJsonPath, path.join(coreDir, 'microfox.json'));
    }
    generateQueueRegistry(queues, coreDir, process.cwd());
    const serviceNameCore = getServiceNameFromProjectId(projectId, 'core');
    const coreExternalPackages = getExternalPackages(microfoxConfig, 'core');
    generateWorkersConfigHandler(coreDir, workers, serviceNameCore, queues, coreExternalPackages);
    generateDocsHandler(coreDir, serviceNameCore, stage, region, coreExternalPackages);
    generateTriggerHandler(coreDir, serviceNameCore, coreExternalPackages);
    for (const queue of queues) {
      generateQueueHandler(coreDir, queue, serviceNameCore, coreExternalPackages);
    }
    const configCore = generateServerlessConfigCore(projectId, allWorkersByGroup, queues, stage, region, envVars, serviceNameCore, coreExternalPackages, microfoxConfig);
    fs.writeFileSync(path.join(coreDir, 'serverless.yml'), yaml.dump(configCore, { lineWidth: -1 }));
    const safeEnv: Record<string, string> = { ENVIRONMENT: 'prod', STAGE: 'prod', NODE_ENV: 'prod' };
    for (const [k, v] of Object.entries(envVars)) {
      if (allowedPrefixes.some((p) => k.startsWith(p))) safeEnv[k] = v;
    }
    fs.writeFileSync(path.join(coreDir, 'env.json'), JSON.stringify(safeEnv, null, 2));

    for (const g of userGroups) {
      const groupDir = path.join(serverlessDir, g);
      fs.mkdirSync(groupDir, { recursive: true });
      const workersForGroup = allWorkersByGroup.get(g)!;
      // Per-group deps: only what this group's workers need
      const runtimeDepsGroup = await collectRuntimeDependenciesForWorkers(
        workersForGroup.map((w) => w.filePath),
        process.cwd()
      );
      const filteredDepsGroup = filterDepsForJobStore(runtimeDepsGroup, jobStoreType);
      const dependenciesGroup = buildDependenciesMap(process.cwd(), filteredDepsGroup);
      const packageJsonGroup = {
        name: 'ai-router-workers',
        version: '1.0.0',
        description: `Auto-generated serverless workers (${g})`,
        private: true,
        dependencies: dependenciesGroup,
        scripts: { build: "echo 'Already compiled.'" },
        devDependencies: {
          serverless: '^3.38.0',
          'serverless-offline': '^13.3.3',
          '@aws-sdk/client-sqs': '^3.700.0',
        },
      };
      fs.writeFileSync(path.join(groupDir, 'package.json'), JSON.stringify(packageJsonGroup, null, 2));
      if (fs.existsSync(microfoxJsonPath)) {
        fs.copyFileSync(microfoxJsonPath, path.join(groupDir, 'microfox.json'));
      }
      for (const w of workersForGroup) {
        const src = path.join(serverlessDir, w.handlerPath + '.js');
        const dest = path.join(groupDir, w.handlerPath + '.js');
        if (fs.existsSync(src)) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
        }
      }
      const serviceNameGroup = getServiceNameFromProjectId(projectId, g);
      let calleeIdsGroup = await collectCalleeWorkerIds(workersForGroup, process.cwd());
      calleeIdsGroup = mergeQueueCallees(calleeIdsGroup, queues, workers);
      const configUser = generateServerlessConfig(workersForGroup, stage, region, envVars, serviceNameGroup, calleeIdsGroup, [], {
        userGroupOnly: true,
        projectId,
        allWorkers: workers,
        externalPackages: getExternalPackages(microfoxConfig, g),
        microfoxConfig,
        group: g,
      });
      fs.writeFileSync(path.join(groupDir, 'serverless.yml'), yaml.dump(configUser, { lineWidth: -1 }));
      // Per-group env: only keys referenced by this group's workers + allowedPrefixes
      const { runtimeKeys: runtimeEnvKeysGroup, buildtimeKeys: buildtimeEnvKeysGroup } =
        await collectEnvUsageForWorkers(workersForGroup.map((w) => w.filePath), process.cwd());
      const referencedEnvKeysGroup = new Set<string>([
        ...Array.from(runtimeEnvKeysGroup),
        ...Array.from(buildtimeEnvKeysGroup),
      ]);
      const safeEnvGroup: Record<string, string> = { ENVIRONMENT: 'prod', STAGE: 'prod', NODE_ENV: 'prod' };
      for (const [k, v] of Object.entries(envVars)) {
        if (k.startsWith('AWS_')) continue;
        if (allowedPrefixes.some((p) => k.startsWith(p)) || referencedEnvKeysGroup.has(k)) safeEnvGroup[k] = v;
      }
      fs.writeFileSync(path.join(groupDir, 'env.json'), JSON.stringify(safeEnvGroup, null, 2));
    }

    // In multi-group layout we only want handlers/generated inside per-group dirs.
    // Root-level handlers/ and generated/ were used as a build staging area; clean them up now.
    const rootHandlersDir = path.join(serverlessDir, 'handlers');
    const rootGeneratedDir = path.join(serverlessDir, 'generated');
    try {
      if (fs.existsSync(rootHandlersDir)) {
        fs.rmSync(rootHandlersDir, { recursive: true, force: true });
      }
      if (fs.existsSync(rootGeneratedDir)) {
        fs.rmSync(rootGeneratedDir, { recursive: true, force: true });
      }
    } catch {
      // Best-effort cleanup; ignore failures so build doesn't break.
    }

    console.log(chalk.green(`✓ Multi-group build: core + ${userGroups.join(', ')}`));
    return;
  }

  generateWorkersConfigHandler(serverlessDir, workers, serviceName, queues, externalPackages);
  generateDocsHandler(serverlessDir, serviceName, stage, region, externalPackages);
  generateTriggerHandler(serverlessDir, serviceName, externalPackages);

  for (const queue of queues) {
    generateQueueHandler(serverlessDir, queue, serviceName, externalPackages);
  }

  let calleeIds = await collectCalleeWorkerIds(workers, process.cwd());
  calleeIds = mergeQueueCallees(calleeIds, queues, workers);
  const config = generateServerlessConfig(workers, stage, region, envVars, serviceName, calleeIds, queues, { externalPackages, microfoxConfig });

  // Always generate env.json now as serverless.yml relies on it.
  // Microfox deploys APIs on prod by default; when microfox.json exists, default ENVIRONMENT/STAGE to "prod".
  const envStage = fs.existsSync(microfoxJsonPath) ? 'prod' : stage;
  const safeEnvVars: Record<string, string> = {
    ENVIRONMENT: envStage,
    STAGE: envStage,
    NODE_ENV: envStage,
  };
  const allowedPrefixes = ['OPENAI_', 'ANTHROPIC_', 'DATABASE_', 'MONGODB_', 'REDIS_', 'UPSTASH_', 'WORKER_', 'WORKERS_', 'WORKFLOW_', 'REMOTION_', 'QUEUE_JOB_', 'DEBUG_WORKER_QUEUES'];

  for (const [key, value] of Object.entries(envVars)) {
    // AWS_ prefix is reserved by Lambda, do not include it in environment variables
    // https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html
    if (key.startsWith('AWS_')) continue;

    // Keep legacy behavior for known-safe prefixes,
    // and also include any env that is referenced by worker code.
    if (allowedPrefixes.some((prefix) => key.startsWith(prefix)) || referencedEnvKeys.has(key)) {
      safeEnvVars[key] = value;
    }
  }

  fs.writeFileSync(
    path.join(serverlessDir, 'env.json'),
    JSON.stringify(safeEnvVars, null, 2)
  );

  const yamlContent = yaml.dump(config, { indent: 2 });
  const yamlPath = path.join(serverlessDir, 'serverless.yml');
  fs.writeFileSync(yamlPath, yamlContent);
  console.log(chalk.green(`✓ Generated serverless.yml: ${yamlPath}`));
}

async function deploy(args: any) {
  const stage = args.stage || process.env.STAGE || 'prod';
  const region = args.region || process.env.AWS_REGION || 'us-east-1';
  // Commander passes option names as camelCase (e.g. skipDeploy, skipInstall)
  const skipDeploy = args.skipDeploy ?? args['skip-deploy'] ?? false;
  const skipInstall = args.skipInstall ?? args['skip-install'] ?? false;

  if (skipDeploy) {
    console.log(chalk.yellow('⏭️  Skipping deployment (--skip-deploy flag)'));
    return;
  }

  const serverlessDir = path.join(process.cwd(), '.serverless-workers');
  const yamlPath = path.join(serverlessDir, 'serverless.yml');
  const hasPerGroupLayout = fs.existsSync(path.join(serverlessDir, 'core', 'serverless.yml'));

  if (!fs.existsSync(yamlPath) && !hasPerGroupLayout) {
    console.error(chalk.red('❌ serverless.yml not found. Run "build" first.'));
    process.exit(1);
  }

  console.log(chalk.blue(`🚀 Deploying to AWS (stage: ${stage}, region: ${region})...`));
  validateEnvironment();

  try {
    // Install dependencies in the serverless directory if node_modules doesn't exist
    // Skip if --skip-install is provided
    if (!skipInstall && !fs.existsSync(path.join(serverlessDir, 'node_modules'))) {
      console.log(chalk.blue('📦 Installing serverless dependencies...'));
      execSync('npm install', {
        cwd: serverlessDir,
        stdio: 'inherit'
      });
    }

    // Check for microfox.json in project root
    const microfoxJsonPath = path.join(process.cwd(), 'microfox.json');
    if (fs.existsSync(microfoxJsonPath)) {
      console.log(chalk.blue('ℹ️  Found microfox.json, deploying via Microfox Cloud...'));

      // Copy microfox.json to .serverless-workers directory (required for Microfox CLI to detect per-group layout)
      try {
        fs.copyFileSync(microfoxJsonPath, path.join(serverlessDir, 'microfox.json'));
      } catch {}

      const skipCore = args.skipCore ?? args['skip-core'] ?? false;
      const hasPerGroupDirs = fs.existsSync(path.join(serverlessDir, 'core', 'serverless.yml'));
      const pushArgs = ['microfox@latest', 'push'];
      if (hasPerGroupDirs && skipCore) {
        pushArgs.push('--skip-group', 'core');
        console.log(chalk.blue('ℹ️  Skipping core group (--skip-core)'));
      }

      execSync('npx ' + pushArgs.join(' '), {
        cwd: serverlessDir,
        stdio: 'inherit'
      });
      console.log(chalk.green('✓ Deployment triggered via Microfox!'));
      // We don't generate workers map for Microfox push as it handles its own routing
      return;
    }

    execSync('npx serverless deploy', {
      cwd: serverlessDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        STAGE: stage,
        AWS_REGION: region,
      },
    });
    console.log(chalk.green('✓ Deployment complete!'));
  } catch (error) {
    console.error(chalk.red('❌ Deployment failed'));
    process.exit(1);
  }

  await generateWorkersMap(stage, region, serverlessDir);
}

export const pushCommand = new Command()
  .name('push')
  .description('Build and deploy background workers to AWS')
  .option('-s, --stage <stage>', 'Deployment stage', 'prod')
  .option('-r, --region <region>', 'AWS region', 'us-east-1')
  .option('--ai-path <path>', 'Path to AI directory containing workers', 'app/ai')
  .option('--service-name <name>', 'Override serverless service name (defaults to ai-router-workers-<stage>)')
  .option('--skip-deploy', 'Skip deployment, only build', false)
  .option('--skip-install', 'Skip npm install in serverless directory', false)
  .option('--skip-core', 'When deploying via Microfox, skip deploying the core group', false)
  .action(async (options) => {
    await build(options);
    await deploy(options);
  });

