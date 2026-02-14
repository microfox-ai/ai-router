'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, XCircle, Play, RefreshCw, ArrowRight, Clock } from 'lucide-react';
import { useWorkflowJob } from '@/hooks/useWorkflowJob';
import type { QueueJobResult } from '@/hooks/useWorkflowJob';

/**
 * Queue ID to trigger.
 * In this example we use the `demo-data-processor` queue defined in
 * `app/ai/queues/demo-data-processor.queue.ts`. Make sure you've deployed
 * your workers & queues (e.g. via `npx ai-worker push`) so this exists in
 * your workers config, otherwise this route will 404.
 */
const QUEUE_ID = 'demo-data-processor';

export default function QueueDemoPage() {
  const [operation, setOperation] = useState<'analyze' | 'transform' | 'validate'>('analyze');
  const [dataSize, setDataSize] = useState('10');

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
    type: 'queue',
    queueId: QUEUE_ID,
    pollIntervalMs: 2000,
    pollTimeoutMs: 300_000,
    autoPoll: true,
  });

  const handleRun = () => {
    const size = parseInt(dataSize) || 10;
    const data = Array.from({ length: size }, (_, i) => ({
      id: i + 1,
      value: `item-${i + 1}`,
      metadata: { index: i, timestamp: new Date().toISOString() },
    }));

    trigger({
      data,
      operation,
      batchSize: Math.min(5, Math.ceil(size / 2)),
    });
  };

  const queueJob = output && 'steps' in output ? (output as QueueJobResult) : null;

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Queue Demo</h1>
        <p className="text-muted-foreground mb-4">
          Demonstrates a multi-step queue with data passing, delays, and sequential execution.
          The <code className="rounded bg-muted px-1">{QUEUE_ID}</code> queue processes data through two steps:
        </p>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
          <Badge variant="outline">Step 1</Badge>
          <span className="font-medium">demo</span>
          <ArrowRight className="w-4 h-4" />
          <Badge variant="outline">Step 2</Badge>
          <span className="font-medium">results-aggregator</span>
          <Badge variant="secondary" className="ml-2">
            <Clock className="w-3 h-3 mr-1" />
            2s delay
          </Badge>
          <Badge variant="secondary" className="ml-1">
            mapInputFromPrev
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Queue Configuration</CardTitle>
            <CardDescription>
              Configure input data for the queue pipeline
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="operation">Operation Type</Label>
              <Select value={operation} onValueChange={(v: any) => setOperation(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="analyze">Analyze</SelectItem>
                  <SelectItem value="transform">Transform</SelectItem>
                  <SelectItem value="validate">Validate</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dataSize">Data Size</Label>
              <Input
                id="dataSize"
                type="number"
                min="1"
                max="50"
                value={dataSize}
                onChange={(e) => setDataSize(e.target.value)}
                placeholder="Number of items"
              />
              <p className="text-xs text-muted-foreground">
                Number of data items to process (1-50)
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleRun}
                disabled={loading || polling}
                className="flex-1"
              >
                {(loading || polling) ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                {loading ? 'Triggering…' : polling ? 'Running…' : 'Run Queue'}
              </Button>
              <Button variant="outline" onClick={reset} disabled={loading || polling}>
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>

            {error && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Queue Execution</CardTitle>
            <CardDescription>
              Monitor queue progress and step execution
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(jobId || status !== 'idle') ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Status:</span>
                    <Badge
                      variant={
                        status === 'completed' || status === 'partial'
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
                    <code className="text-xs text-muted-foreground font-mono">
                      {jobId.slice(0, 20)}...
                    </code>
                  )}
                </div>

                {queueJob?.steps && queueJob.steps.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium">Pipeline Steps:</p>
                    {queueJob.steps.map((step, i) => (
                      <div
                        key={i}
                        className={`rounded-lg border p-3 ${
                          step.status === 'completed'
                            ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800'
                            : step.status === 'running'
                              ? 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800'
                              : step.status === 'failed'
                                ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'
                                : 'bg-muted'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              Step {i + 1}
                            </Badge>
                            <span className="font-medium text-sm">{step.workerId}</span>
                            {i === 1 && (
                              <>
                                <Badge variant="secondary" className="text-xs">
                                  <Clock className="w-3 h-3 mr-1" />
                                  2s delay
                                </Badge>
                                <Badge variant="secondary" className="text-xs">
                                  mapped
                                </Badge>
                              </>
                            )}
                          </div>
                          <Badge
                            variant={
                              step.status === 'completed'
                                ? 'default'
                                : step.status === 'failed'
                                  ? 'destructive'
                                  : 'secondary'
                            }
                            className="text-xs"
                          >
                            {step.status}
                          </Badge>
                        </div>
                        {step.workerJobId && (
                          <code className="text-xs text-muted-foreground font-mono">
                            {step.workerJobId}
                          </code>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {(status === 'completed' || status === 'partial') && queueJob && (
                  <div className="rounded-lg border p-4 bg-muted/50">
                    <p className="text-sm font-medium mb-2">Final Output:</p>
                    {queueJob.steps && queueJob.steps.length >= 2 && (() => {
                      const lastStep = queueJob.steps[queueJob.steps.length - 1];
                      const lastOutput = lastStep?.output;
                      return lastOutput ? (
                        <div className="space-y-2 text-xs">
                          <div>
                            <p className="font-medium mb-1 text-muted-foreground">
                              Aggregated Report:
                            </p>
                            <pre className="whitespace-pre-wrap break-words bg-background p-2 rounded border text-xs">
                              {JSON.stringify(
                                lastOutput as Record<string, unknown>,
                                null,
                                2
                              )}
                            </pre>
                          </div>
                        </div>
                      ) : null;
                    })()}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">No queue execution yet</p>
                <p className="text-xs mt-1">Configure and run the queue to see execution details</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Queue Features Demonstrated</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <h4 className="font-medium text-sm">Multi-Step Execution</h4>
              <p className="text-xs text-muted-foreground">
                Sequential execution of multiple workers in a defined order
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium text-sm">Data Passing</h4>
              <p className="text-xs text-muted-foreground">
                <code className="text-xs">mapInputFromPrev</code> transforms output from one step to input for the next
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium text-sm">Delayed Steps</h4>
              <p className="text-xs text-muted-foreground">
                <code className="text-xs">delaySeconds</code> adds a 2-second delay before step 2 executes
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
