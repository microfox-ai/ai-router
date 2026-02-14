'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle2, XCircle, Play } from 'lucide-react';
import { createOrchestrationClient, prepareOrchestrationConfig } from '@microfox/ai-workflow';
import { contentPipelineWorkflow } from './workflow';

const client = createOrchestrationClient(
  typeof window !== 'undefined' ? window.location.origin : ''
);

export default function ContentPipelinePage() {
  const [loading, setLoading] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hookToken, setHookToken] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const startPipeline = async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    setResult(null);
    setRunId(null);
    setHookToken(null);

    const executionId = `wf_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const approvalToken = `content-approval:${executionId}`;

    try {
      const config = prepareOrchestrationConfig(contentPipelineWorkflow);
      const data = await client.orchestrate({
        config,
        executionId,
        hookTokens: { approval: approvalToken },
        input: {},
        messages: [],
      });

      setRunId(data.runId);
      setStatus(data.status);
      setHookToken(approvalToken);
      pollStatus(data.runId);
    } catch (err: any) {
      setError(err.message ?? 'Failed to start pipeline');
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

        if (data.status === 'paused' && (data.hook?.token ?? data.hookToken)) {
          setHookToken(data.hook?.token ?? data.hookToken ?? null);
        } else if (data.status !== 'paused') {
          setHookToken(null);
        }

        if (data.status === 'completed') {
          clearInterval(interval);
          setResult(data.result);
          setHookToken(null);
        } else if (data.status === 'failed') {
          clearInterval(interval);
          setError(typeof data.error === 'string' ? data.error : data.error?.message ?? 'Pipeline failed');
          setHookToken(null);
        }
      } catch (err: any) {
        clearInterval(interval);
        setError(err.message ?? 'Failed to poll status');
      }
    }, 3000);
    setTimeout(() => clearInterval(interval), 10 * 60 * 1000);
  };

  const sendApproval = async (approved: boolean) => {
    if (!hookToken) {
      setError('No hook token available');
      return;
    }
    try {
      await client.resumeHook({ token: hookToken, payload: { approved } });
      if (runId) pollStatus(runId);
    } catch (err: any) {
      setError(err.message ?? 'Failed to send approval');
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle>Content Pipeline Orchestration</CardTitle>
          <CardDescription>
            Demonstrates parallel agents, HITL approval, worker polling, and conditional logic
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={startPipeline} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting Pipeline...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Start Content Pipeline
              </>
            )}
          </Button>

          {status === 'paused' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Human Approval Required</CardTitle>
                <CardDescription>
                  The pipeline is waiting for your approval to proceed with data processing
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {hookToken ? (
                  <>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => sendApproval(true)}
                        variant="default"
                        className="flex-1"
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Approve & Continue
                      </Button>
                      <Button
                        onClick={() => sendApproval(false)}
                        variant="destructive"
                        className="flex-1"
                      >
                        <XCircle className="mr-2 h-4 w-4" />
                        Reject
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Token: <code className="text-xs">{hookToken}</code>
                    </p>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">Waiting for hook token...</div>
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
                <div className="text-sm text-muted-foreground">
                  Run ID: <code>{runId}</code>
                </div>
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
                <CardTitle>Pipeline Result</CardTitle>
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
