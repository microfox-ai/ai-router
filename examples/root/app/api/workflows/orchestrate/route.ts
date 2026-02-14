import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { start } from 'workflow/api';
import { orchestrateWorkflowFn } from '../workflows/orchestrateWorkflow';
import type { OrchestrationConfig, OrchestrationStep, OrchestrationContext } from '@microfox/ai-workflow';
import { prepareOrchestrationConfig } from '@microfox/ai-workflow';
import { workflowStatusStore } from '../stores/workflowStatusStore';
import { generateDebugWorkflowContent } from './debugWorkflow';

/**
 * Build a JSON-safe snapshot of workflow config + details for storage in metadata.
 * Strips functions and non-serializable values.
 */
function buildMetadataFromConfig(
  config: OrchestrationConfig,
  options: { workflowId: string; baseUrl: string; executionId: string; hookTokens?: Record<string, string> }
): Record<string, unknown> {
  const sanitize = (v: unknown): unknown => {
    if (v === null || v === undefined) return v;
    if (typeof v === 'function') return undefined;
    if (typeof v === 'symbol' || typeof v === 'bigint') return undefined;
    if (Array.isArray(v)) return v.map(sanitize).filter((x) => x !== undefined);
    if (typeof v === 'object' && v !== null) {
      const obj = v as Record<string, unknown>;
      if (obj.constructor?.name === 'ZodObject' || obj.constructor?.name === 'ZodType') return undefined;
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(obj)) {
        if (k.startsWith('_')) continue; // skip _ifIsFunction, _tokenIsFunction, etc.
        if (k === 'schema') continue; // zod schema
        const s = sanitize(val);
        if (s !== undefined) out[k] = s;
      }
      return Object.keys(out).length ? out : undefined;
    }
    return v;
  };

  const sanitizeStep = (step: OrchestrationStep): unknown => {
    const raw: Record<string, unknown> = { type: step.type };
    if ('id' in step && step.id != null) raw.id = step.id;
    if ('agent' in step && step.agent) raw.agent = step.agent;
    if ('worker' in step && step.worker) raw.worker = step.worker;
    if ('workflow' in step && step.workflow) raw.workflow = step.workflow;
    if ('token' in step && typeof (step as any).token === 'string') raw.token = (step as any).token;
    if ('duration' in step) raw.duration = (step as any).duration;
    if ('await' in step && (step as any).await != null) raw.await = (step as any).await;
    if ('if' in step) {
      const iff = (step as any).if;
      if (typeof iff !== 'function') raw.if = sanitize(iff);
    }
    if ('input' in step && typeof (step as any).input !== 'function') raw.input = sanitize((step as any).input);
    if ('steps' in step && Array.isArray((step as any).steps))
      raw.steps = (step as any).steps.map(sanitizeStep);
    if ('then' in step && Array.isArray((step as any).then))
      raw.then = (step as any).then.map(sanitizeStep);
    if ('else' in step && Array.isArray((step as any).else))
      raw.else = (step as any).else.map(sanitizeStep);
    return raw;
  };

  return {
    workflowId: options.workflowId,
    baseUrl: options.baseUrl,
    executionId: options.executionId,
    stepCount: config.steps.length,
    steps: config.steps.map(sanitizeStep),
    hookTimeout: config.hookTimeout,
    continueOnError: config.continueOnError,
    timeout: config.timeout,
    input: sanitize(config.input) ?? {},
    hookTokenKeys: options.hookTokens ? Object.keys(options.hookTokens) : [],
  };
}

/**
 * Pre-resolve functions in config before serialization
 * Since Vercel workflows can't serialize functions, we evaluate them here
 * with a mock context to get string values
 */
function preResolveFunctions(config: OrchestrationConfig): OrchestrationConfig {
  const mockContext: OrchestrationContext = {
    input: config.input || {},
    steps: {},
    previous: null,
    all: [],
  };
  
  const resolveStep = (step: OrchestrationStep): OrchestrationStep => {
    const resolved: any = { ...step };
    
    // Pre-resolve token functions to strings
    if ('token' in step && typeof step.token === 'function') {
      try {
        resolved.token = step.token(mockContext);
      } catch {
        // If resolution fails, keep as function (will fail later with clear error)
        console.warn('[Orchestrate] Failed to pre-resolve hook token function');
      }
    }
    
    // Pre-resolve input functions
    if ('input' in step && typeof step.input === 'function') {
      try {
        resolved.input = step.input(mockContext);
      } catch {
        // If resolution fails, keep as function (will fail later with clear error)
        console.warn('[Orchestrate] Failed to pre-resolve input function');
      }
    }
    
    // Condition functions cannot be pre-resolved (they need runtime context)
    // Remove them from the config and mark them for runtime error
    if ('if' in step && typeof step.if === 'function') {
      console.warn('[Orchestrate] Condition functions cannot be serialized. Removing from config - workflow will fail at runtime with clear error.');
      resolved._ifIsFunction = true; // Mark that the function was removed
      delete resolved.if; // Remove the function to allow serialization
    }
    
    // Recursively resolve nested steps
    if ('steps' in step && Array.isArray(step.steps)) {
      resolved.steps = step.steps.map(resolveStep);
    }
    
    if ('then' in step && Array.isArray(step.then)) {
      resolved.then = step.then.map(resolveStep);
    }
    
    if ('else' in step && Array.isArray(step.else)) {
      resolved.else = step.else.map(resolveStep);
    }
    
    return resolved;
  };
  
  return {
    ...config,
    steps: config.steps.map(resolveStep),
  };
}

