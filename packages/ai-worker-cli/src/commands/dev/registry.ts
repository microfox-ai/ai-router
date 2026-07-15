/**
 * Dev worker/queue registry: scans the project's `.worker.ts` / `.queue.ts` files
 * (same scanners compile uses) and loads them via jiti — no esbuild bundling step.
 *
 * Hot reload model: a generation counter + a fresh jiti instance per generation.
 * Worker modules are resolved PER INVOCATION, so after any source change the next
 * run of any worker imports fresh code while the server process, in-memory queues,
 * and parked HITL state survive. (Module-level state inside worker files resets on
 * reload — that matches Lambda cold-start semantics anyway.)
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import chalk from 'chalk';
import { createJiti, type Jiti } from 'jiti';
import type { QueueRuntime, QueueNextStep, WorkerHandler } from '@microfox/ai-worker/handler';
import { getQueueJob } from '@microfox/ai-worker/queueJobStore';
import {
  defaultMapChainPassthrough,
  defaultMapChainContinueFromPrevious,
} from '@microfox/ai-worker';
import { scanWorkers, scanQueues, type WorkerInfo, type QueueInfo } from '../compile.js';

/** The createWorker(...) result we invoke (from the user's module, any export slot). */
export interface LoadedWorkerAgent {
  id?: string;
  handler: WorkerHandler<any, any>;
  inputSchema?: unknown;
  outputSchema?: any;
  workerConfig?: Record<string, any>;
}

function looksLikeWorkerAgent(value: unknown): value is LoadedWorkerAgent {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as LoadedWorkerAgent).handler === 'function'
  );
}

/** Find the createWorker export: prefer id match, else the first export with a .handler. */
function findWorkerAgentExport(mod: any, workerId: string): LoadedWorkerAgent | undefined {
  const candidates: unknown[] = [];
  if (mod && typeof mod === 'object') {
    if (mod.default !== undefined) candidates.push(mod.default);
    for (const value of Object.values(mod)) candidates.push(value);
  }
  candidates.push(mod);
  const agents = candidates.filter(looksLikeWorkerAgent);
  return agents.find((a) => a.id === workerId) ?? agents[0];
}

/**
 * tsconfig `paths` → jiti `alias` map so `@/lib/...`-style imports resolve in
 * dev exactly like they do in the esbuild-bundled deploy (esbuild reads the
 * same tsconfig). Naive comment-tolerant parse; wildcard suffixes stripped
 * (jiti aliases are prefix-based). Only the first target of each mapping is used.
 */
function tsconfigAliases(projectRoot: string): Record<string, string> {
  const aliases: Record<string, string> = {};
  try {
    const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) return aliases;
    const raw = fs.readFileSync(tsconfigPath, 'utf-8');
    type TsconfigShape = {
      compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
    };
    let tsconfig: TsconfigShape;
    try {
      // Most tsconfigs are plain JSON — and naive comment-stripping regexes
      // corrupt path patterns like "@/*" / "**/*.ts", so try raw first.
      tsconfig = JSON.parse(raw) as TsconfigShape;
    } catch {
      const stripped = raw
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/,\s*([}\]])/g, '$1');
      tsconfig = JSON.parse(stripped) as TsconfigShape;
    }
    const baseUrl = tsconfig.compilerOptions?.baseUrl ?? '.';
    const paths = tsconfig.compilerOptions?.paths ?? {};
    for (const [pattern, targets] of Object.entries(paths)) {
      const target = targets?.[0];
      if (!target) continue;
      const key = pattern.replace(/\/?\*$/, '');
      const value = path.resolve(projectRoot, baseUrl, target.replace(/\/?\*$/, ''));
      if (key) aliases[key] = value;
    }
  } catch {
    // Malformed tsconfig — skip aliases; plain relative imports still work.
  }
  return aliases;
}

export class DevRegistry {
  workers: WorkerInfo[] = [];
  queues: QueueInfo[] = [];
  generation = 0;

  private jiti: Jiti;
  private queueConfigCache: { generation: number; configs: Map<string, any> } | null = null;
  private schemaCache: { generation: number; schemas: Record<string, unknown> } | null = null;

