import { Command } from 'commander';
import * as esbuild from 'esbuild';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { builtinModules, createRequire } from 'module';
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

export async function collectEnvUsageForWorkers(
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

type MicrofoxConfigSource = 'microfox.json' | 'microfox.config.ts';

interface ResolvedMicrofoxConfig {
  source: MicrofoxConfigSource;
  config: Record<string, any>;
}

function sanitizeMicrofoxConfig(raw: unknown): Record<string, any> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let cloned: Record<string, any>;
  try {
    cloned = JSON.parse(JSON.stringify(raw));
  } catch {
    return null;
  }
  const envProjectId = process.env.MICROFOX_PROJECT_ID?.trim();
  if (!cloned.projectId && envProjectId) {
    cloned.projectId = envProjectId;
  }
  return cloned;
}

function getMicrofoxConfigFromStudioConfig(studioConfig: any): Record<string, any> | null {
  const workflowSettings = studioConfig?.workflowSettings;
  const candidates: unknown[] = [
    workflowSettings?.deploymentConfig,
    workflowSettings?.deploymentConfigs,
    workflowSettings?.microfoxConfig,
    workflowSettings?.microfox,
  ];

  for (const candidate of candidates) {
    const sanitized = sanitizeMicrofoxConfig(candidate);
    if (sanitized) return sanitized;
  }

  // Allow a projectId-only setup from workflowSettings + env.
  const projectId =
    (typeof workflowSettings?.projectId === 'string' && workflowSettings.projectId.trim()) ||
    process.env.MICROFOX_PROJECT_ID?.trim();
  if (projectId) {
    return { projectId };
  }
  return null;
}

function loadStudioConfigFromTs(projectRoot: string): any | null {
  const configPath = path.join(projectRoot, 'microfox.config.ts');
  if (!fs.existsSync(configPath)) return null;

  try {
    const source = fs.readFileSync(configPath, 'utf-8');
    const transformed = esbuild.transformSync(source, {
      loader: 'ts',
      format: 'cjs',
      platform: 'node',
      target: 'node18',
      sourcemap: false,
    });
    const moduleRef: { exports: any } = { exports: {} };
    const projectRequire = createRequire(pathToFileURL(configPath).href);
    const evaluator = new Function(
      'exports',
      'require',
      'module',
      '__filename',
      '__dirname',
      'process',
      transformed.code
    );
    evaluator(
      moduleRef.exports,
      projectRequire,
      moduleRef,
      configPath,
      path.dirname(configPath),
      process
    );

    const exported = moduleRef.exports;
    return exported?.StudioConfig ?? exported?.default?.StudioConfig ?? exported?.default ?? null;
  } catch (error) {
    console.warn(
      chalk.yellow(
        `⚠️  Failed to load microfox.config.ts (${error instanceof Error ? error.message : String(error)})`
      )
    );
    return null;
  }
}

function resolveMicrofoxConfig(projectRoot: string): ResolvedMicrofoxConfig | null {
  const microfoxJsonPath = path.join(projectRoot, 'microfox.json');
  if (fs.existsSync(microfoxJsonPath)) {
    const raw = readJsonFile<Record<string, any>>(microfoxJsonPath);
    if (raw) {
      const sanitized = sanitizeMicrofoxConfig(raw);
      if (sanitized) {
        return { source: 'microfox.json', config: sanitized };
      }
    } else {
      console.warn(chalk.yellow('⚠️  Failed to parse microfox.json, checking microfox.config.ts fallback'));
    }
  }

  const studioConfig = loadStudioConfigFromTs(projectRoot);
  const fromStudio = getMicrofoxConfigFromStudioConfig(studioConfig);
  if (fromStudio) {
    return { source: 'microfox.config.ts', config: fromStudio };
  }
  return null;
}

