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
  workerConfig?: {
    timeout?: number;
    memorySize?: number;
    layers?: string[];
    schedule?: any; // Schedule config: string, object, or array of either
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

export function getServiceNameFromProjectId(projectId: string): string {
  const cleanedProjectId = projectId.replace(/-/g, '').slice(0, 15);
  return `p-${cleanedProjectId}`;
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
      if (!workerId) {
        const content = fs.readFileSync(filePath, 'utf-8');
        // Match createWorker with optional type parameters: createWorker<...>({ id: '...' })
        // or createWorker({ id: '...' })
        const idMatch = content.match(/createWorker\s*(?:<[^>]+>)?\s*\(\s*\{[\s\S]*?id:\s*['"]([^'"]+)['"]/);
        if (!idMatch) {
          console.warn(chalk.yellow(`⚠️  Skipping ${filePath}: No worker ID found`));
          continue;
        }
        workerId = idMatch[1];
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
        const stepRegex = /\{\s*workerId:\s*['"]([^'"]+)['"](?:,\s*delaySeconds:\s*(\d+))?(?:,\s*mapInputFromPrev:\s*['"]([^'"]+)['"])?\s*\}/g;
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
      const scheduleStrMatch = content.match(/schedule:\s*['"]([^'"]+)['"]/);
      const scheduleObjMatch = content.match(/schedule:\s*(\{[^}]+(?:\{[^}]*\}[^}]*)*\})/);
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
 */
function generateQueueRegistry(queues: QueueInfo[], outputDir: string, projectRoot: string): void {
  const generatedDir = path.join(outputDir, 'generated');
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }

  const registryContent = `/**
 * Auto-generated queue registry. DO NOT EDIT.
 * Generated by @microfox/ai-worker-cli from .queue.ts files.
 */

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

export function invokeMapInput(_queueId, _stepIndex, prevOutput, _initialInput) {
  return prevOutput;
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
  queues: QueueInfo[] = []
): Promise<void> {
  const handlersDir = path.join(outputDir, 'handlers');
  const workersInQueues = getWorkersInQueues(queues);

  // Ensure handlers directory exists and is clean
  if (fs.existsSync(handlersDir)) {
    fs.rmSync(handlersDir, { recursive: true, force: true });
  }
  fs.mkdirSync(handlersDir, { recursive: true });

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
};
const wrappedHandler = wrapHandlerForQueue(workerAgent.handler, queueRuntime);

const baseHandler = createLambdaHandler(wrappedHandler, workerAgent.outputSchema);

export const handler = async (event: any, context: any) => {
  const records = Array.isArray((event as any)?.Records) ? (event as any).Records.length : 0;
  try {
    console.log(WORKER_LOG_PREFIX, {
      workerId: workerAgent.id,
      inQueue: true,
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
        // We exclude aws-sdk as it's included in Lambda runtime
        // We exclude canvas because it's a binary dependency often problematic in bundling
        external: [
          'aws-sdk',
          'canvas',
          '@microfox/puppeteer-sls',
          "@sparticuz/chromium"
        ],
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

function generateDocsHandler(outputDir: string, serviceName: string, stage: string, region: string): void {
  const handlerFile = path.join(outputDir, 'handlers', 'docs.js');
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
  esbuild.buildSync({
    entryPoints: [tempEntryFile],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: handlerFile,
    external: [
      'aws-sdk',
      'canvas',
      '@microfox/puppeteer-sls',
      "@sparticuz/chromium"
    ],
    define: {
      'process.env.UNLAZY': '"true"',
    },
    packages: 'bundle'
  });

  fs.unlinkSync(tempEntryFile);
  console.log(chalk.green(`✓ Generated docs.json handler`));
}

function generateTriggerHandler(outputDir: string, serviceName: string): void {
  const handlerFile = path.join(outputDir, 'handlers', 'workers-trigger.js');
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

  const queueName = \`\${SERVICE_NAME}-\${workerId}-\${stage}\`;
  const sqs = new SQSClient({ region });

  let queueUrl: string;
  try {
    const urlRes = await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }));
    if (!urlRes.QueueUrl) {
      return jsonResponse(404, { error: 'Queue URL not found', queueName });
    }
    queueUrl = String(urlRes.QueueUrl);
  } catch (e: any) {
    return jsonResponse(404, { error: 'Queue does not exist or not accessible', queueName, message: String(e?.message || e) });
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

  esbuild.buildSync({
    entryPoints: [tempEntryFile],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: handlerFile,
    external: [
      'aws-sdk',
      'canvas',
      '@microfox/puppeteer-sls',
      "@sparticuz/chromium"
    ],
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
 * Generates queue-starter Lambda for a scheduled queue.
 * When the schedule fires, it sends the first worker a message with __workerQueue context.
 */
function generateQueueStarterHandler(
  outputDir: string,
  queue: QueueInfo,
  serviceName: string
): void {
  const safeId = queue.id.replace(/[^a-zA-Z0-9]/g, '');
  const handlerFile = path.join(outputDir, 'handlers', `queue-starter-${safeId}.js`);
  const tempEntryFile = handlerFile.replace('.js', '.temp.ts');
  const handlerDir = path.dirname(handlerFile);

  if (!fs.existsSync(handlerDir)) {
    fs.mkdirSync(handlerDir, { recursive: true });
  }

  const firstWorkerId = queue.steps[0]?.workerId;
  if (!firstWorkerId) return;

  const handlerContent = `/**
 * Auto-generated queue-starter for queue "${queue.id}"
 * DO NOT EDIT - This file is generated by @microfox/ai-worker-cli
 */

import { ScheduledHandler } from 'aws-lambda';
import { SQSClient, GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs';

const QUEUE_ID = ${JSON.stringify(queue.id)};
const FIRST_WORKER_ID = ${JSON.stringify(firstWorkerId)};
const SERVICE_NAME = ${JSON.stringify(serviceName)};

export const handler: ScheduledHandler = async () => {
  const stage = process.env.ENVIRONMENT || process.env.STAGE || 'prod';
  const region = process.env.AWS_REGION || 'us-east-1';
  const queueName = \`\${SERVICE_NAME}-\${FIRST_WORKER_ID}-\${stage}\`;

  const sqs = new SQSClient({ region });
  const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }));
  if (!QueueUrl) {
    throw new Error('Queue URL not found: ' + queueName);
  }

  const jobId = 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2, 11);
  const initialInput = {};
  const messageBody = {
    workerId: FIRST_WORKER_ID,
    jobId,
    input: {
      ...initialInput,
      __workerQueue: { id: QUEUE_ID, stepIndex: 0, initialInput },
    },
    context: {},
    metadata: { __workerQueue: { id: QUEUE_ID, stepIndex: 0, initialInput } },
    timestamp: new Date().toISOString(),
  };

  await sqs.send(new SendMessageCommand({
    QueueUrl,
    MessageBody: JSON.stringify(messageBody),
  }));

  console.log('[queue-starter] Dispatched first worker for queue:', { queueId: QUEUE_ID, jobId, workerId: FIRST_WORKER_ID });
};
`;

  fs.writeFileSync(tempEntryFile, handlerContent);
  esbuild.buildSync({
    entryPoints: [tempEntryFile],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: handlerFile,
    external: ['aws-sdk', 'canvas', '@microfox/puppeteer-sls', '@sparticuz/chromium'],
    packages: 'bundle',
    logLevel: 'error',
  });
  fs.unlinkSync(tempEntryFile);
  console.log(chalk.green(`✓ Generated queue-starter for ${queue.id}`));
}

/**
 * Generates workers-config Lambda handler.
 */
function generateWorkersConfigHandler(
  outputDir: string,
  workers: WorkerInfo[],
  serviceName: string,
  queues: QueueInfo[] = []
): void {
  // We'll bundle this one too
  const handlerFile = path.join(outputDir, 'handlers', 'workers-config.js');
  const tempEntryFile = handlerFile.replace('.js', '.temp.ts');
  const handlerDir = path.dirname(handlerFile);

  // Ensure handlers directory exists and is clean for config handler
  if (fs.existsSync(handlerDir) && !fs.existsSync(handlerFile)) {
    // Don't wipe if we already cleaned it in generateHandlers, unless it's a diff dir
  } else if (!fs.existsSync(handlerDir)) {
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
  esbuild.buildSync({
    entryPoints: [tempEntryFile],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: handlerFile,
    external: [
      'aws-sdk',
      'canvas',
      '@microfox/puppeteer-sls',
      "@sparticuz/chromium"
    ],
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
  queues: QueueInfo[] = []
): ServerlessConfig {
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
    const functionName = `worker${worker.id.replace(/[^a-zA-Z0-9]/g, '')}`;

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
        }
      }
      if (Object.keys(env).length > 0) {
        functions[functionName].environment = env;
      }
    }
  }

  // Add docs.json function for Microfox compatibility
  functions['getDocs'] = {
    handler: 'handlers/docs.handler',
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

  // Add workers trigger endpoint (HTTP -> SQS SendMessage)
  functions['triggerWorker'] = {
    handler: 'handlers/workers-trigger.handler',
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

  // Add workers-config function
  functions['workersConfig'] = {
    handler: 'handlers/workers-config.handler',
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

  // Add queue-starter functions for scheduled queues
  for (const queue of queues) {
    if (queue.schedule) {
      const safeId = queue.id.replace(/[^a-zA-Z0-9]/g, '');
      const fnName = `queueStarter${safeId}`;
      const scheduleEvents = processScheduleEvents(queue.schedule);
      functions[fnName] = {
        handler: `handlers/queue-starter-${safeId}.handler`,
        timeout: 60,
        memorySize: 128,
        events: scheduleEvents,
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

  // Add ApiEndpoints output for Microfox
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

  return {
    service: serviceName,
    package: {
      excludeDevDependencies: true,
      individually: true,
      // Handlers are fully bundled by esbuild (packages: 'bundle'); exclude node_modules to stay under Lambda 250 MB limit
      patterns: [
        '!venv/**',
        '!.idea/**',
        '!.vscode/**',
        '!src/**',
        '!node_modules/**',
        '!node_modules/serverless-offline/**',
        '!node_modules/typescript/**',
        '!node_modules/@types/**',
        '!node_modules/aws-sdk/**',
        '!node_modules/@aws-sdk/**'
      ],
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
  if (!fs.existsSync(serverlessDir)) {
    fs.mkdirSync(serverlessDir, { recursive: true });
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

  // Check for microfox.json to customize service name
  const microfoxJsonPath = path.join(process.cwd(), 'microfox.json');
  if (fs.existsSync(microfoxJsonPath)) {
    try {
      const microfoxConfig = JSON.parse(fs.readFileSync(microfoxJsonPath, 'utf-8'));
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
  await generateHandlers(workers, serverlessDir, queues);

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
            if (module.exportedWorkerConfig.layers?.length) {
              console.log(chalk.gray(`  ✓ ${worker.id}: found ${module.exportedWorkerConfig.layers.length} layer(s)`));
            }
          } else {
            console.warn(chalk.yellow(`  ⚠ ${worker.id}: exportedWorkerConfig not found in handler`));
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
              if (configObj && (configObj.layers || configObj.timeout || configObj.memorySize || configObj.schedule)) {
                worker.workerConfig = configObj;
                if (configObj.layers?.length) {
                  console.log(chalk.gray(`  ✓ ${worker.id}: found ${configObj.layers.length} layer(s) from source file`));
                }
                if (configObj.schedule) {
                  console.log(chalk.gray(`  ✓ ${worker.id}: found schedule configuration`));
                }
              }
            }
          } catch (fallbackError) {
            // If fallback also fails, just log and continue
            console.warn(chalk.yellow(`  ⚠ ${worker.id}: fallback extraction also failed, using defaults`));
          }
        }
      } else {
        console.warn(chalk.yellow(`  ⚠ ${worker.id}: handler file not found: ${handlerFile}`));
      }
    } catch (error: any) {
      // If everything fails, workerConfig will remain undefined (fallback to defaults)
      console.warn(chalk.yellow(`  ⚠ ${worker.id}: failed to extract config: ${error?.message || error}`));
    }
  }
  extractSpinner.succeed('Extracted configs');

  generateWorkersConfigHandler(serverlessDir, workers, serviceName, queues);
  generateDocsHandler(serverlessDir, serviceName, stage, region);
  generateTriggerHandler(serverlessDir, serviceName);

  for (const queue of queues) {
    if (queue.schedule) {
      generateQueueStarterHandler(serverlessDir, queue, serviceName);
    }
  }

  let calleeIds = await collectCalleeWorkerIds(workers, process.cwd());
  calleeIds = mergeQueueCallees(calleeIds, queues, workers);
  const config = generateServerlessConfig(workers, stage, region, envVars, serviceName, calleeIds, queues);

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

  if (!fs.existsSync(yamlPath)) {
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

      // Copy microfox.json to .serverless-workers directory
      fs.copyFileSync(microfoxJsonPath, path.join(serverlessDir, 'microfox.json'));

      // Load and filter environment variables
      const envVars = loadEnvVars();
      // env.json is already generated by build()

      execSync('npx microfox@latest push', {
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
  .action(async (options) => {
    await build(options);
    await deploy(options);
  });