  /** Sync queue runtime handed to wrapHandlerForQueue — reads the per-generation config cache. */
  readonly queueRuntime: QueueRuntime;

  constructor(
    private projectRoot: string,
    private aiPath: string
  ) {
    this.jiti = this.freshJiti();
    this.queueRuntime = this.buildQueueRuntime();
  }

  private freshJiti(): Jiti {
    return createJiti(pathToFileURL(path.join(this.projectRoot, 'package.json')).href, {
      interopDefault: true,
      moduleCache: true,
      fsCache: true,
      alias: tsconfigAliases(this.projectRoot),
    });
  }

  async scan(): Promise<void> {
    this.workers = await scanWorkers(this.aiPath);
    this.queues = await scanQueues(this.aiPath);
  }

  /** Drop the module graph so the NEXT invocation of any worker imports fresh code. */
  invalidate(reason: string): void {
    this.generation++;
    this.jiti = this.freshJiti();
    this.queueConfigCache = null;
    this.schemaCache = null;
    console.log(
      chalk.dim(`[dev] reload #${this.generation} (${reason}) — next run picks up new code`)
    );
  }

  getWorker(workerId: string): WorkerInfo | undefined {
    return this.workers.find((w) => w.id === workerId);
  }

  getQueue(queueId: string): QueueInfo | undefined {
    return this.queues.find((q) => q.id === queueId);
  }

  isWorkerInQueue(workerId: string): boolean {
    return this.queues.some((q) => q.steps.some((s) => s.workerId === workerId));
  }

  async loadWorkerAgent(workerId: string): Promise<LoadedWorkerAgent> {
    const info = this.getWorker(workerId);
    if (!info) {
      throw new Error(`Unknown worker "${workerId}" (not found under ${this.aiPath})`);
    }
    const absPath = path.resolve(this.projectRoot, info.filePath);
    const mod: any = await this.jiti.import(absPath);
    const agent = findWorkerAgentExport(mod, workerId);
    if (!agent) {
      throw new Error(
        `Worker module ${info.filePath} does not export a createWorker(...) result with a .handler`
      );
    }
    if (agent.id && agent.id !== workerId) {
      console.warn(
        chalk.yellow(
          `⚠️  [dev] ${info.filePath}: scanned id "${workerId}" but module exports id "${agent.id}" — using the module's handler anyway`
        )
      );
    }
    return agent;
  }

  /**
   * Load all queue modules for the current generation so the (synchronous)
   * queue runtime can resolve chain/resume/loop functions. Called by the
   * invoker before each queue-worker invocation; cached per generation.
   */
  async ensureQueueConfigs(): Promise<void> {
    if (this.queueConfigCache?.generation === this.generation) return;
    const configs = new Map<string, any>();
    for (const q of this.queues) {
      try {
        const mod: any = await this.jiti.import(path.resolve(this.projectRoot, q.filePath));
        const cfg = mod?.default ?? mod?.queue ?? mod;
        if (cfg && Array.isArray(cfg.steps)) {
          configs.set(q.id, cfg);
        } else {
          console.warn(
            chalk.yellow(`⚠️  [dev] ${q.filePath}: no defineWorkerQueue export found`)
          );
        }
      } catch (e: any) {
        console.warn(
          chalk.yellow(`⚠️  [dev] Failed to load queue module ${q.filePath}: ${e?.message ?? e}`)
        );
      }
    }
    this.queueConfigCache = { generation: this.generation, configs };
  }

  private moduleStep(queueId: string, stepIndex: number): any | undefined {
    return this.queueConfigCache?.configs.get(queueId)?.steps?.[stepIndex];
  }

