'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, RotateCcw, Sigma } from 'lucide-react';
import { useWorkflowJob } from '@/hooks/useWorkflowJob';
import type { QueueHitlDecisionPayload, QueueJobResult } from '@/hooks/useWorkflowJob';
import { HitlTaskPanel } from '@/components/hitl/components/hitl-task-panel';
import { CALCULATOR_OPERATORS, type CalculatorOperator } from '@/app/ai/queues/calculator-session.hitl-shared';

const QUEUE_ID = 'calculator-session';

function parseNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatDisplay(value: number | null): string {
  if (value == null) return '0';
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(6).replace(/\.?0+$/, '');
}

function getLastCalculatorOutput(job: QueueJobResult | null): {
  current: number;
  history: string[];
} | null {
  if (!job?.steps?.length) return null;
  const calcSteps = job.steps.filter((s) => s.workerId === 'calculator-hitl' && s.output);
  const last = calcSteps[calcSteps.length - 1]?.output as {
    current?: number;
    history?: string[];
  } | null;
  if (!last || typeof last.current !== 'number') return null;
  return {
    current: last.current,
    history: Array.isArray(last.history) ? last.history : [],
  };
}

export default function CalculatorHitlPage() {
  const [firstA, setFirstA] = useState('10');
  const [firstB, setFirstB] = useState('5');
  const [firstOp, setFirstOp] = useState<CalculatorOperator>('add');

  const [current, setCurrent] = useState<number | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  const {
    trigger,
    status,
    output,
    error,
    loading,
    polling,
    reset,
    hitlTask,
    submitHitlDecision,
  } = useWorkflowJob({
    type: 'queue',
    queueId: QUEUE_ID,
    pollIntervalMs: 800,
    pollTimeoutMs: 120_000,
    autoPoll: true,
  });

  const queueJob = output && 'steps' in output ? (output as QueueJobResult) : null;
  const busy = loading || polling;
  const formBusy = loading;
  const sessionComplete = status === 'completed';
  const awaitingHitl = Boolean(hitlTask);

  useEffect(() => {
    const parsed = getLastCalculatorOutput(queueJob);
    if (!parsed) return;
    setCurrent(parsed.current);
    setHistory(parsed.history);
  }, [queueJob]);

  const startSession = async () => {
    setHistory([]);
    setCurrent(null);
    reset();
    await trigger({
      mode: 'init',
      a: parseNumber(firstA),
      b: parseNumber(firstB),
      operator: firstOp,
    } as Record<string, unknown>);
  };

  const submitDecision = async (payload: QueueHitlDecisionPayload) => {
    if (!submitHitlDecision) return;
    await submitHitlDecision(payload);
  };

  const resetAll = () => {
    reset();
    setCurrent(null);
    setHistory([]);
  };

  const hitlProgressLabel =
    hitlTask?.progress != null
      ? `HITL ${hitlTask.progress.completedSteps + 1}/${hitlTask.progress.totalSteps}`
      : null;

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Calculator HITL (queue)</h1>
        <p className="text-muted-foreground">
          One queue job: first step computes <code className="rounded bg-muted px-1">init</code>, then
          a looping HITL step. Each round you pick an operation and decide whether to continue or finish.
          HITL UI is resolved by <code className="rounded bg-muted px-1">hitl.ui.viewId</code> through a shared registry.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Start session</CardTitle>
            <CardDescription>Initial calculation (queue step 0).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <div className="space-y-1">
                <Label>A</Label>
                <Input value={firstA} onChange={(e) => setFirstA(e.target.value)} disabled={formBusy} />
              </div>
              <div className="space-y-1">
                <Label>Operator</Label>
                <div className="flex flex-wrap gap-1">
                  {CALCULATOR_OPERATORS.map((op) => (
                    <Button
                      key={op}
                      type="button"
                      size="sm"
                      variant={firstOp === op ? 'default' : 'outline'}
                      onClick={() => setFirstOp(op)}
                      disabled={formBusy}
                    >
                      {op}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <Label>B</Label>
                <Input value={firstB} onChange={(e) => setFirstB(e.target.value)} disabled={formBusy} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={startSession} disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sigma className="mr-2 h-4 w-4" />}
                Start (queue)
              </Button>
              <Button variant="outline" onClick={resetAll} disabled={busy}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset
              </Button>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            )}
            <p className="text-xs text-muted-foreground">
              Active queue: <Badge variant="outline">{QUEUE_ID}</Badge> · job status:{' '}
              <Badge variant="secondary">{status}</Badge>
              {hitlProgressLabel ? (
                <>
                  {' '}
                  · <Badge variant="outline">{hitlProgressLabel}</Badge>
                </>
              ) : null}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>HITL reviewer panel</CardTitle>
            <CardDescription>
              Renderer is selected from queue config by view id. Pending step index:{' '}
              {hitlTask != null ? <code className="text-xs">step {hitlTask.stepIndex}</code> : '—'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge variant={sessionComplete ? 'default' : awaitingHitl ? 'destructive' : 'secondary'}>
                {sessionComplete ? 'queue completed' : awaitingHitl ? 'awaiting HITL' : status}
              </Badge>
            </div>
            <HitlTaskPanel task={hitlTask} busy={loading} onSubmitDecision={submitDecision} />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Computation state</CardTitle>
          <CardDescription>Latest queue output and history across steps.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 rounded-lg border bg-black px-4 py-3 text-right text-3xl font-mono text-green-400">
            {formatDisplay(current)}
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No calculations yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map((line, idx) => (
                <div key={`${line}-${idx}`} className="rounded border bg-muted/40 p-2 font-mono text-sm">
                  {line}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
