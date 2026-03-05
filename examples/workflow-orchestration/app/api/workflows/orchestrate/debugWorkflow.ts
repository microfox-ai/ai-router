/**
 * DEBUG_WORKER: generates a .ts file with **actual JS code** that expands
 * "use workflow" / "use step" functions, shows step order, and how outputs
 * are passed to next steps. Not pseudo-code.
 */

import type { OrchestrationConfig, OrchestrationStep } from '@microfox/ai-workflow';

const INDENT = '  ';

function sanitizeId(id: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(id) ? id : `step_${id.replace(/-/g, '_')}`;
}

function jsonLiteral(obj: unknown): string {
  return JSON.stringify(obj, null, 0);
}

/** Simple code buffer with indent. */
class CodeBuffer {
  lines: string[] = [];
  level = 0;

  line(s = '') {
    this.lines.push(INDENT.repeat(this.level) + s);
  }

  indent() {
    this.level++;
  }

  dedent() {
    this.level = Math.max(0, this.level - 1);
  }

  blank() {
    this.lines.push('');
  }

  result(): string {
    return this.lines.join('\n');
  }
}

function emitStepFunctions(buf: CodeBuffer) {
  buf.line('/** Step functions (each is "use step" in real runtime) */');
  buf.blank();

  buf.line('async function getRunIdFromExecutionId(input) {');
  buf.indent();
  buf.line('"use step";');
  buf.line('const { apiBaseUrl, executionId } = input;');
  buf.line('const res = await fetch(`${apiBaseUrl}/api/workflows/orchestrate/run-id/${executionId}`, { method: "GET", headers: { "Content-Type": "application/json" } });');
  buf.line('if (!res.ok) throw new Error(`getRunId failed: ${res.status}`);');
  buf.line('const data = await res.json();');
  buf.line('return data.runId;');
  buf.dedent();
  buf.line('}');
  buf.blank();

  buf.line('async function updateWorkflowStatus(input) {');
  buf.indent();
  buf.line('"use step";');
  buf.line('const { apiBaseUrl, runId, status, hookToken, error, result } = input;');
  buf.line('await fetch(`${apiBaseUrl}/api/workflows/orchestrate/${runId}/update`, {');
  buf.indent();
  buf.line('method: "POST",');
  buf.line('headers: { "Content-Type": "application/json" },');
  buf.line('body: JSON.stringify({ status, hookToken, error, result }),');
  buf.dedent();
  buf.line('});');
  buf.line('return { success: true };');
  buf.dedent();
  buf.line('}');
  buf.blank();

  buf.line('async function callAgentStep(input) {');
  buf.indent();
  buf.line('"use step";');
  buf.line('const { agentPath, agentInput, baseUrl, messages } = input;');
  buf.line('const url = `${baseUrl}${agentPath.startsWith("/") ? agentPath : "/" + agentPath}`;');
  buf.line('const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages, input: agentInput, params: agentInput }) });');
  buf.line('if (!res.ok) throw new Error(`callAgentStep failed: ${res.status}`);');
  buf.line('const uiMessages = await res.json();');
  buf.line('// extractAgentResult(uiMessages) in real impl');
  buf.line('return uiMessages;');
  buf.dedent();
  buf.line('}');
  buf.blank();

  buf.line('async function callWorkflowStep(input) {');
  buf.indent();
  buf.line('"use step";');
  buf.line('const { workflowPath, workflowInput, baseUrl, messages } = input;');
  buf.line('const apiPath = baseUrl.replace(/\\/api\\/studio\\/chat\\/agent\\/?$/, "") + "/api/workflows" + (workflowPath.startsWith("/") ? workflowPath : "/" + workflowPath);');
  buf.line('const res = await fetch(apiPath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: workflowInput, messages }) });');
  buf.line('if (!res.ok) throw new Error(`callWorkflowStep failed: ${res.status}`);');
  buf.line('const data = await res.json();');
  buf.line('return { runId: data.runId, status: data.status };');
  buf.dedent();
  buf.line('}');
  buf.blank();

  buf.line('async function callWorkerStep(input) {');
  buf.indent();
  buf.line('"use step";');
  buf.line('const { workerId, workerInput, workerTriggerBaseUrl } = input;');
  buf.line('const base = workerTriggerBaseUrl.replace(/\\/workers\\/(trigger|config)\\/?$/, "").replace(/\\/+$/, "");');
  buf.line('const triggerUrl = `${base}/workers/trigger`;');
  buf.line('const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;');
  buf.line('const body = { workerId, jobId, input: workerInput ?? {}, context: {}, metadata: { source: "workflow-orchestration" }, timestamp: new Date().toISOString() };');
  buf.line('const res = await fetch(triggerUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workerId, body }) });');
  buf.line('if (!res.ok) throw new Error(`callWorkerStep failed: ${res.status}`);');
  buf.line('const data = await res.json();');
  buf.line('return { jobId, status: "queued", messageId: data?.messageId ?? `trigger-${jobId}` };');
  buf.dedent();
  buf.line('}');
  buf.blank();

  buf.line('async function pollWorkerJobStep(input) {');
  buf.indent();
  buf.line('"use step";');
  buf.line('const { baseUrl, workerId, jobId } = input;');
  buf.line('const url = `${baseUrl.replace(/\\/+$/, "")}/api/workflows/workers/${workerId}/${jobId}`;');
  buf.line('const res = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });');
  buf.line('if (res.status === 404) return { done: false, status: "queued" };');
  buf.line('if (!res.ok) return { done: false, status: "error", error: { message: `${res.status} ${res.statusText}` } };');
  buf.line('const job = await res.json();');
  buf.line('const s = job.status ?? "queued";');
  buf.line('if (s === "completed") return { done: true, status: s, output: job.output, metadata: job.metadata };');
  buf.line('if (s === "failed") return { done: true, status: "failed", error: job.error };');
  buf.line('return { done: false, status: s };');
  buf.dedent();
  buf.line('}');
  buf.blank();
}

