'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2, XCircle, Play, RefreshCw } from 'lucide-react';
import { useWorkflowJob } from '@/hooks/useWorkflowJob';

const WORKER_ID = 'demo';

export default function WorkerDemoPage() {
  const [message, setMessage] = useState('Hello from worker');

  const {
    trigger,
    jobId,
    status,
    output,
    error,
    loading,
    polling,
    reset,
  } = useWorkflowJob({
    type: 'worker',
    workerId: WORKER_ID,
    pollIntervalMs: 1500,
    pollTimeoutMs: 60_000,
    autoPoll: true,
  });

  const handleRunEcho = () => {
    trigger({ mode: 'echo', message });
  };

  const handleRunDispatchDemo = () => {
    trigger({ mode: 'dispatch-demo' });
  };

  const workerOutput = output && 'workerId' in output ? output : null;

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Worker demo</h1>
        <p className="text-muted-foreground">
          Trigger the <code className="rounded bg-muted px-1">{WORKER_ID}</code> worker (echo or dispatch-demo). Dispatch demo proves <code>ctx.dispatchWorker</code> with <code>await: true</code> and <code>await: false</code>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trigger worker</CardTitle>
          <CardDescription>
            Submit input and watch status and output update via polling.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="message">Message (echo mode)</Label>
            <Input
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Message to echo back"
              disabled={loading || polling}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleRunEcho}
              disabled={loading || polling}
            >
              {(loading || polling) ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              {loading ? 'Triggering…' : polling ? 'Waiting…' : 'Run echo'}
            </Button>
            <Button
              variant="secondary"
              onClick={handleRunDispatchDemo}
              disabled={loading || polling}
            >
              Run dispatch demo
            </Button>
            <Button variant="outline" onClick={reset} disabled={loading || polling}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Reset
            </Button>
          </div>

          {error && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}

          {(jobId || status !== 'idle') && (
            <div className="space-y-2 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Status:</span>
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
              </div>
              {jobId && (
                <p className="text-sm text-muted-foreground font-mono break-all">
                  Job ID: {jobId}
                </p>
              )}
              {status === 'completed' && workerOutput?.output !== undefined && (
                <div className="rounded bg-muted p-3 text-sm">
                  <p className="font-medium mb-1">Output:</p>
                  <pre className="whitespace-pre-wrap break-words">
                    {JSON.stringify(workerOutput.output, null, 2) as string}
                  </pre>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
