'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Play, Send } from 'lucide-react';
import { createOrchestrationClient, prepareOrchestrationConfig } from '@microfox/ai-workflow';
import { workerProofWorkflow } from './workflow';

const client = createOrchestrationClient(
  typeof window !== 'undefined' ? window.location.origin : '',
);

function fmtMs(ms?: number | null) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return `${Math.round(ms)}ms`;
}

export default function WorkerProofPage() {
  const [loading, setLoading] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hookToken, setHookToken] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const start = async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    setResult(null);
    setRunId(null);
    setHookToken(null);

    const executionId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const gateToken = `worker-proof:gate:${executionId}`;

    try {
      const config = prepareOrchestrationConfig(workerProofWorkflow);
      const data = await client.orchestrate({
        config,
        executionId,
        hookTokens: { gate: gateToken },
        input: {},
        messages: [],
      });
      setRunId(data.runId);
      setStatus(data.status);
      setHookToken(gateToken);
      poll(data.runId);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to start');
      setStatus('error');
    } finally {
      setLoading(false);
    }
  };

  const poll = async (id: string) => {
    const interval = setInterval(async () => {
      try {
        const data = await client.getWorkflowStatus(id);
        setStatus(data.status);

        if (data.status === 'completed') {
          clearInterval(interval);
          setResult(data.result);
          setHookToken(null);
        } else if (data.status === 'failed') {
          clearInterval(interval);
          setError(
            typeof data.error === 'string'
              ? data.error
              : data.error?.message ?? 'Workflow failed',
          );
          setHookToken(null);
        } else if (data.status === 'paused') {
          // token is deterministic in this example; keep the token we generated
        }
      } catch (e: any) {
        clearInterval(interval);
        setError(e?.message ?? 'Failed to poll');
      }
    }, 1500);
    setTimeout(() => clearInterval(interval), 15 * 60 * 1000);
  };

  const resume = async () => {
    if (!hookToken) {
      setError('No hook token available');
      return;
    }
    try {
      await client.resumeHook({
        token: hookToken,
        payload: { continued: true, resumedAt: new Date().toISOString() },
      });
      if (runId) poll(runId);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to resume');
    }
  };

  const proof = result?.proof ?? null;
  const steps = Array.isArray(result?.steps) ? result.steps : [];

  const parallelOverlapMs = proof?.parallel?.overlapMs;
  const sequentialGapMs = proof?.sequential?.gapMs;

  const proofBadge = useMemo(() => {
    if (!proof) return null;
    const ok = proof?.sequential?.ok && proof?.parallel?.ok;
    return (
      <Badge variant={ok ? 'default' : 'destructive'}>
        {ok ? 'PROOF: OK' : 'PROOF: FAILED'}
      </Badge>
    );
  }, [proof]);

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Worker Proof Workflow</h1>
          <p className="text-muted-foreground">
            Sequential awaited workers → parallel awaited workers → HITL → timeline proof.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/workflows">Back</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Run</CardTitle>
          <CardDescription>
            This workflow pauses at a hook, then finishes by returning a computed proof object.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={start} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Start Worker Proof
              </>
            )}
          </Button>

          {status && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">Status:</span>
                <Badge
                  variant={
                    status === 'completed'
                      ? 'default'
                      : status === 'failed'
                        ? 'destructive'
                        : 'secondary'
                  }
                >
                  {status}
                </Badge>
                {proofBadge}
              </div>
              {runId && (
                <p className="text-sm text-muted-foreground">
                  Run ID: <code>{runId}</code>
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                Sequential gap: <code>{fmtMs(sequentialGapMs)}</code> | Parallel overlap:{' '}
                <code>{fmtMs(parallelOverlapMs)}</code>
              </p>
            </div>
          )}

          {status === 'paused' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">HITL Gate</CardTitle>
                <CardDescription>
                  Resume to allow the workflow to run the final proof step.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button onClick={resume} className="w-full">
                  <Send className="mr-2 h-4 w-4" />
                  Resume
                </Button>
                {hookToken && (
                  <p className="text-sm text-muted-foreground">
                    Token: <code className="text-xs">{hookToken}</code>
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {steps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Timeline (from worker timestamps)</CardTitle>
            <CardDescription>
              These timestamps come from the worker runtime (not the UI).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {steps.map((s: any) => (
                <div key={s.label} className="rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{s.label}</div>
                    <Badge variant="secondary">{fmtMs(s.durationMs)}</Badge>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground space-y-1">
                    <div>
                      sleepMs: <code>{s.sleepMs}</code>
                    </div>
                    <div>
                      startedAt: <code>{s.startedAt}</code>
                    </div>
                    <div>
                      finishedAt: <code>{s.finishedAt}</code>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-md bg-muted p-3 text-sm">
              <div className="font-medium mb-1">Proof details</div>
              <pre className="overflow-auto">{JSON.stringify(proof, null, 2)}</pre>
            </div>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Raw result</CardTitle>
            <CardDescription>Exactly what the workflow returned at completion.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-4 rounded-md overflow-auto text-sm">
              {JSON.stringify(result, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