function emitEvaluateCondition(buf: CodeBuffer) {
  buf.line('function evaluateStepFieldCondition(cond, ctx) {');
  buf.indent();
  buf.line('const raw = ctx.steps[cond.stepId];');
  buf.line('const path = cond.path;');
  buf.line('const v = !path ? raw : path.split(".").reduce((o, k) => o?.[k], raw);');
  buf.line('switch (cond.op) {');
  buf.line('case "eq": return v === cond.value;');
  buf.line('case "neq": return v !== cond.value;');
  buf.line('case "truthy": return !!v;');
  buf.line('case "falsy": return !v;');
  buf.line('case "exists": return v !== undefined && v !== null;');
  buf.line('case "notExists": return v === undefined || v === null;');
  buf.line('default: return false;');
  buf.line('}');
  buf.dedent();
  buf.line('}');
  buf.blank();
}

/** Emit input resolution; optionally emit a block. Returns expression to use. */
function emitWorkflowInput(
  step: any,
  contextVar: string,
  buf: CodeBuffer,
  outVar: string,
  _kind: 'agent' | 'worker' | 'workflow'
): string {
  if (step.input === undefined || step.input === null) {
    buf.line(`const ${outVar} = ${contextVar}.previous ?? ${contextVar}.input;`);
    return outVar;
  }
  if (typeof step.input === 'function') {
    buf.line(`const ${outVar} = ${contextVar}.previous ?? ${contextVar}.input; // resolveInput pre-resolved`);
    return outVar;
  }
  const raw = step.input;
  if (raw && typeof raw === 'object' && Array.isArray(raw._fromSteps)) {
    const path = raw._path ?? 'content';
    const stepIds = (raw._fromSteps as string[]).map((s) => JSON.stringify(s)).join(', ');
    const rest: Record<string, unknown> = { ...raw };
    delete rest._fromSteps;
    delete rest._path;
    const restJson = Object.keys(rest).length ? jsonLiteral(rest) : '{}';
    buf.line(`const _raw = { _fromSteps: [${stepIds}], _path: ${jsonLiteral(path)}, ...${restJson} };`);
    buf.line(`const _ids = _raw._fromSteps;`);
    buf.line(`const _p = _raw._path ?? "content";`);
    buf.line(`const _data = _ids.map(id => { const s = ${contextVar}.steps[id]; const v = !_p ? s : (_p.split(".").reduce((o, k) => o?.[k], s)); return typeof v === "string" ? v : v != null ? JSON.stringify(v) : null; }).filter(Boolean);`);
    buf.line(`const ${outVar} = { ..._raw }; delete ${outVar}._fromSteps; delete ${outVar}._path; ${outVar}.data = _data;`);
    return outVar;
  }
  buf.line(`const ${outVar} = ${jsonLiteral(step.input)};`);
  return outVar;
}