  /** Same resolution the generated workerQueues.registry.js performs (static scan + module). */
  private resolveStepData(queueId: string, stepIndex: number): QueueNextStep | undefined {
    const staticStep = this.getQueue(queueId)?.steps?.[stepIndex];
    const moduleStep = this.moduleStep(queueId, stepIndex);
    if (!staticStep && !moduleStep) return undefined;
    const workerId = staticStep?.workerId ?? moduleStep?.workerId;
    if (!workerId) return undefined;
    const hitl = moduleStep?.hitl ?? staticStep?.hitl;
    return {
      workerId,
      delaySeconds: staticStep?.delaySeconds ?? moduleStep?.delaySeconds,
      requiresApproval: staticStep?.requiresApproval ?? (moduleStep?.requiresApproval === true),
      hasChain: staticStep?.hasChain ?? (moduleStep?.chain !== undefined),
      hasResume: staticStep?.hasResume ?? (moduleStep?.resume !== undefined),
      ...(hitl !== undefined ? { hitl } : {}),
      ...(moduleStep?.retry ? { retry: moduleStep.retry } : {}),
    };
  }

  private buildQueueRuntime(): QueueRuntime {
    const self = this;
    return {
      getNextStep(queueId, stepIndex) {
        const staticCount = self.getQueue(queueId)?.steps?.length ?? 0;
        const moduleCount =
          self.queueConfigCache?.configs.get(queueId)?.steps?.length ?? 0;
        const totalSteps = Math.max(staticCount, moduleCount);
        if (stepIndex < 0 || stepIndex >= totalSteps - 1) return undefined;
        return self.resolveStepData(queueId, stepIndex + 1);
      },
      getStepAt(queueId, stepIndex) {
        return self.resolveStepData(queueId, stepIndex);
      },
      invokeChain(queueId, stepIndex, ctx) {
        const chain = self.moduleStep(queueId, stepIndex)?.chain;
        if (typeof chain === 'function') return chain(ctx);
        if (chain === 'passthrough') return defaultMapChainPassthrough(ctx);
        if (chain === 'continueFromPrevious') return defaultMapChainContinueFromPrevious(ctx);
        const prevOutputs = ctx?.previousOutputs ?? [];
        return prevOutputs.length
          ? prevOutputs[prevOutputs.length - 1].output
          : ctx?.initialInput;
      },
      invokeResume(queueId, stepIndex, ctx) {
        const resume = self.moduleStep(queueId, stepIndex)?.resume;
        if (typeof resume === 'function') return resume(ctx);
        const pending = ctx?.pendingInput ?? {};
        const reviewer = ctx?.reviewerInput;
        return {
          ...pending,
          ...(reviewer !== null && typeof reviewer === 'object'
            ? (reviewer as Record<string, unknown>)
            : {}),
        };
      },
      invokeLoop(queueId, stepIndex, ctx) {
        const shouldContinue = self.moduleStep(queueId, stepIndex)?.loop?.shouldContinue;
        if (typeof shouldContinue === 'function') return shouldContinue(ctx);
        return false;
      },
      getQueueJob,
    };
  }

  /**
   * JSON Schemas for /workers/config, converted with the PROJECT's zod (v4
   * `z.toJSONSchema`) — the same zod instance that created the schemas.
   * Best-effort: workers whose schema cannot be converted are omitted.
   */
  async getWorkerSchemas(): Promise<Record<string, unknown>> {
    if (this.schemaCache?.generation === this.generation) return this.schemaCache.schemas;
    const schemas: Record<string, unknown> = {};

    let toJSONSchema: ((schema: unknown) => unknown) | undefined;
    try {
      const req = createRequire(path.join(this.projectRoot, 'package.json'));
      const zodModule: any = req('zod');
      const z = zodModule?.z ?? zodModule;
      if (typeof z?.toJSONSchema === 'function') {
        toJSONSchema = (schema) => z.toJSONSchema(schema);
      }
    } catch {
      // No project zod (or zod v3 without toJSONSchema) — schemas stay empty.
    }

    for (const worker of this.workers) {
      try {
        const agent = await this.loadWorkerAgent(worker.id);
        if (agent.inputSchema && toJSONSchema) {
          schemas[worker.id] = toJSONSchema(agent.inputSchema);
        }
      } catch {
        // Module failed to load — the invocation path will surface the real error.
      }
    }

    this.schemaCache = { generation: this.generation, schemas };
    return schemas;
  }
}