/**
 * Orchestration workflow endpoint.
 * 
 * POST /api/workflows/orchestrate
 * 
 * Starts an orchestration workflow using Vercel workflows.
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { config: rawConfig, executionId, hookTokens, messages, input } = body;

    if (!rawConfig || typeof rawConfig !== 'object') {
      return NextResponse.json(
        { error: 'config is required in request body (workflow config object)' },
        { status: 400 }
      );
    }

    if (!executionId) {
      return NextResponse.json(
        { error: 'executionId is required in request body' },
        { status: 400 }
      );
    }

    const workflowId = rawConfig.id ?? 'workflow';

    if (!rawConfig.steps || !Array.isArray(rawConfig.steps) || rawConfig.steps.length === 0) {
      return NextResponse.json(
        { error: 'config.steps must be a non-empty array' },
        { status: 400 }
      );
    }

    const workflowConfig = prepareOrchestrationConfig(rawConfig);

    const { validateOrchestrationConfig } = await import('./validation');
    const validationErrors = validateOrchestrationConfig(workflowConfig);

    if (validationErrors.length > 0) {
      return NextResponse.json(
        { error: 'Invalid orchestration config', details: validationErrors },
        { status: 400 }
      );
    }

    const baseUrl = req.nextUrl.origin;
    const workerTriggerBaseUrl =
      process.env.WORKER_BASE_URL ||
      process.env.WORKERS_CONFIG_API_URL;
    const raw = process.env.WORKFLOW_APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
    const workerCallbackBaseUrl =
      typeof raw === 'string' && raw.trim() ? raw.trim().replace(/\/+$/, '') : undefined;

    const orchestrationConfig: OrchestrationConfig = {
      ...workflowConfig,
      id: workflowId,
      input: {
        ...(input ?? workflowConfig.input ?? {}),
        workflowId,
        executionId,
        hookTokens: hookTokens ?? {},
      },
      messages: messages ?? workflowConfig.messages ?? [],
    };

    // Pre-resolve functions before serialization (Vercel workflows can't serialize functions)
    const resolvedConfig = preResolveFunctions(orchestrationConfig);

    if (process.env.DEBUG_WORKER === 'true') {
      try {
        const dir = path.join(process.cwd(), '.workflows');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `debug-${workflowId}-${executionId}.ts`);
        const content = generateDebugWorkflowContent(resolvedConfig, workflowId, executionId);
        fs.writeFileSync(file, content, 'utf-8');
      } catch (e: any) {
        console.warn('[Orchestrate] DEBUG_WORKER: failed to write debug file:', e?.message || e);
      }
    }

    // Start Vercel workflow
    // Note: We can't pass runId in input because we don't have it until after start() returns
    // The workflow will get runId from the status store using executionId
    const run = await start(orchestrateWorkflowFn, [{
      config: resolvedConfig,
      baseUrl: `${baseUrl}/api/studio/chat/agent`,
      workerTriggerBaseUrl: workerTriggerBaseUrl?.trim().replace(/\/+$/, '') || undefined,
      workerCallbackBaseUrl: workerCallbackBaseUrl || undefined,
    }]);

    // Single status record per workflow. executionId is stored on it; run-id API looks up
    // runId via getRunIdByExecutionId (Mongo: query by executionId; memory: lightweight mapping).
    // Persist workflow config snapshot and other details in metadata (JSON-safe, no functions).
    try {
      const metadata = buildMetadataFromConfig(orchestrationConfig, {
        workflowId,
        baseUrl,
        executionId,
        hookTokens: hookTokens || undefined,
      });
      await workflowStatusStore.setStatus(run.runId, {
        runId: run.runId,
        executionId,
        status: 'running',
        metadata: metadata as Record<string, any>,
      });
    } catch (dbError: any) {
      console.error('[Orchestrate] Failed to save initial status:', dbError?.message);
      // Don't fail workflow start if DB save fails
    }

    // Get initial status
    let status: string = 'pending';
    try {
      status = await run.status;
    } catch {
      // Use default status if unable to get it
    }

    // Get result if workflow completed synchronously
    let result: any;
    if (status === 'completed') {
      try {
        result = await run.returnValue;
      } catch {
        // Result not available yet
      }
    }

    return NextResponse.json({
      runId: run.runId,
      status,
      result,
      hook: status === 'paused' ? {} : undefined,
    });
  } catch (error: any) {
    console.error('[Orchestrate] Error starting orchestration:', {
      error: error?.message || String(error),
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
    return NextResponse.json(
      { 
        error: error?.message || String(error),
        stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
      },
      { status: 500 }
    );
  }
}