function emitWorkflowBody(
  config: OrchestrationConfig,
  buf: CodeBuffer,
  baseUrlVar: string,
  apiBaseUrlVar: string,
  workerTriggerBaseUrlVar: string,
  nextJsBaseUrlVar: string,
  messagesVar: string,
  contextVar: string,
  runIdVar: string
) {
  buf.line(`const ${contextVar} = { input: { ...(config.input ?? {}), ${runIdVar} }, steps: {}, previous: null, all: [], ${runIdVar}, errors: config.continueOnError ? [] : undefined };`);
  buf.blank();

  for (const step of config.steps) {
    emitStepExpanded(step as OrchestrationStep, config, buf, {
      baseUrlVar,
      apiBaseUrlVar,
      workerTriggerBaseUrlVar,
      nextJsBaseUrlVar,
      messagesVar,
      contextVar,
      runIdVar,
    });
  }

  buf.line(`if (${runIdVar}) {`);
  buf.indent();
  buf.line(`await updateWorkflowStatus({ apiBaseUrl: ${apiBaseUrlVar}, runId: ${runIdVar}, status: "completed", result: ${contextVar}.previous });`);
  buf.dedent();
  buf.line('}');
  buf.line(`return { context: ${contextVar}, result: ${contextVar}.previous };`);
}

interface EmitCtx {
  baseUrlVar: string;
  apiBaseUrlVar: string;
  workerTriggerBaseUrlVar: string;
  nextJsBaseUrlVar: string;
  messagesVar: string;
  contextVar: string;
  runIdVar: string;
}