function writeMicrofoxJson(targetPath: string, config: Record<string, any>): void {
  fs.writeFileSync(targetPath, JSON.stringify(config, null, 2));
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

export interface QueueStepInfo {
  workerId: string;
  delaySeconds?: number;
  requiresApproval?: boolean;
  /** True when the step has a `chain` function or built-in string (detected by scanner). */
  hasChain?: boolean;
  /** True when the step has a `resume` function (detected by scanner). */
  hasResume?: boolean;
  // HITL metadata is resolved from queue module default export at runtime.
  hitl?: unknown;
  /**
   * HITL reviewer input as JSON Schema (from defineHitlConfig.inputSchema, a Zod schema, converted
   * at build time). Embedded in /workers/config so the console can render + validate a generic
   * reviewer form. Undefined when the step has no HITL inputSchema (or extraction failed).
   */
  hitlInputSchema?: Record<string, any>;
  /** HITL reviewer form title (from defineHitlConfig.ui.title), for display. */
  hitlTitle?: string;
}

export interface QueueInfo {
  id: string;
  filePath: string;
  steps: QueueStepInfo[];
  schedule?: string | { rate: string; enabled?: boolean; input?: Record<string, any> };
}

export interface WorkerInfo {
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
  /** JSON Schema derived from the worker's inputSchema (zod) at build time. */
  inputSchema?: Record<string, any>;
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

/**
 * Derives a stable worker API key from a projectId. Must stay in sync with
 * `deriveWorkersApiKey` in `@microfox/ai-worker` (client.ts) so the deployed
 * Lambdas and the consuming app resolve the same value. The raw projectId is
 * never used as the header value — only this hash.
 */
function deriveWorkersApiKey(projectId: string): string {
  return crypto
    .createHash('sha256')
    .update('microfox-workers:' + projectId)
    .digest('hex');
}

export interface ResolvedWorkersApiKey {
  /** The unified key to enforce on /workers/trigger, /workers/config, /queues/{id}/start. */
  key: string;
  /** Where the key came from (for logging). */
  source: 'WORKERS_API_KEY' | 'projectId' | 'legacy';
  /**
   * Whether to write `WORKERS_API_KEY` into env.json. False for the legacy path,
   * where distinct WORKERS_TRIGGER_API_KEY / WORKERS_CONFIG_API_KEY are already
   * carried into env.json via the WORKERS_ prefix allowlist and must not be
   * overridden by a single unified key.
   */
  writeToEnv: boolean;
}

/**
 * Resolves the stable secret used to gate the generated worker endpoints (SEC-4 / Plan B).
 *
 * Precedence (first hit wins):
 *   1. WORKERS_API_KEY (unified, recommended) → enforce + write to env.json.
 *   2. legacy WORKERS_TRIGGER_API_KEY / WORKERS_CONFIG_API_KEY → enforce via those
 *      vars (handlers still read them); not overridden by a unified key.
 *   3. projectId (microfox.json / MICROFOX_PROJECT_ID) → sha256-derived key,
 *      written to env.json (zero-config path).
 *   4. nothing → null → public deploy (implicit --allow-public, with a warning).
 *
 * The source is stable across pushes, so re-pushing never rotates the secret.
 */
function resolveWorkersApiKey(
  microfoxConfig: Record<string, any> | null,
  env: Record<string, string>
): ResolvedWorkersApiKey | null {
  const pick = (k: string): string => (env[k] || process.env[k] || '').trim();

  const unified = pick('WORKERS_API_KEY');
  if (unified) return { key: unified, source: 'WORKERS_API_KEY', writeToEnv: true };

  const legacy = pick('WORKERS_TRIGGER_API_KEY') || pick('WORKERS_CONFIG_API_KEY');
  if (legacy) return { key: legacy, source: 'legacy', writeToEnv: false };

  const projectId =
    (microfoxConfig?.projectId && String(microfoxConfig.projectId).trim()) ||
    pick('MICROFOX_PROJECT_ID');
  if (projectId) {
    return { key: deriveWorkersApiKey(projectId), source: 'projectId', writeToEnv: true };
  }

  return null;
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
 * Scans for all *.worker.ts files in app/ai directory.
 */
export async function scanWorkers(aiPath: string = 'app/ai'): Promise<WorkerInfo[]> {
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
export async function scanQueues(aiPath: string = 'app/ai'): Promise<QueueInfo[]> {
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
      const stepsAnchor = content.match(/steps:\s*\[/);
      if (stepsAnchor && typeof stepsAnchor.index === 'number') {
        const openBracketIdx = content.indexOf('[', stepsAnchor.index);
        let stepsStr = '';
        if (openBracketIdx >= 0) {
          let bracketDepth = 0;
          let startContent = -1;
          let endContent = -1;
          for (let i = openBracketIdx; i < content.length; i++) {
            const ch = content[i];
            if (ch === '[') {
              bracketDepth += 1;
              if (bracketDepth === 1) {
                startContent = i + 1;
              }
            } else if (ch === ']') {
              bracketDepth = Math.max(0, bracketDepth - 1);
              if (bracketDepth === 0) {
                endContent = i;
                break;
              }
            }
          }
          if (startContent >= 0 && endContent > startContent) {
            stepsStr = content.slice(startContent, endContent);
          }
        }
        if (stepsStr.trim()) {
          // Parse top-level step objects so nested config blocks (e.g. hitl.ui)
          // do not break queue discovery.
          const topLevelStepObjects: string[] = [];
          let depth = 0;
          let start = -1;
          for (let i = 0; i < stepsStr.length; i++) {
            const ch = stepsStr[i];
            if (ch === '{') {
              if (depth === 0) start = i;
              depth += 1;
            } else if (ch === '}') {
              depth = Math.max(0, depth - 1);
              if (depth === 0 && start >= 0) {
                topLevelStepObjects.push(stepsStr.slice(start, i + 1));
                start = -1;
              }
            }
          }
          for (const stepObj of topLevelStepObjects) {
            const workerMatch = stepObj.match(/workerId:\s*['"]([^'"]+)['"]/);
            if (!workerMatch) continue;
            const delayMatch = stepObj.match(/delaySeconds:\s*(\d+)/);
            const approvalMatch = stepObj.match(/requiresApproval:\s*(true|false)/);
            // Detect presence of chain/resume/loop keys (function refs or built-in strings).
            const hasChain = /\bchain\s*:/.test(stepObj);
            const hasResume = /\bresume\s*:/.test(stepObj);
            const hasLoop = /\bloop\s*:/.test(stepObj);
            steps.push({
              workerId: workerMatch[1],
              delaySeconds: delayMatch ? parseInt(delayMatch[1], 10) : undefined,
              requiresApproval: approvalMatch ? approvalMatch[1] === 'true' : undefined,
              ...(hasChain ? { hasChain: true } : {}),
              ...(hasResume ? { hasResume: true } : {}),
              ...(hasLoop ? { hasLoop: true } : {}),
            });
          }
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
 * Imports queue modules so chain/resume function references can be called at runtime.
 */
function generateQueueRegistry(queues: QueueInfo[], outputDir: string, projectRoot: string): void {
  const generatedDir = path.join(outputDir, 'generated');
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }

  const relToRoot = path.relative(generatedDir, projectRoot).replace(/\\/g, '/');
  const queueModulesLines: string[] = [];
  const queueModulesEntries: string[] = [];
  // Import ALL queue modules so repeatStep-expanded steps are accessible at runtime.
  for (const q of queues) {
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
const {
  defaultMapChainPassthrough,
  defaultMapChainContinueFromPrevious,
} = require('@microfox/ai-worker');

${queueModulesBlock}

const QUEUES = ${JSON.stringify(queues.map((q) => ({ id: q.id, steps: q.steps, schedule: q.schedule })), null, 2)};

export function getQueueById(queueId) {
  return QUEUES.find((q) => q.id === queueId);
}

function resolveModuleStep(queueId, stepIndex) {
  const mod = queueModules[queueId];
  return mod && mod.default && Array.isArray(mod.default.steps)
    ? mod.default.steps[stepIndex]
    : undefined;
}

function resolveStepHitl(queueId, stepIndex, stepFromConfig) {
  const moduleStep = resolveModuleStep(queueId, stepIndex);
  const hitl = moduleStep && moduleStep.hitl != null ? moduleStep.hitl : stepFromConfig?.hitl;
  return hitl !== undefined ? hitl : undefined;
}

function getModuleStepCount(queueId) {
  const mod = queueModules[queueId];
  return (mod && mod.default && Array.isArray(mod.default.steps))
    ? mod.default.steps.length
    : 0;
}

function resolveStepData(queueId, stepIndex) {
  const queue = getQueueById(queueId);
  const staticStep = queue?.steps?.[stepIndex];
  const moduleStep = resolveModuleStep(queueId, stepIndex);
  if (!staticStep && !moduleStep) return undefined;
  const workerId = staticStep?.workerId ?? moduleStep?.workerId;
  if (!workerId) return undefined;
  const hitl = resolveStepHitl(queueId, stepIndex, staticStep);
  return {
    workerId,
    delaySeconds: staticStep?.delaySeconds ?? moduleStep?.delaySeconds,
    requiresApproval: staticStep?.requiresApproval ?? (moduleStep?.requiresApproval === true),
    hasChain: staticStep?.hasChain ?? (moduleStep?.chain !== undefined),
    hasResume: staticStep?.hasResume ?? (moduleStep?.resume !== undefined),
    hasLoop: staticStep?.hasLoop ?? (moduleStep?.loop !== undefined),
    ...(hitl !== undefined ? { hitl } : {}),
  };
}

export function getNextStep(queueId, stepIndex) {
  const queue = getQueueById(queueId);
  const staticCount = queue?.steps?.length ?? 0;
  const moduleCount = getModuleStepCount(queueId);
  const totalSteps = Math.max(staticCount, moduleCount);
  if (stepIndex < 0 || stepIndex >= totalSteps - 1) return undefined;
  return resolveStepData(queueId, stepIndex + 1);
}

export function getStepAt(queueId, stepIndex) {
  return resolveStepData(queueId, stepIndex);
}

/**
 * Build the next-step input when the queue advances normally (no HITL resume).
 * Calls the step's chain function, or a built-in strategy, or passes through by default.
 */
export function invokeChain(queueId, stepIndex, context) {
  const moduleStep = resolveModuleStep(queueId, stepIndex);
  const chain = moduleStep?.chain;
  if (typeof chain === 'function') return chain(context);
  if (chain === 'passthrough') return defaultMapChainPassthrough(context);
  if (chain === 'continueFromPrevious') return defaultMapChainContinueFromPrevious(context);
  // Default: pass through the most recent previous output, or initial input.
  const prevOutputs = context?.previousOutputs ?? [];
  return prevOutputs.length ? prevOutputs[prevOutputs.length - 1].output : context?.initialInput;
}

/**
 * Build the domain input when a HITL step is resumed after human approval.
 * Calls the step's resume function, or merges pendingInput + reviewerInput by default.
 */
export function invokeResume(queueId, stepIndex, context) {
  const moduleStep = resolveModuleStep(queueId, stepIndex);
  const resume = moduleStep?.resume;
  if (typeof resume === 'function') return resume(context);
  // Default: shallow merge pending domain input with reviewer input.
  const pending = context?.pendingInput ?? {};
  const reviewer = context?.reviewerInput;
  return {
    ...pending,
    ...(reviewer !== null && typeof reviewer === 'object' ? reviewer : {}),
  };
}

/**
 * Evaluate whether a looping step should re-run after its output.
 * Calls the step's loop.shouldContinue function; returns false if none defined.
 */
export function invokeLoop(queueId, stepIndex, context) {
  const moduleStep = resolveModuleStep(queueId, stepIndex);
  const shouldContinue = moduleStep?.loop?.shouldContinue;
  if (typeof shouldContinue === 'function') return shouldContinue(context);
  return false;
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
 * Merges queue next-step worker IDs into calleeIds for per-function environment injection.
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
 * esbuild plugin for schema extraction.
 *
 * Intercepts every import so only two things are bundled for real:
 *   1. The worker source file itself (workerRelPath) — so the InputSchema is created.
 *   2. zod — so z.object / z.string / etc. are real Zod constructors.
 *
 * @microfox/ai-worker gets a targeted stub whose createWorker() correctly
 * preserves inputSchema on the returned object (the real Zod schema), but
 * doesn't pull in MongoDB, AWS SDKs, or anything else that throws at init.
 *
 * Everything else (project libs like ../../../../lib/mongodb, cloud SDKs,
 * etc.) becomes a Proxy stub — safe to reference at module level, never called.
 */
function createSchemaExtractionPlugin(workerRelPath: string): esbuild.Plugin {
  const PROXY_STUB = `
const STUB = new Proxy({}, {
  get(t, p) { return typeof p === 'symbol' ? t[p] : STUB; },
  apply() { return STUB; },
  construct() { return Object.create(STUB); }
});
module.exports = STUB;
`;
  // Minimal createWorker stub: preserves id/inputSchema/outputSchema/handler so
  // workerAgent.inputSchema is the real Zod schema after module evaluation.
  const AI_WORKER_STUB = `
const STUB = new Proxy({}, {
  get(t, p) { return typeof p === 'symbol' ? t[p] : STUB; },
  apply() { return STUB; },
  construct() { return Object.create(STUB); }
});
exports.createWorker = function(config) {
  return {
    id: config.id,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    handler: config.handler || STUB,
    dispatch: STUB,
    retry: config.retry,
    workerConfig: config.workerConfig,
  };
};
module.exports = new Proxy(exports, {
  get(t, p) { return p in t ? t[p] : (typeof p === 'symbol' ? t[p] : STUB); }
});
`;

  return {
    name: 'schema-extraction-stub',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const p = args.path;
        // Entry point (no importer) → let esbuild resolve it normally.
        if (!args.importer) return undefined;
        // Imports from within bundled packages (e.g. zod internal sub-modules)
        // must resolve normally so the package stays functional.
        if (args.importer.includes('node_modules')) return undefined;
        // Let the worker source through so its Zod schemas are evaluated for real.
        if (p === workerRelPath) return undefined;
        // Let zod through so z.object / z.string etc. are genuine constructors.
        if (p === 'zod' || p.startsWith('zod/')) return undefined;
        // @microfox/ai-worker gets a minimal stub that keeps createWorker functional.
        if (p === '@microfox/ai-worker' || p.startsWith('@microfox/ai-worker/')) {
          return { path: p, namespace: 'ai-worker-stub-ns' };
        }
        // Everything else (MongoDB, AWS SDKs, project libs, etc.) → generic Proxy stub.
        return { path: p, namespace: 'stub-ns' };
      });
      build.onLoad({ filter: /.*/, namespace: 'ai-worker-stub-ns' }, () => ({
        contents: AI_WORKER_STUB,
        loader: 'js',
      }));
      build.onLoad({ filter: /.*/, namespace: 'stub-ns' }, () => ({
        contents: PROXY_STUB,
        loader: 'js',
      }));
    },
  };
}

/**
 * Tries to extract a worker's inputSchema as JSON Schema using a stub-based esbuild bundle
 * that mocks all heavy dependencies so module init doesn't throw.
 */
async function extractSchemaViaStub(
  worker: WorkerInfo,
  handlerFile: string,
  relativeImportPath: string,
  workerRef: string
): Promise<Record<string, any> | undefined> {
  const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const extractEntry = handlerFile.replace('.js', `.schema-extract-${nonce}.ts`);
  const extractOut = handlerFile.replace('.js', `.schema-extract-${nonce}.cjs`);
  try {
    // The entry calls z.toJSONSchema() *inside* the bundle so the same zod
    // instance that created the schema converts it — no cross-instance mismatch.
    fs.writeFileSync(
      extractEntry,
      `import * as workerModule from '${relativeImportPath}';
import { z } from 'zod';
const workerAgent = ${workerRef};
const _schema = workerAgent?.inputSchema ?? workerModule?.default?.inputSchema;
export const exportedSchemaJSON: string | null = (() => {
  try { return _schema ? JSON.stringify((z as any).toJSONSchema(_schema)) : null; } catch { return null; }
})();
`
    );
    await esbuild.build({
      entryPoints: [extractEntry],
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      outfile: extractOut,
      plugins: [createSchemaExtractionPlugin(relativeImportPath)],
      packages: 'bundle',
      logLevel: 'silent',
    });
    const mod = await import(pathToFileURL(path.resolve(extractOut)).href);
    if (mod.exportedSchemaJSON) {
      return JSON.parse(mod.exportedSchemaJSON as string) as Record<string, any>;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    try { if (fs.existsSync(extractEntry)) fs.unlinkSync(extractEntry); } catch {}
    try { if (fs.existsSync(extractOut)) fs.unlinkSync(extractOut); } catch {}
  }
}

/**
 * esbuild plugin for evaluating a `*.queue.ts` module just enough to read its HITL `inputSchema`s.
 * Unlike the worker extractor, queue files routinely import SHARED schema files (often via the `@/`
 * path alias), so those project imports must resolve for REAL (the Zod schemas have to be genuine).
 * We keep `zod` real, make `@microfox/ai-worker` an identity stub (so `defineWorkerQueue`/
 * `defineHitlConfig`/`repeatStep` just return their config), let project-relative + alias imports
 * resolve, and Proxy-stub every other bare package (AWS/Mongo/etc.) so module init can't throw.
 */
function createQueueSchemaExtractionPlugin(): esbuild.Plugin {
  const PROXY_STUB = `
const STUB = new Proxy(function(){}, {
  get(t, p) { return typeof p === 'symbol' ? t[p] : STUB; },
  apply() { return STUB; },
  construct() { return Object.create({}); }
});
module.exports = STUB;
`;
  const AI_WORKER_STUB = `
const STUB = new Proxy(function(){}, {
  get(t, p) { return typeof p === 'symbol' ? undefined : STUB; },
  apply() { return STUB; },
  construct() { return Object.create({}); }
});
exports.defineWorkerQueue = function(config) { return config; };
exports.defineHitlConfig = function(config) { return config; };
exports.repeatStep = function(count, factory) { return Array.from({ length: count }, function(_, i){ return factory(i); }); };
module.exports = new Proxy(exports, {
  get(t, p) { return p in t ? t[p] : (typeof p === 'symbol' ? t[p] : STUB); }
});
`;
  return {
    name: 'queue-schema-extraction-stub',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const p = args.path;
        if (!args.importer) return undefined; // entry point
        if (args.importer.includes('node_modules')) return undefined; // package internals resolve normally
        if (p === 'zod' || p.startsWith('zod/')) return undefined; // genuine zod
        if (p === '@microfox/ai-worker' || p.startsWith('@microfox/ai-worker/')) {
          return { path: p, namespace: 'ai-worker-queue-stub-ns' };
        }
        // Project files (relative or path-alias) resolve for real so shared Zod schemas evaluate.
        if (p.startsWith('.') || p.startsWith('@/') || p.startsWith('~/')) return undefined;
        // Any other bare package → generic Proxy stub (never evaluate heavy SDKs during extraction).
        return { path: p, namespace: 'queue-stub-ns' };
      });
      build.onLoad({ filter: /.*/, namespace: 'ai-worker-queue-stub-ns' }, () => ({ contents: AI_WORKER_STUB, loader: 'js' }));
      build.onLoad({ filter: /.*/, namespace: 'queue-stub-ns' }, () => ({ contents: PROXY_STUB, loader: 'js' }));
    },
  };
}

/**
 * Best-effort: evaluate a queue module via the stub bundle and convert each step's HITL Zod
 * `inputSchema` to JSON Schema (+ capture the reviewer form title), merging the results onto
 * `queue.steps` in place. Non-fatal — if extraction fails the console simply shows a raw-JSON
 * reviewer form. `z.toJSONSchema` runs INSIDE the bundle so the same Zod instance that built the
 * schema converts it (no cross-instance mismatch). `@/`-style aliases resolve via the project's
 * tsconfig.
 */
async function extractQueueHitl(queue: QueueInfo, projectRoot: string, outputDir: string): Promise<void> {
  const queueAbs = path.resolve(queue.filePath);
  const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const entryFile = path.join(outputDir, `.hitl-extract-${nonce}.ts`);
  const outFile = path.join(outputDir, `.hitl-extract-${nonce}.cjs`);
  const tsconfigPath = path.join(projectRoot, 'tsconfig.json');

  let relImport = path.relative(outputDir, queueAbs).replace(/\.ts$/, '').split(path.sep).join('/');
  if (!relImport.startsWith('.')) relImport = './' + relImport;

  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      entryFile,
      `import * as queueModule from '${relImport}';
import { z } from 'zod';
const q = (queueModule && (queueModule.default || queueModule.queue)) || queueModule;
export const exportedHitlJSON: string | null = (() => {
  try {
    const steps = (q && Array.isArray(q.steps) ? q.steps : []).map((s) => {
      let hitlInputSchema = null;
      let hitlTitle = null;
      try {
        const inputSchema = s && s.hitl && s.hitl.inputSchema;
        if (inputSchema) hitlInputSchema = (z).toJSONSchema(inputSchema);
      } catch (e) {}
      try {
        const title = s && s.hitl && s.hitl.ui && s.hitl.ui.title;
        if (typeof title === 'string') hitlTitle = title;
      } catch (e) {}
      return {
        workerId: s && s.workerId,
        requiresApproval: !!(s && s.requiresApproval),
        hitlInputSchema: hitlInputSchema,
        hitlTitle: hitlTitle,
      };
    });
    return JSON.stringify(steps);
  } catch (e) {
    return null;
  }
})();
`
    );
    await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      outfile: outFile,
      plugins: [createQueueSchemaExtractionPlugin()],
      packages: 'bundle',
      logLevel: 'silent',
      ...(fs.existsSync(tsconfigPath) ? { tsconfig: tsconfigPath } : {}),
    });
    const mod = await import(pathToFileURL(path.resolve(outFile)).href);
    if (!mod.exportedHitlJSON) return;
    const parsed = JSON.parse(mod.exportedHitlJSON as string) as Array<{
      workerId?: string;
      requiresApproval?: boolean;
      hitlInputSchema?: Record<string, any> | null;
      hitlTitle?: string | null;
    }>;
    // Merge by index — the queue scanner preserves definition step order.
    parsed.forEach((info, i) => {
      const step = queue.steps[i];
      if (!step) return;
      if (info.hitlInputSchema) step.hitlInputSchema = info.hitlInputSchema;
      if (info.hitlTitle) step.hitlTitle = info.hitlTitle;
      if (info.requiresApproval && step.requiresApproval === undefined) step.requiresApproval = true;
    });
  } catch {
    // Non-fatal: console falls back to a raw-JSON reviewer form until extraction succeeds.
  } finally {
    try { if (fs.existsSync(entryFile)) fs.unlinkSync(entryFile); } catch {}
    try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch {}
  }
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
  getStepAt: queueRegistry.getStepAt,
  invokeChain: queueRegistry.invokeChain,
  invokeResume: queueRegistry.invokeResume,
  invokeLoop: queueRegistry.invokeLoop,
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
export const exportedInputSchema = workerAgent?.inputSchema ?? workerModule?.default?.inputSchema;
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
export const exportedInputSchema = workerAgent?.inputSchema ?? workerModule?.default?.inputSchema;
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

function generateTriggerHandler(
  outputDir: string,
  serviceName: string,
  externalPackages: string[] = [],
  workers: WorkerInfo[] = [],
  groupServiceNames: Record<string, string> = {}
): void {
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
import * as crypto from 'crypto';

const SERVICE_NAME = ${JSON.stringify(serviceName)};
const WORKER_GROUPS: Record<string, string> = ${JSON.stringify(
    Object.fromEntries(workers.map((w) => [w.id, w.group || 'default'])),
    null,
    2
  )};
const GROUP_SERVICE_NAMES: Record<string, string> = ${JSON.stringify(groupServiceNames, null, 2)};

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

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

export const handler = async (event: APIGatewayProxyEvent, context?: any): Promise<APIGatewayProxyResult> => {
  // Structured, greppable logging so CloudWatch shows exactly what the trigger Lambda did.
  const log = (level: 'INFO' | 'WARN' | 'ERROR', msg: string, data?: Record<string, unknown>) => {
    const line = '[workers-trigger] [' + level + '] ' + msg;
    if (level === 'ERROR') console.error(line, data ? JSON.stringify(data) : '');
    else if (level === 'WARN') console.warn(line, data ? JSON.stringify(data) : '');
    else console.log(line, data ? JSON.stringify(data) : '');
  };

  const requestId = (event as any)?.requestContext?.requestId || '';
  const stage =
    (event as any)?.requestContext?.stage ||
    process.env.ENVIRONMENT ||
    process.env.STAGE ||
    'prod';
  const region = process.env.AWS_REGION || 'us-east-1';
  const qsWorkerId = event.queryStringParameters?.workerId;

  log('INFO', 'invoked', {
    requestId,
    stage,
    region,
    httpMethod: (event as any)?.httpMethod,
    hasBody: !!event.body,
    bodyLength: event.body ? event.body.length : 0,
    qsWorkerId: qsWorkerId || null,
  });

  // Require an API key when one is configured (unified WORKERS_API_KEY or legacy
  // WORKERS_TRIGGER_API_KEY). Public only when neither is set.
  const apiKey = process.env.WORKERS_API_KEY || process.env.WORKERS_TRIGGER_API_KEY;
  const keyEnvSource = process.env.WORKERS_API_KEY
    ? 'WORKERS_API_KEY'
    : process.env.WORKERS_TRIGGER_API_KEY
      ? 'WORKERS_TRIGGER_API_KEY'
      : 'none';
  if (apiKey) {
    const providedKey = (event.headers['x-workers-trigger-key'] || event.headers['X-Workers-Trigger-Key'] || '') as string;
    const matched = timingSafeEqualStr(providedKey, apiKey);
    // Never log the secret itself — only presence + lengths so a mismatch is diagnosable.
    log(matched ? 'INFO' : 'WARN', 'auth check', {
      keyConfigured: true,
      keyEnvSource,
      providedKeyPresent: !!providedKey,
      providedKeyLength: providedKey.length,
      expectedKeyLength: apiKey.length,
      matched,
    });
    if (!matched) {
      log('ERROR', 'rejected: API key mismatch (worker NOT triggered)', { requestId });
      return jsonResponse(401, { error: 'Unauthorized' });
    }
  } else {
    log('INFO', 'auth check', { keyConfigured: false, note: 'endpoint is public (no key set)' });
  }

  let parsedBody: any = undefined;
  if (event.body) {
    try {
      parsedBody = JSON.parse(event.body);
    } catch (e: any) {
      log('WARN', 'request body is not valid JSON; falling back to raw body', { error: String(e?.message || e) });
      parsedBody = undefined;
    }
  }

  const workerId = (parsedBody && parsedBody.workerId) || qsWorkerId;
  if (!workerId || typeof workerId !== 'string') {
    log('ERROR', 'rejected: missing workerId', { requestId });
    return jsonResponse(400, { error: 'workerId is required (query param workerId or JSON body workerId)' });
  }
  const knownWorker = Object.prototype.hasOwnProperty.call(WORKER_GROUPS, workerId);
  log('INFO', 'resolved workerId', { workerId, group: WORKER_GROUPS[workerId] || '(unknown)', knownWorker });
  if (!knownWorker) {
    // Not fatal (an older deploy may not list every worker), but a typo'd / undeployed workerId is
    // the most common cause of "trigger returned ok but the worker never ran".
    log('WARN', 'workerId is NOT in this deployment known-worker list — check spelling / redeploy', {
      workerId,
      knownWorkerIds: Object.keys(WORKER_GROUPS),
    });
  }

  // Prefer JSON body fields, otherwise send raw event.body
  let messageBody: string | undefined;
  let bodySource = '';
  if (parsedBody && typeof parsedBody.messageBody === 'string') {
    messageBody = parsedBody.messageBody;
    bodySource = 'parsedBody.messageBody';
  } else if (parsedBody && parsedBody.body !== undefined) {
    messageBody = typeof parsedBody.body === 'string' ? parsedBody.body : JSON.stringify(parsedBody.body);
    bodySource = 'parsedBody.body';
  } else if (event.body) {
    messageBody = event.body;
    bodySource = 'raw event.body';
  }

  if (!messageBody) {
    log('ERROR', 'rejected: no message body to enqueue', { requestId, workerId });
    return jsonResponse(400, { error: 'body/messageBody is required' });
  }
  // Surface the jobId being enqueued so it can be cross-referenced with the worker Lambda's logs.
  let enqueuedJobId: string | undefined;
  try { enqueuedJobId = JSON.parse(messageBody)?.jobId; } catch {}
  log('INFO', 'message body resolved', { bodySource, messageBodyLength: messageBody.length, jobId: enqueuedJobId || null });
  // Authoritative jobId ↔ Lambda requestId marker (same strict format as the worker handler) so the
  // console can pull THIS trigger invocation's exact CloudWatch batch by requestId.
  console.log('[AIWORKER_TRIGGER] ' + JSON.stringify({ jobId: enqueuedJobId || null, workerId, awsRequestId: context && context.awsRequestId }));

  const envKey = 'WORKER_QUEUE_URL_' + workerId.replace(/-/g, '_').toUpperCase();
  let queueUrl: string | undefined = process.env[envKey];
  const sqs = new SQSClient({ region });
  let queueName: string | undefined;
  let queueResolution = '';
  if (queueUrl) {
    queueResolution = 'env';
    log('INFO', 'queue URL taken from env', { envKey, queueUrl });
  } else {
    // Use per-group service name so workers in non-core groups resolve their own queue.
    const workerGroup = WORKER_GROUPS[workerId] || 'default';
    const workerServiceName = GROUP_SERVICE_NAMES[workerGroup] || SERVICE_NAME;
    queueName = \`\${workerServiceName}-\${workerId}-\${stage}\`;
    queueResolution = 'GetQueueUrl';
    log('INFO', 'queue URL not in env; resolving via GetQueueUrl', {
      envKey,
      workerGroup,
      workerServiceName,
      queueName,
    });
    try {
      const urlRes = await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }));
      if (!urlRes.QueueUrl) {
        log('ERROR', 'GetQueueUrl returned no URL (worker NOT triggered)', { queueName });
        return jsonResponse(404, { error: 'Queue URL not found', queueName });
      }
      queueUrl = String(urlRes.QueueUrl);
      log('INFO', 'resolved queue URL via GetQueueUrl', { queueName, queueUrl });
    } catch (e: any) {
      log('ERROR', 'GetQueueUrl failed (worker NOT triggered) — queue missing/undeployed or no permission', {
        queueName,
        errorName: e?.name,
        message: String(e?.message || e),
      });
      return jsonResponse(404, { error: 'Queue does not exist or not accessible', queueName, message: String(e?.message || e) });
    }
  }

  try {
    log('INFO', 'sending message to SQS', { queueUrl, queueResolution, workerId, jobId: enqueuedJobId || null });
    const sendRes = await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: messageBody }));
    log('INFO', 'message ENQUEUED — worker will pick it up from SQS', {
      messageId: sendRes.MessageId || null,
      queueUrl,
      workerId,
      jobId: enqueuedJobId || null,
    });
    return jsonResponse(200, {
      ok: true,
      workerId,
      stage,
      queueName,
      queueUrl,
      messageId: sendRes.MessageId || null,
    });
  } catch (e: any) {
    log('ERROR', 'SendMessage FAILED (worker NOT triggered)', {
      queueUrl,
      errorName: e?.name,
      message: String(e?.message || e),
    });
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
  externalPackages: string[] = [],
  workers: WorkerInfo[] = [],
  groupServiceNames: Record<string, string> = {}
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
import * as crypto from 'crypto';

const QUEUE_ID = ${JSON.stringify(queue.id)};
const FIRST_WORKER_ID = ${JSON.stringify(firstWorkerId)};
const SERVICE_NAME = ${JSON.stringify(serviceName)};
// The queue starter deploys in the CORE group, but the first worker may live in ANOTHER group
// (e.g. a "test"-group demo worker). Its SQS queue name is derived from THAT group's service name,
// not the starter's. These maps let us resolve the correct cross-group queue name (mirrors the
// workers-trigger handler). Without this, a first worker outside core → "queue does not exist".
const WORKER_GROUPS: Record<string, string> = ${JSON.stringify(
    Object.fromEntries(workers.map((w) => [w.id, w.group || 'default'])),
    null,
    2
  )};
const GROUP_SERVICE_NAMES: Record<string, string> = ${JSON.stringify(groupServiceNames, null, 2)};

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function isHttpEvent(event: any): event is { body?: string; requestContext?: any } {
  return event && typeof event.requestContext === 'object' && (event.body !== undefined || event.httpMethod === 'POST');
}

async function getFirstWorkerQueueUrl(region: string, stage: string): Promise<string> {
  const envKey = 'WORKER_QUEUE_URL_' + FIRST_WORKER_ID.replace(/-/g, '_').toUpperCase();
  const fromEnv = process.env[envKey];
  if (fromEnv) return fromEnv;
  // Resolve the first worker's queue via ITS OWN group's service name (cross-group safe).
  const firstWorkerGroup = WORKER_GROUPS[FIRST_WORKER_ID] || 'default';
  const firstWorkerServiceName = GROUP_SERVICE_NAMES[firstWorkerGroup] || SERVICE_NAME;
  const queueName = \`\${firstWorkerServiceName}-\${FIRST_WORKER_ID}-\${stage}\`;
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
    const apiKey = process.env.WORKERS_API_KEY || process.env.WORKERS_TRIGGER_API_KEY;
    if (apiKey) {
      const provided = (event.headers && (event.headers['x-workers-trigger-key'] || event.headers['X-Workers-Trigger-Key'])) || '';
      if (!timingSafeEqualStr(provided, apiKey)) {
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
    // Trigger provenance: label API-started queue runs (a caller-supplied stamp — e.g. the
    // console's {type:'console'} — wins). Persisted to the queue doc + step-0 job metadata.
    if (metadata.__trigger === undefined) {
      metadata.__trigger = { type: 'external', at: new Date().toISOString() };
    }

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
  // Trigger provenance: cron-started queue runs are labeled 'schedule' (not derivable elsewhere).
  metadata = { __trigger: { type: 'schedule', queueId: QUEUE_ID, at: new Date().toISOString() } };
  try {
    await upsertInitialQueueJob({ queueJobId: jobId, queueId: QUEUE_ID, firstWorkerId: FIRST_WORKER_ID, firstWorkerJobId: jobId, metadata });
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
  externalPackages: string[] = [],
  groupServiceNames: Record<string, string> = {}
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
import * as crypto from 'crypto';

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Worker IDs, schemas, and queue definitions embedded at build time.
const WORKER_IDS: string[] = ${JSON.stringify(workers.map(w => w.id), null, 2)};
const WORKER_GROUPS: Record<string, string> = ${JSON.stringify(
    Object.fromEntries(workers.map((w) => [w.id, w.group || 'default'])),
    null,
    2
  )};
const WORKER_SCHEMAS: Record<string, unknown> = ${JSON.stringify(
    Object.fromEntries(workers.filter(w => w.inputSchema).map(w => [w.id, w.inputSchema])),
    null,
    2
  )};
const QUEUES = ${JSON.stringify(queues.map(q => ({ id: q.id, steps: q.steps, schedule: q.schedule })), null, 2)};
const SERVICE_NAME = ${JSON.stringify(serviceName)};
const GROUP_SERVICE_NAMES: Record<string, string> = ${JSON.stringify(groupServiceNames, null, 2)};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
// ... same logic ...
  // Require an API key when one is configured (unified WORKERS_API_KEY or legacy
  // WORKERS_CONFIG_API_KEY). Public only when neither is set.
  const apiKey = process.env.WORKERS_API_KEY || process.env.WORKERS_CONFIG_API_KEY;
  if (apiKey) {
    const providedKey = (event.headers['x-workers-config-key'] || event.headers['X-Workers-Config-Key'] || '') as string;
    if (!timingSafeEqualStr(providedKey, apiKey)) {
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
  const workers: Record<string, { queueUrl: string; region: string; group: string }> = {};
  const attemptedQueueNames: string[] = [];
  const errors: Array<{ workerId: string; queueName: string; message: string; name?: string }> = [];
  // Only expose debug internals (attempted queue names, raw AWS errors) when a key
  // is configured — i.e. the request above was authenticated. Never leak on public deploys.
  const debug =
    !!apiKey &&
    (event.queryStringParameters?.debug === '1' || event.queryStringParameters?.debug === 'true');

  await Promise.all(
    WORKER_IDS.map(async (workerId) => {
      // Prefer convention-based env vars generated in core stack so we can support multiple groups.
      const envKey = 'WORKER_QUEUE_URL_' + workerId.replace(/-/g, '_').toUpperCase();
      const fromEnv = process.env[envKey];
      if (fromEnv) {
        workers[workerId] = { queueUrl: fromEnv, region, group: WORKER_GROUPS[workerId] || 'default' };
        return;
      }

      // Fallback: resolve via SQS GetQueueUrl. Use per-group service name so multi-group
      // deployments look up the correct queue (e.g. "proj-cost-group-worker-id-prod").
      const workerGroup = WORKER_GROUPS[workerId] || 'default';
      const workerServiceName = GROUP_SERVICE_NAMES[workerGroup] || SERVICE_NAME;
      const queueName = \`\${workerServiceName}-\${workerId}-\${stage}\`;
      attemptedQueueNames.push(queueName);
      try {
        const result = await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }));
        if (result?.QueueUrl) {
          workers[workerId] = {
            queueUrl: String(result.QueueUrl),
            region,
            group: WORKER_GROUPS[workerId] || 'default',
          };
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
      schemas: WORKER_SCHEMAS,
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
 * Reads environment variables from a single .env-style file.
 */
function loadEnvFile(envPath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return env;

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
 * Stage-scoped env file cascade (dotenv-flow convention): later files win on key conflict.
 * `.env` -> `.env.local` -> `.env.{stage}` -> `.env.{stage}.local`.
 * With `isolated`, the shared base files are skipped entirely — ONLY
 * `.env.{stage}` -> `.env.{stage}.local` are read (env.files='isolated', Plan D).
 */
export function loadEnvFiles(stage: string, opts: { silent?: boolean; isolated?: boolean } = {}): { env: Record<string, string>; filesRead: string[] } {
  const candidates = opts.isolated
    ? [`.env.${stage}`, `.env.${stage}.local`]
    : ['.env', '.env.local', `.env.${stage}`, `.env.${stage}.local`];
  const env: Record<string, string> = {};
  const filesRead: string[] = [];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    filesRead.push(candidate);
    Object.assign(env, loadEnvFile(candidate));
  }

  if (filesRead.length === 0 && !opts.silent) {
    console.warn(chalk.yellow(`⚠️  No env file found (looked for ${candidates.join(', ')})`));
  }

  return { env, filesRead };
}

/**
 * Loads the project's stage-scoped env cascade into process.env (non-overriding) so values like
 * MICROFOX_PROJECT_ID are visible to microfox config resolution AND to microfox.config.ts
 * evaluation (which reads process.env). Real shell/CI env vars always win — we never overwrite
 * an existing value. This is why MICROFOX_PROJECT_ID works without putting it in microfox.json.
 */
/**
 * Keys hydrateProcessEnvFromDotenv copied into process.env (i.e. NOT real shell/CI
 * env). Lets the env.files='isolated' path un-hydrate base-.env keys after the
 * config is resolved, without ever touching genuine shell env.
 */
const hydratedEnvKeys = new Set<string>();

export function hydrateProcessEnvFromDotenv(stage: string): void {
  const { env: fromFiles } = loadEnvFiles(stage, { silent: true });
  for (const [key, value] of Object.entries(fromFiles)) {
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
      hydratedEnvKeys.add(key);
    }
  }
}

/** Legacy hardcoded prefix allowlist — the compiled-in default of `env.mode: 'all-detected'`. */
const ALLOWED_ENV_PREFIXES = [
  'OPENAI_', 'ANTHROPIC_', 'DATABASE_', 'MONGODB_', 'REDIS_', 'UPSTASH_',
  'WORKER_', 'WORKERS_', 'WORKFLOW_', 'REMOTION_', 'QUEUE_JOB_', 'DEBUG_WORKER_QUEUES',
];

/** `env` block shape read from microfox.config.ts / microfox.json (Plan D). */
interface MicrofoxEnvConfig {
  mode?: 'all-detected' | 'explicit';
  /**
   * How stage env files combine (Plan D addendum):
   * - 'cascade' (default): dotenv-flow convention — `.env` -> `.env.local` ->
   *   `.env.{stage}` -> `.env.{stage}.local`, later wins; stage files OVERRIDE the shared base.
   * - 'isolated': a staged build reads ONLY `.env.{stage}` / `.env.{stage}.local`
   *   (nothing inherits from `.env`). Compile hard-errors when neither file exists,
   *   so a stage can never silently ship the base `.env` values.
   */
  files?: 'cascade' | 'isolated';
  include?: string[];
  exclude?: string[];
  /** Per-group overlay: lists are appended to the project lists; `mode` overrides the project mode for that group only. */
  groups?: Record<
    string,
    { mode?: 'all-detected' | 'explicit'; include?: string[]; exclude?: string[] }
  >;
}

/** Matches `key` against a list of patterns; `*` is a wildcard (prefix/suffix/middle), rest is literal. */
function matchesGlobList(key: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((pattern) => {
    if (!pattern.includes('*')) return key === pattern;
    const escaped = pattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return new RegExp(`^${escaped}$`).test(key);
  });
}

function getEnvConfig(microfoxConfig: Record<string, any> | null): MicrofoxEnvConfig {
  const env = microfoxConfig?.env;
  return env && typeof env === 'object' ? (env as MicrofoxEnvConfig) : {};
}

/** Project-level include/exclude lists merged with the given group's overlay (group lists appended). */
function resolveGroupEnvLists(
  envConfig: MicrofoxEnvConfig,
  group?: string | null
): { include: string[]; exclude: string[] } {
  const projectInclude = Array.isArray(envConfig.include) ? envConfig.include : [];
  const projectExclude = Array.isArray(envConfig.exclude) ? envConfig.exclude : [];
  const groupCfg = group ? envConfig.groups?.[group] : undefined;
  const groupInclude = Array.isArray(groupCfg?.include) ? groupCfg!.include : [];
  const groupExclude = Array.isArray(groupCfg?.exclude) ? groupCfg!.exclude : [];
  return {
    include: [...projectInclude, ...groupInclude],
    exclude: [...projectExclude, ...groupExclude],
  };
}

/**
 * Builds the env.json content for one deployable unit (single-group build, or one group /
 * core in a multi-group build). Shared by all three env.json call sites so the resolution
 * order — platform defaults, exclude, include, mode, AWS_ block — stays in one place.
 *
 * Resolution order per key: platform defaults (always win, un-excludable) > AWS_* (never ships)
 * > exclude > include > mode `all-detected` (legacy prefix allowlist + detected keys) or
 * `explicit` (nothing else ships).
 */
function buildEnvJson(
  envVars: Record<string, string>,
  referencedEnvKeys: Set<string>,
  microfoxConfig: Record<string, any> | null,
  group: string | null,
  platformDefaults: Record<string, string>,
  envFilesRead: string[] = []
): Record<string, string> {
  const envConfig = getEnvConfig(microfoxConfig);
  // Group `mode` overrides the project mode for that group's env.json only;
  // any other/missing value inherits the project mode (default all-detected).
  const groupMode = group ? envConfig.groups?.[group]?.mode : undefined;
  const effectiveMode =
    groupMode === 'explicit' || groupMode === 'all-detected' ? groupMode : envConfig.mode;
  const mode = effectiveMode === 'explicit' ? 'explicit' : 'all-detected';
  const { include, exclude } = resolveGroupEnvLists(envConfig, group);

  const result: Record<string, string> = { ...platformDefaults };
  const shippedKeys: string[] = [];

  for (const [key, value] of Object.entries(envVars)) {
    // AWS_ prefix is reserved by Lambda, never ships regardless of config.
    // https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html
    if (key.startsWith('AWS_')) continue;
    // Platform-required keys (ENVIRONMENT/STAGE/NODE_ENV) already set above and cannot be excluded.
    if (key in result) continue;

    if (matchesGlobList(key, exclude)) continue;

    if (matchesGlobList(key, include)) {
      result[key] = value;
      shippedKeys.push(key);
      continue;
    }

    if (mode === 'all-detected') {
      if (ALLOWED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix)) || referencedEnvKeys.has(key)) {
        result[key] = value;
        shippedKeys.push(key);
      }
    }
  }

  const missingIncludes = include.filter((pattern) =>
    pattern.includes('*') ? !Object.keys(envVars).some((k) => matchesGlobList(k, [pattern])) : !(pattern in envVars)
  );
  if (missingIncludes.length > 0) {
    const readLabel = envFilesRead.length ? envFilesRead.join(', ') : 'any env file';
    console.warn(
      chalk.yellow(
        `⚠️  env.include key(s) not found in ${readLabel}${group ? ` (group: ${group})` : ''}: ${missingIncludes.join(', ')}`
      )
    );
  }

  if (mode === 'explicit') {
    console.log(
      chalk.gray(
        `  ℹ env mode "explicit"${group ? ` (${group})` : ''}: shipping ${shippedKeys.length} key(s): ${shippedKeys.join(', ') || '(none)'}`
      )
    );
  }

  // The 'local' job store only works inside `ai-worker dev` — deployed Lambdas
  // can't use it (read-only FS, per-container memory). Shipping it is almost
  // always a leftover dev line in .env; warn loudly (but honor it, since the
  // user set it explicitly).
  if ((result.WORKER_DATABASE_TYPE || '').toLowerCase() === 'local') {
    console.warn(
      chalk.yellow(
        `⚠️  WORKER_DATABASE_TYPE=local is being baked into env.json${group ? ` (group: ${group})` : ''} — deployed workers CANNOT use the local dev store. Remove the line from your .env (it is meant for \`ai-worker dev\` only) unless you really intend this.`
      )
    );
  }

  return result;
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
        // Stage-qualify the export name. CloudFormation export names must be unique per
        // region/account, but `self:service` is stage-independent (only the STACK name
        // carries -prod/-staging). Without the stage here, a staging stack collides with
        // its prod counterpart ("Export ... is already exported by stack ...-prod") and
        // rolls back. This export is informational (cross-stack queue URLs are built by
        // string interpolation, not Fn::ImportValue), so renaming it breaks nothing.
        Name: `\${self:service}-\${opt:stage, env:ENVIRONMENT, '${stage}'}-${worker.id}-queue-url`,
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
  };
  functions['workersConfig'] = {
    handler: 'handlers/api/workers-config.handler',
    events: [{ http: { path: 'workers/config', method: 'GET', cors: true } }],
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

async function build(args: any) {
  const stage = args.stage || process.env.STAGE || 'prod';
  // Fixed stage set (decision D3): the standard AWS stages, not free-form names.
  // They embed into CloudFormation stack / Lambda / SQS names and the {sub}.microfox.app/{stage}
  // route path, so the platform relies on this exact set.
  const VALID_STAGES = ['prod', 'staging', 'dev'];
  if (!VALID_STAGES.includes(stage)) {
    console.error(
      chalk.red(`❌ Invalid stage "${stage}". Valid stages: ${VALID_STAGES.join(', ')}.`)
    );
    process.exit(1);
  }
  // Make the stage-scoped .env cascade values (e.g. MICROFOX_PROJECT_ID) available to config
  // resolution + microfox.config.ts.
  hydrateProcessEnvFromDotenv(stage);

  const region = args.region || process.env.AWS_REGION || 'us-east-1';
  const aiPath = args.aiPath ?? args['ai-path'] ?? 'app/ai';
  // Group selection (multi-group layout only): build a single group, or skip groups.
  const targetGroup = typeof args.group === 'string' ? args.group.trim() : '';
  const skipGroups = new Set(
    String(args.skipGroup ?? args['skip-group'] ?? '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean)
  );
  const isGroupFiltered = Boolean(targetGroup) || skipGroups.size > 0;

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
      if (isGroupFiltered && entry.isDirectory() && !['handlers', 'generated'].includes(entry.name)) {
        // Group-filtered build: only wipe the dirs we are about to regenerate so a
        // previously compiled group survives e.g. `compile core` + `push` workflows.
        const keep = targetGroup ? entry.name !== targetGroup : skipGroups.has(entry.name);
        if (keep) continue;
      }
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

  let { env: envVars, filesRead: envFilesRead } = loadEnvFiles(stage);

  // Detect env usage from worker entry files + their local dependency graph.
  // We use this to populate env.json with only envs that are actually referenced,
  // but ONLY if they exist in the env file cascade (we don't invent values).
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
          `⚠️  These referenced envs were not found in ${envFilesRead.length ? envFilesRead.join(', ') : 'any env file'} (so they will NOT be written to env.json): ${missingFromDotEnv
            .slice(0, 25)
            .join(', ')}${missingFromDotEnv.length > 25 ? ' ...' : ''}`
        )
      );
    }
  }

  let serviceName = (args['service-name'] as string | undefined)?.trim() || `ai-router-workers-${stage}`;
  let externalPackages = getExternalPackages(null);
  let microfoxConfig: Record<string, any> | null = null;
  const resolvedMicrofoxConfig = resolveMicrofoxConfig(process.cwd());

  // Resolve Microfox deployment config from root microfox.json or workflowSettings in microfox.config.ts.
  if (resolvedMicrofoxConfig) {
    microfoxConfig = resolvedMicrofoxConfig.config;
    externalPackages = getExternalPackages(microfoxConfig);
    // Keep .serverless-workers root compatible with Microfox CLI expectations.
    writeMicrofoxJson(path.join(serverlessDir, 'microfox.json'), microfoxConfig);
    if (microfoxConfig.projectId) {
      // Only override if user did not explicitly provide a service name
      if (!(args['service-name'] as string | undefined)?.trim()) {
        serviceName = getServiceNameFromProjectId(microfoxConfig.projectId);
      }
      console.log(
        chalk.blue(`ℹ️  Using service name from ${resolvedMicrofoxConfig.source}: ${serviceName}`)
      );
    }
  }

  // Plan D addendum — env.files='isolated': re-source env values from the stage
  // files ONLY (no inheritance from .env/.env.local). Must happen after config
  // resolution (the setting lives in the config) and before anything that reads
  // envVars (incl. the workers API key below, so auth secrets are stage-scoped too).
  if (getEnvConfig(microfoxConfig).files === 'isolated') {
    const isolatedLoad = loadEnvFiles(stage, { isolated: true, silent: true });
    if (isolatedLoad.filesRead.length === 0) {
      console.error(
        chalk.red(
          `❌ env.files is 'isolated' but neither .env.${stage} nor .env.${stage}.local exists.\n` +
            `   Create .env.${stage} with ALL env vars this stage needs, or remove files: 'isolated' to use the .env cascade.`
        )
      );
      process.exit(1);
    }
    const droppedKeys = Object.keys(envVars)
      .filter((k) => !(k in isolatedLoad.env))
      .sort();
    envVars = isolatedLoad.env;
    envFilesRead = isolatedLoad.filesRead;
    // Un-hydrate: keys the pre-config hydration copied from the CASCADE into
    // process.env must not leak past isolation (e.g. WORKERS_API_KEY resolution
    // reads process.env as a fallback). Only touches keys hydration itself set —
    // real shell/CI env still wins, unchanged. Config evaluation already happened,
    // so MICROFOX_PROJECT_ID etc. served their purpose.
    for (const key of hydratedEnvKeys) {
      if (key in isolatedLoad.env) {
        process.env[key] = isolatedLoad.env[key];
      } else {
        delete process.env[key];
      }
    }
    console.log(
      chalk.blue(`ℹ️  env.files=isolated: values sourced ONLY from ${envFilesRead.join(', ')}`)
    );
    if (droppedKeys.length > 0) {
      console.log(
        chalk.yellow(
          `   ${droppedKeys.length} key(s) from .env/.env.local are NOT available to this build: ${droppedKeys.slice(0, 25).join(', ')}${droppedKeys.length > 25 ? ' ...' : ''}`
        )
      );
    }
  }

  // SEC-4 / Plan B: resolve a stable secret to gate the generated worker endpoints.
  // Stable across pushes (never rotated automatically). Public-by-default when absent.
  const workersApiKey = resolveWorkersApiKey(microfoxConfig, envVars);
  const requireAuth = args.requireAuth ?? args['require-auth'] ?? false;
  const allowPublic = args.allowPublic ?? args['allow-public'] ?? false;
  if (workersApiKey) {
    const label =
      workersApiKey.source === 'WORKERS_API_KEY'
        ? 'WORKERS_API_KEY'
        : workersApiKey.source === 'legacy'
          ? 'legacy WORKERS_TRIGGER_API_KEY/WORKERS_CONFIG_API_KEY'
          : 'projectId-derived key';
    console.log(chalk.green(`🔒 Worker endpoints require auth (source: ${label}).`));
  } else if (requireAuth) {
    console.error(
      chalk.red(
        '❌ --require-auth was set but no worker secret could be resolved.\n' +
          '   Set WORKERS_API_KEY in .env, or add a projectId to microfox.json (or MICROFOX_PROJECT_ID).'
      )
    );
    process.exit(1);
  } else if (!allowPublic) {
    console.log(
      chalk.yellow(
        '⚠️  Workers will be deployed PUBLICLY — anyone can trigger them, start queues, and read /workers/config.\n' +
          '   Set WORKERS_API_KEY (recommended) or a projectId to require auth, or pass --allow-public to silence this.'
      )
    );
  }

  /** Apply the resolved unified key to an env.json map (no-op for the legacy path). */
  const applyWorkersApiKey = (envMap: Record<string, string>): void => {
    if (workersApiKey?.writeToEnv) {
      envMap.WORKERS_API_KEY = workersApiKey.key;
    }
  };

  const queues = await scanQueues(aiPath);
  if (queues.length > 0) {
    console.log(chalk.blue(`ℹ️  Found ${queues.length} queue(s): ${queues.map((q) => q.id).join(', ')}`));
    // Expose each HITL step's reviewer inputSchema (Zod → JSON Schema) on /workers/config so the
    // console can render + validate a generic approval form. Best-effort, never blocks the push.
    for (const q of queues) {
      await extractQueueHitl(q, process.cwd(), serverlessDir);
    }
    const hitlSteps = queues.reduce((n, q) => n + q.steps.filter((s) => s.hitlInputSchema).length, 0);
    if (hitlSteps > 0) console.log(chalk.gray(`  ✓ extracted ${hitlSteps} HITL reviewer schema(s)`));
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
        // Compute paths for stub-based schema extraction (same logic as generateHandlers)
        const srcContent = fs.readFileSync(worker.filePath, 'utf-8');
        const isDefaultExport = /export\s+default\s+createWorker/.test(srcContent);
        const exportMatch = srcContent.match(/export\s+(const|let)\s+(\w+)\s*=\s*createWorker/);
        const exportName = exportMatch ? exportMatch[2] : 'worker';
        const workerRef = isDefaultExport ? 'workerModule.default' : `workerModule.${exportName}`;
        let relImportPath = path.relative(path.dirname(path.resolve(handlerFile)), path.resolve(worker.filePath));
        if (!relImportPath.startsWith('.')) relImportPath = './' + relImportPath;
        relImportPath = relImportPath.replace(/\.ts$/, '').split(path.sep).join('/');

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

          // Extract inputSchema → convert to JSON Schema and store on WorkerInfo
          if (module.exportedInputSchema) {
            try {
              const { z } = await import('zod');
              worker.inputSchema = z.toJSONSchema(module.exportedInputSchema) as Record<string, any>;
              console.log(chalk.gray(`  ✓ ${worker.id}: inputSchema extracted`));
            } catch {
              // z.toJSONSchema unavailable (Zod v3?) — fall back to stub extraction
              const schema = await extractSchemaViaStub(worker, handlerFile, relImportPath, workerRef);
              if (schema) {
                worker.inputSchema = schema;
                console.log(chalk.gray(`  ✓ ${worker.id}: inputSchema extracted via stub`));
              } else {
                console.log(chalk.gray(`  ℹ ${worker.id}: inputSchema extraction failed (skipping)`));
              }
            }
          } else {
            // exportedInputSchema absent in main bundle — try stub extraction
            const schema = await extractSchemaViaStub(worker, handlerFile, relImportPath, workerRef);
            if (schema) {
              worker.inputSchema = schema;
              console.log(chalk.gray(`  ✓ ${worker.id}: inputSchema extracted via stub`));
            }
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

          // Stub-based schema extraction: mocks heavy SDK imports so createWorker evaluates cleanly
          const schema = await extractSchemaViaStub(worker, handlerFile, relImportPath, workerRef);
          if (schema) {
            worker.inputSchema = schema;
            console.log(chalk.gray(`  ✓ ${worker.id}: inputSchema extracted via stub`));
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
  const projectId = microfoxConfig?.projectId;

  if (isMultiGroup) {
    const selectedGroups = targetGroup
      ? userGroups.filter((g) => g === targetGroup)
      : userGroups.filter((g) => !skipGroups.has(g));
    const emitCore = targetGroup ? targetGroup === 'core' : !skipGroups.has('core');
    if (targetGroup && targetGroup !== 'core' && selectedGroups.length === 0) {
      console.error(
        chalk.red(`❌ No such group: ${targetGroup}. Available: core, ${userGroups.join(', ')}`)
      );
      process.exit(1);
    }
    if (!emitCore && selectedGroups.length === 0) {
      console.error(chalk.red('❌ No groups to build (all skipped).'));
      process.exit(1);
    }
    if (isGroupFiltered) {
      console.log(
        chalk.blue(
          `ℹ️  Building only: ${[...(emitCore ? ['core'] : []), ...selectedGroups].join(', ')} (other group builds are left untouched)`
        )
      );
    }
    if (!projectId) {
      console.error(
        chalk.red(
          '❌ Multi-group build requires projectId in microfox.json or microfox.config.ts (workflowSettings.deploymentConfig/projectId), or MICROFOX_PROJECT_ID.'
        )
      );
      process.exit(1);
    }
    const allWorkersByGroup = new Map<string, WorkerInfo[]>();
    for (const g of userGroups) {
      allWorkersByGroup.set(g, workers.filter((w) => w.group === g));
    }
    if (emitCore) {
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
      if (microfoxConfig) {
        writeMicrofoxJson(path.join(coreDir, 'microfox.json'), microfoxConfig);
      }
      generateQueueRegistry(queues, coreDir, process.cwd());
      const serviceNameCore = getServiceNameFromProjectId(projectId, 'core');
      const coreExternalPackages = getExternalPackages(microfoxConfig, 'core');
      const coreGroupServiceNames = Object.fromEntries(userGroups.map(g => [g, getServiceNameFromProjectId(projectId, g)]));
      generateWorkersConfigHandler(coreDir, workers, serviceNameCore, queues, coreExternalPackages, coreGroupServiceNames);
      generateDocsHandler(coreDir, serviceNameCore, stage, region, coreExternalPackages);
      generateTriggerHandler(coreDir, serviceNameCore, coreExternalPackages, workers, coreGroupServiceNames);
      for (const queue of queues) {
        generateQueueHandler(coreDir, queue, serviceNameCore, coreExternalPackages, workers, coreGroupServiceNames);
      }
      const configCore = generateServerlessConfigCore(projectId, allWorkersByGroup, queues, stage, region, envVars, serviceNameCore, coreExternalPackages, microfoxConfig);
      fs.writeFileSync(path.join(coreDir, 'serverless.yml'), yaml.dump(configCore, { lineWidth: -1 }));
      const safeEnv = buildEnvJson(
        envVars,
        new Set<string>(),
        microfoxConfig,
        'core',
        { ENVIRONMENT: stage, STAGE: stage, NODE_ENV: stage },
        envFilesRead
      );
      applyWorkersApiKey(safeEnv);
      fs.writeFileSync(path.join(coreDir, 'env.json'), JSON.stringify(safeEnv, null, 2));
    }

    for (const g of selectedGroups) {
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
      if (microfoxConfig) {
        writeMicrofoxJson(path.join(groupDir, 'microfox.json'), microfoxConfig);
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
      // Per-group env: keys referenced by this group's workers, plus config-driven include/exclude.
      const { runtimeKeys: runtimeEnvKeysGroup, buildtimeKeys: buildtimeEnvKeysGroup } =
        await collectEnvUsageForWorkers(workersForGroup.map((w) => w.filePath), process.cwd());
      const referencedEnvKeysGroup = new Set<string>([
        ...Array.from(runtimeEnvKeysGroup),
        ...Array.from(buildtimeEnvKeysGroup),
      ]);
      const safeEnvGroup = buildEnvJson(
        envVars,
        referencedEnvKeysGroup,
        microfoxConfig,
        g,
        { ENVIRONMENT: stage, STAGE: stage, NODE_ENV: stage },
        envFilesRead
      );
      applyWorkersApiKey(safeEnvGroup);
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

    console.log(
      chalk.green(
        `✓ Multi-group build: ${[...(emitCore ? ['core'] : []), ...selectedGroups].join(', ')}`
      )
    );
    return;
  }

  if (targetGroup && targetGroup !== (userGroups[0] || 'default')) {
    console.log(
      chalk.yellow(
        `⚠️  Single-group build (${userGroups[0] || 'default'}): group argument "${targetGroup}" ignored.`
      )
    );
  } else if (skipGroups.size > 0) {
    console.log(chalk.yellow('⚠️  Single-group build: --skip-group ignored (no per-group layout).'));
  }

  const singleGroupServiceNames = Object.fromEntries([...new Set(workers.map(w => w.group || 'default'))].map(g => [g, serviceName]));
  generateWorkersConfigHandler(serverlessDir, workers, serviceName, queues, externalPackages, singleGroupServiceNames);
  generateDocsHandler(serverlessDir, serviceName, stage, region, externalPackages);
  generateTriggerHandler(serverlessDir, serviceName, externalPackages, workers, singleGroupServiceNames);

  for (const queue of queues) {
    generateQueueHandler(serverlessDir, queue, serviceName, externalPackages, workers, singleGroupServiceNames);
  }

  let calleeIds = await collectCalleeWorkerIds(workers, process.cwd());
  calleeIds = mergeQueueCallees(calleeIds, queues, workers);
  const config = generateServerlessConfig(workers, stage, region, envVars, serviceName, calleeIds, queues, { externalPackages, microfoxConfig });

  // Always generate env.json now as serverless.yml relies on it.
  // The env stage follows --stage (default 'prod') — Plan E: the old force-prod override
  // for microfox projects is gone so multi-stage deploys of the same project work.
  const safeEnvVars = buildEnvJson(
    envVars,
    referencedEnvKeys,
    microfoxConfig,
    userGroups[0] ?? null,
    { ENVIRONMENT: stage, STAGE: stage, NODE_ENV: stage },
    envFilesRead
  );
  applyWorkersApiKey(safeEnvVars);

  fs.writeFileSync(
    path.join(serverlessDir, 'env.json'),
    JSON.stringify(safeEnvVars, null, 2)
  );

  const yamlContent = yaml.dump(config, { indent: 2 });
  const yamlPath = path.join(serverlessDir, 'serverless.yml');
  fs.writeFileSync(yamlPath, yamlContent);
  console.log(chalk.green(`✓ Generated serverless.yml: ${yamlPath}`));
}

const attachBuildOptions = (cmd: Command): Command =>
  cmd
    // No commander default: build() falls back to process.env.STAGE, then 'prod',
    // so CI can drive the stage via env without passing the flag.
    .option('-s, --stage <stage>', 'Deployment stage (default: STAGE env var, then "prod")')
    .option('-r, --region <region>', 'AWS region baked into the generated serverless config', 'us-east-1')
    .option('--ai-path <path>', 'Path to the AI directory containing workers', 'app/ai')
    .option(
      '--service-name <name>',
      'Override serverless service name (defaults to ai-router-workers-<stage>)'
    )
    .option(
      '--require-auth',
      'Fail the build if no worker secret (WORKERS_API_KEY / projectId) can be resolved',
      false
    )
    .option(
      '--allow-public',
      'Build worker endpoints as public without a warning when no secret is set',
      false
    )
    .option(
      '--skip-group <groups>',
      'Comma-separated groups to skip building (multi-group layout, e.g. "core,workflows")'
    );

export const compileCommand = attachBuildOptions(new Command())
  .name('compile')
  .description('Compile workers into a deployable build in .serverless-workers (does not deploy)')
  .argument('[group]', 'Compile only this group (multi-group layout, e.g. core, default, workflows)')
  .addHelpText(
    'after',
    `
Output:
  .serverless-workers/            single-group build (serverless.yml + bundled handlers)
  .serverless-workers/<group>/    per-group builds when workers declare multiple groups

Examples:
  $ ai-worker compile
  $ ai-worker compile --ai-path src/ai --stage prod
  $ ai-worker compile core                  compile only the "core" build
  $ ai-worker compile --skip-group core     compile everything except core

Deploying:
  This command only compiles. Deploy the build with the Microfox CLI:
    $ npx microfox@latest deploy    compile + push in one step
    $ npx microfox@latest push      push an already-compiled build
`
  )
  .action(async (group: string | undefined, options: any) => {
    await build({ ...options, group });
    // Config extraction import()s the user's bundled worker code, which may open
    // DB/SDK connections that keep the event loop alive — exit explicitly.
    process.exit(0);
  });

// Deprecated alias. `push` used to build AND deploy (shelling out to `microfox push`
// or `serverless deploy`); deployment now lives exclusively in the Microfox CLI.
// The alias still compiles so older callers — notably published `microfox compile`
// versions that run `ai-worker-cli push --skip-deploy` — keep working.
export const pushCommand = attachBuildOptions(new Command())
  .name('push')
  .description('[deprecated] Use "compile". This alias only compiles and never deploys.')
  .argument('[group]', 'Compile only this group (multi-group layout)')
  .option('--skip-deploy', '(ignored) push no longer deploys', false)
  .option('--skip-install', '(ignored) push no longer deploys', false)
  .option('--skip-core', '(ignored) push no longer deploys', false)
  .action(async (group: string | undefined, options: any) => {
    console.log(chalk.yellow('⚠️  "push" is deprecated: it has been renamed to "compile" and NO LONGER deploys.'));
    await build({ ...options, group });
    if (!options.skipDeploy) {
      console.log(chalk.blue('ℹ️  Nothing was deployed. To deploy: npx microfox@latest push (or "microfox deploy" for compile + push).'));
    }
    // Same as compile: user worker imports can hold the event loop open.
    process.exit(0);
  });
