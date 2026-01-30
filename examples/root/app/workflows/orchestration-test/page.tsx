'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Play, Send } from 'lucide-react';
import { createOrchestrationClient, prepareOrchestrationConfig } from '@microfox/ai-workflow';
import { orchestrationTestWorkflow } from './workflow';

const client = createOrchestrationClient(
  typeof window !== 'undefined' ? window.location.origin : ''
);

export default function OrchestrationTestPage() {
  const [loading, setLoading] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hookToken, setHookToken] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const startWorkflow = async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    setResult(null);
    setRunId(null);
    setHookToken(null);

    const executionId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const gateToken = `orchestration-test:gate:${executionId}`;

    try {
      const config = prepareOrchestrationConfig(orchestrationTestWorkflow);
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
      pollStatus(data.runId);
    } catch (err: any) {
      setError(err.message ?? 'Failed to start');
      setStatus('error');
    } finally {
      setLoading(false);
    }
  };

  const pollStatus = async (id: string) => {
    const interval = setInterval(async () => {
      try {
        const data = await client.getWorkflowStatus(id);
        setStatus(data.status);

        // if (data.status === 'paused' && (data.hook?.token ?? data.hookToken)) {
        //   setHookToken(data.hook?.token ?? data.hookToken ?? null);
        // } else if (data.status !== 'paused') {
        //   setHookToken(null);
        // }

        if (data.status === 'completed') {
          clearInterval(interval);
          setResult(data.result);
          setHookToken(null);
        } else if (data.status === 'failed') {
          clearInterval(interval);
          setError(typeof data.error === 'string' ? data.error : data.error?.message ?? 'Workflow failed');
          setHookToken(null);
        }
      } catch (err: any) {
        clearInterval(interval);
        setError(err.message ?? 'Failed to poll');
      }
    }, 3000);
    setTimeout(() => clearInterval(interval), 10 * 60 * 1000);
  };

  const resumeGate = async () => {
    if (!hookToken) {
      setError('No hook token');
      return;
    }
    try {
      await client.resumeHook({ token: hookToken, payload: { continued: true } });
      if (runId) pollStatus(runId);
    } catch (err: any) {
      setError(err.message ?? 'Failed to resume');
    }
  };

  const branch = result?.branch ?? null;

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle>Orchestration Test</CardTitle>
          <CardDescription>
            Emitter → Hook (gate) → Condition → Then: echo worker (await) + reflect | Else: reflect.
            Tests HITL, worker polling, conditionals, context passing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={startWorkflow} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Start Orchestration Test
              </>
            )}
          </Button>

          {status === 'paused' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Gate (HITL)</CardTitle>
                <CardDescription>Resume to continue past the hook.</CardDescription>
              </CardHeader>
              <CardContent>
                {hookToken ? (
                  <>
                    <Button onClick={resumeGate} className="w-full">
                      <Send className="mr-2 h-4 w-4" />
                      Resume
                    </Button>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Token: <code className="text-xs">{hookToken}</code>
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Waiting for hook token...</p>
                )}
              </CardContent>
            </Card>
          )}

          {status && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">Status:</span>
                <Badge
                  variant={
                    status === 'completed' ? 'default' : status === 'failed' ? 'destructive' : 'secondary'
                  }
                >
                  {status}
                </Badge>
              </div>
              {runId && (
                <p className="text-sm text-muted-foreground">
                  Run ID: <code>{runId}</code>
                </p>
              )}
              {branch && (
                <p className="text-sm">
                  Branch: <strong>{branch}</strong>
                </p>
              )}
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {result && (
            <Card>
              <CardHeader>
                <CardTitle>Result</CardTitle>
                <CardDescription>context.previous (reflect output) and full result</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="bg-muted p-4 rounded-md overflow-auto text-sm">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