function emitStepExpanded(
  step: OrchestrationStep,
  config: OrchestrationConfig,
  buf: CodeBuffer,
  ctx: EmitCtx
): void {
  const {
    baseUrlVar,
    apiBaseUrlVar,
    workerTriggerBaseUrlVar,
    nextJsBaseUrlVar,
    messagesVar,
    contextVar,
    runIdVar,
  } = ctx;
  const id = (step as any).id;
  const varName = id ? sanitizeId(id) : null;

  switch (step.type) {
    case '_statusUpdate': {
      const status = (step as any).status as string;
      buf.line(`// _statusUpdate -> updateWorkflowStatus | status: ${status}`);
      buf.line(`if (${runIdVar}) await updateWorkflowStatus({ apiBaseUrl: ${apiBaseUrlVar}, runId: ${runIdVar}, status: ${jsonLiteral(status)} });`);
      buf.blank();
      return;
    }

    case 'agent': {
      const agent = (step as any).agent as string;
      const awaitMode = (step as any).await !== false;
      buf.line(`// agent ${id ?? ''} ${agent} -> ${awaitMode ? 'callAgentStep' : 'callWorkflowStep'} (use step)`);
      const inputVar = emitWorkflowInput(step, contextVar, buf, '_agentInput', 'agent');
      if (awaitMode) {
        buf.line(`let _agentOut = await callAgentStep({ agentPath: ${jsonLiteral(agent)}, agentInput: ${inputVar}, baseUrl: ${baseUrlVar}, messages: ${messagesVar}, await: true });`);
      } else {
        buf.line(`let _agentOut = await callWorkflowStep({ workflowPath: ${jsonLiteral(agent)}, workflowInput: ${inputVar}, baseUrl: ${baseUrlVar}, messages: ${messagesVar} });`);
        buf.line(`_agentOut = { runId: _agentOut.runId, status: _agentOut.status };`);
      }
      buf.line(`if (${varName != null ? jsonLiteral(id) : 'false'}) ${contextVar}.steps[${varName != null ? jsonLiteral(id) : '"_"'}] = _agentOut;`);
      buf.line(`${contextVar}.previous = _agentOut;`);
      buf.line(`${contextVar}.all.push(_agentOut);`);
      buf.blank();
      return;
    }

    case 'hook': {
      const token = typeof (step as any).token === 'string' ? (step as any).token : '""';
      buf.line(`// hook ${id ?? ''} -> defineHook (workflow) | token: ${jsonLiteral(token)}`);
      buf.line(`const _hookToken = ${id ? `${contextVar}.input?.hookTokens?.[${jsonLiteral(id)}] ?? ` : ''}${jsonLiteral(token)};`);
      buf.line(`if (${runIdVar}) await updateWorkflowStatus({ apiBaseUrl: ${apiBaseUrlVar}, runId: ${runIdVar}, status: "paused", hookToken: _hookToken });`);
      buf.line(`const { defineHook } = await import("workflow");`);
      buf.line(`const _hook = defineHook({ schema: (await import("zod")).z.any() }).create({ token: _hookToken });`);
      buf.line(`const _hookPayload = await _hook;`);
      buf.line(`const _hookOut = { token: _hookToken, payload: _hookPayload };`);
      buf.line(`if (${varName != null ? jsonLiteral(id) : 'false'}) ${contextVar}.steps[${varName != null ? jsonLiteral(id) : '"_"'}] = _hookOut;`);
      buf.line(`${contextVar}.previous = _hookOut;`);
      buf.line(`${contextVar}.all.push(_hookOut);`);
      buf.blank();
      return;
    }

    case 'sleep': {
      const dur = (step as any).duration;
      buf.line(`// sleep -> sleep (workflow) | duration: ${jsonLiteral(dur)}`);
      buf.line(`const { sleep } = await import("workflow");`);
      buf.line(`await sleep(${typeof dur === 'number' ? dur : jsonLiteral(dur)});`);
      buf.line(`${contextVar}.previous = { slept: ${jsonLiteral(dur)} };`);
      buf.line(`${contextVar}.all.push(${contextVar}.previous);`);
      buf.blank();
      return;
    }

    case 'condition': {
      const iff = (step as any).if;
      let condExpr: string;
      if (iff && typeof iff === 'object' && (iff as any).type === 'stepField') {
        const c = iff as { stepId: string; path?: string; op: string; value?: unknown };
        condExpr = `evaluateStepFieldCondition(${jsonLiteral(iff)}, ${contextVar})`;
      } else if (typeof iff === 'boolean') {
        condExpr = jsonLiteral(iff);
      } else {
        condExpr = 'false';
      }
      const thenSteps = (step as any).then as OrchestrationStep[];
      const elseSteps = ((step as any).else as OrchestrationStep[]) ?? [];
      buf.line(`// condition | whenStep / ${condExpr}`);
      buf.line(`if (${condExpr}) {`);
      buf.indent();
      for (const s of thenSteps) emitStepExpanded(s, config, buf, ctx);
      buf.dedent();
      buf.line('} else {');
      buf.indent();
      for (const s of elseSteps) emitStepExpanded(s, config, buf, ctx);
      buf.dedent();
      buf.line('}');
      buf.blank();
      return;
    }

    case 'parallel': {
      const steps = (step as any).steps as OrchestrationStep[];
      const vars = steps.map((s, i) => {
        const lid = (s as any).id;
        return lid ? sanitizeId(lid) : `_p${i}`;
      });
      buf.line(`// parallel`);
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        emitWorkflowInput(s, contextVar, buf, `_parallelInput${i}`, 'agent');
      }
      buf.line(`const [${vars.join(', ')}] = await Promise.all([`);
      buf.indent();
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const agent = (s as any).agent;
        buf.line(`callAgentStep({ agentPath: ${jsonLiteral(agent)}, agentInput: _parallelInput${i}, baseUrl: ${baseUrlVar}, messages: ${messagesVar}, await: true }),`);
      }
      buf.dedent();
      buf.line(']);');
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const lid = (s as any).id;
        if (lid) buf.line(`${contextVar}.steps[${jsonLiteral(lid)}] = ${vars[i]};`);
      }
      buf.line(`${contextVar}.previous = { parallel: [${vars.join(', ')}] };`);
      buf.line(`${contextVar}.all.push(${contextVar}.previous);`);
      buf.blank();
      return;
    }

    case 'worker': {
      const worker = (step as any).worker as string;
      const awaitW = (step as any).await === true;
      buf.line(`// worker ${id ?? ''} ${worker} -> callWorkerStep (use step)`);
      const workerInputVar = emitWorkflowInput(step, contextVar, buf, '_workerInput', 'worker');
      buf.line(`const _dispatch = await callWorkerStep({ workerId: ${jsonLiteral(worker)}, workerInput: ${workerInputVar}, workerTriggerBaseUrl: ${workerTriggerBaseUrlVar} });`);
      if (!awaitW) {
        buf.line(`const _workerOut = { jobId: _dispatch.jobId, status: _dispatch.status ?? "queued" };`);
        buf.line(`if (${varName != null ? jsonLiteral(id) : 'false'}) ${contextVar}.steps[${varName != null ? jsonLiteral(id) : '"_"'}] = _workerOut;`);
        buf.line(`${contextVar}.previous = _workerOut;`);
        buf.line(`${contextVar}.all.push(_workerOut);`);
        buf.blank();
        return;
      }
      buf.line(`const _jobId = _dispatch.jobId;`);
      buf.line(`const _intervalMs = 3000; const _timeoutMs = 600000; const _maxRetries = 200;`);
      buf.line(`const _start = Date.now(); let _attempt = 0;`);
      buf.line(`const { sleep } = await import("workflow");`);
      buf.line(`while (true) {`);
      buf.indent();
      buf.line(`const _r = await pollWorkerJobStep({ baseUrl: ${nextJsBaseUrlVar}, workerId: ${jsonLiteral(worker)}, jobId: _jobId, attempt: _attempt });`);
      buf.line(`if (_r.done && _r.status === "completed") {`);
      buf.indent();
      buf.line(`const _workerOut = { jobId: _jobId, status: _r.status, output: _r.output, metadata: _r.metadata };`);
      buf.line(`if (${varName != null ? jsonLiteral(id) : 'false'}) ${contextVar}.steps[${varName != null ? jsonLiteral(id) : '"_"'}] = _workerOut;`);
      buf.line(`${contextVar}.previous = _workerOut;`);
      buf.line(`${contextVar}.all.push(_workerOut);`);
      buf.line(`break;`);
      buf.dedent();
      buf.line('}');
      buf.line(`if (_r.done && _r.status === "failed") throw new Error(_r.error?.message ?? "Worker failed");`);
      buf.line(`_attempt++;`);
      buf.line(`if (_attempt >= _maxRetries || (_timeoutMs && Date.now() - _start >= _timeoutMs)) throw new Error("Worker timeout");`);
      buf.line(`await sleep(_intervalMs);`);
      buf.dedent();
      buf.line('}');
      buf.blank();
      return;
    }

    case 'workflow': {
      const wf = (step as any).workflow as string;
      buf.line(`// workflow ${id ?? ''} ${wf} -> callWorkflowStep (use step)`);
      const wfInputVar = emitWorkflowInput(step, contextVar, buf, '_wfInput', 'workflow');
      buf.line(`const _wfOut = await callWorkflowStep({ workflowPath: ${jsonLiteral(wf)}, workflowInput: ${wfInputVar}, baseUrl: ${apiBaseUrlVar}, messages: ${messagesVar} });`);
      buf.line(`if (${varName != null ? jsonLiteral(id) : 'false'}) ${contextVar}.steps[${varName != null ? jsonLiteral(id) : '"_"'}] = _wfOut;`);
      buf.line(`${contextVar}.previous = _wfOut;`);
      buf.line(`${contextVar}.all.push(_wfOut);`);
      buf.blank();
      return;
    }

    default:
      buf.line(`// unknown step type: ${(step as any).type}`);
      buf.blank();
  }
}

export function generateDebugWorkflowContent(
  resolvedConfig: OrchestrationConfig,
  workflowId: string,
  executionId: string,
  _runId?: string
): string {
  const buf = new CodeBuffer();

  buf.line('/**');
  buf.line(' * Debug: expanded "use workflow" / "use step" JS (DEBUG_WORKER=true)');
  buf.line(` * Generated: ${new Date().toISOString()}`);
  buf.line(` * Workflow: ${workflowId} | Execution: ${executionId}`);
  buf.line(' *');
  buf.line(' * Actual JS: each step function has "use step"; orchestrateWorkflowFn has "use workflow".');
  buf.line(' * Outputs are assigned to context.steps[id], context.previous, context.all.');
  buf.line(' * In workflow runtime, fetch comes from "workflow"; defineHook/sleep from "workflow".');
  buf.line(' */');
  buf.blank();

  emitStepFunctions(buf);
  emitEvaluateCondition(buf);

  buf.line('async function orchestrateWorkflowFn(input) {');
  buf.indent();
  buf.line('"use workflow";');
  buf.blank();
  buf.line('const { config, baseUrl, workerTriggerBaseUrl, workerCallbackBaseUrl } = input;');
  buf.line('const apiBaseUrl = baseUrl.replace(/\\/api\\/studio\\/chat\\/agent\\/?$/, "");');
  buf.line('const nextJsBaseUrl = (workerCallbackBaseUrl ?? apiBaseUrl).replace(/\\/+$/, "");');
  buf.line('const messages = config.messages ?? [];');
  buf.blank();
  buf.line('let runId;');
  buf.line('const executionId = config.input?.executionId;');
  buf.line('if (executionId) {');
  buf.indent();
  buf.line('runId = await getRunIdFromExecutionId({ apiBaseUrl, executionId });');
  buf.dedent();
  buf.line('}');
  buf.blank();

  emitWorkflowBody(resolvedConfig, buf, 'baseUrl', 'apiBaseUrl', 'workerTriggerBaseUrl ?? ""', 'nextJsBaseUrl', 'messages', 'context', 'runId');

  buf.dedent();
  buf.line('}');
  buf.blank();
  buf.line('export { orchestrateWorkflowFn, getRunIdFromExecutionId, updateWorkflowStatus, callAgentStep, callWorkflowStep, callWorkerStep, pollWorkerJobStep, evaluateStepFieldCondition };');
  buf.blank();

  return buf.result();
}
