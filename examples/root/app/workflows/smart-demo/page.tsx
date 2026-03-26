'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, XCircle, Play, RefreshCw, ArrowLeft, Coins, RotateCcw, FileJson } from 'lucide-react';
import { useWorkflowJob } from '@/hooks/useWorkflowJob';

const WORKER_ID = 'smart-demo';

type Mode = 'token-budget' | 'smart-retry' | 'json-extract';

export default function SmartDemoPage() {
  const [mode, setMode] = useState<Mode>('token-budget');

  // token-budget fields
  const [calls, setCalls] = useState('3');

  // smart-retry fields
  const [failUntilAttempt, setFailUntilAttempt] = useState('2');
  const [prompt, setPrompt] = useState('Extract a valid JSON object from the response.');

  // json-extract fields
  const [rawText, setRawText] = useState('Here is the data: {"name":"Alice","age":30} end of response.');

  const { trigger, jobId, status, output, error, loading, polling, reset } = useWorkflowJob({
    type: 'worker',
    workerId: WORKER_ID,
    pollIntervalMs: 1500,
    pollTimeoutMs: 60_000,
    autoPoll: true,
  });

  function buildInput() {
    if (mode === 'token-budget') {
      return { mode, calls: parseInt(calls) || 3 };
    }
    if (mode === 'smart-retry') {
      return { mode, failUntilAttempt: parseInt(failUntilAttempt) || 2, prompt };
    }
    return { mode, rawText };
  }

  const handleRun = () => {
    trigger(buildInput());
  };

  const workerOutput = output && 'output' in (output as any) ? (output as any).output : output;
  const isRunning = loading || polling;

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-6">
        <Link
          href="/workflows"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Workflows
        </Link>
        <h1 className="text-3xl font-bold mb-2">Smart Retry + Token Budget Demo</h1>
        <p className="text-muted-foreground">
          The <code className="rounded bg-muted px-1">smart-demo</code> worker demonstrates two features of{' '}
          <code className="rounded bg-muted px-1">@microfox/ai-worker</code>:
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          <Badge variant="outline" className="gap-1">
            <Coins className="w-3 h-3" />
            Token Budget — <code className="text-xs">ctx.reportTokenUsage()</code>
          </Badge>
          <Badge variant="outline" className="gap-1">
            <RotateCcw className="w-3 h-3" />
            Smart Retry — <code className="text-xs">retry: &#123; on: [&apos;rate-limit&apos;, &apos;json-parse&apos;] &#125;</code>
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Config card */}
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>Choose a mode and configure input parameters.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Mode</Label>
              <Select value={mode} onValueChange={(v: Mode) => { setMode(v); reset(); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="token-budget">
                    <span className="flex items-center gap-2">
                      <Coins className="w-4 h-4" />
                      token-budget
                    </span>
                  </SelectItem>
                  <SelectItem value="smart-retry">
                    <span className="flex items-center gap-2">
                      <RotateCcw className="w-4 h-4" />
                      smart-retry
                    </span>
                  </SelectItem>
                  <SelectItem value="json-extract">
                    <span className="flex items-center gap-2">
                      <FileJson className="w-4 h-4" />
                      json-extract
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode === 'token-budget' && (
              <div className="space-y-2">
                <Label htmlFor="calls">Simulated LLM calls (1–20)</Label>
                <Input
                  id="calls"
                  type="number"
                  min="1"
                  max="20"
                  value={calls}
                  onChange={(e) => setCalls(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Each call reports ~500–1000 input tokens and ~200–500 output tokens via{' '}
                  <code>ctx.reportTokenUsage()</code>.
                </p>
              </div>
            )}

            {mode === 'smart-retry' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="failUntil">Fail until attempt # (1–5)</Label>
                  <Input
                    id="failUntil"
                    type="number"
                    min="1"
                    max="5"
                    value={failUntilAttempt}
                    onChange={(e) => setFailUntilAttempt(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Throws a <code>SyntaxError</code> (matches <code>&apos;json-parse&apos;</code> pattern) until this attempt. Set to 1 to always succeed immediately.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="prompt">Prompt</Label>
                  <Input
                    id="prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    On retry, the previous error is injected into the prompt automatically via <code>ctx.retryContext.lastError</code>.
                  </p>
                </div>
              </>
            )}

            {mode === 'json-extract' && (
              <div className="space-y-2">
                <Label htmlFor="rawText">Raw text to extract JSON from</Label>
                <textarea
                  id="rawText"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  className="w-full min-h-24 rounded-md border bg-background p-2 text-sm font-mono"
                  placeholder='e.g. Here is the result: {"key": "value"}'
                />
                <p className="text-xs text-muted-foreground">
                  If no JSON block is found, the worker throws a <code>SyntaxError</code> and retries with error context injected.
                </p>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button onClick={handleRun} disabled={isRunning} className="flex-1">
                {isRunning ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                {loading ? 'Triggering…' : polling ? 'Running…' : 'Run Worker'}
              </Button>
              <Button variant="outline" onClick={reset} disabled={isRunning}>
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

        {/* Result card */}
        <Card>
          <CardHeader>
            <CardTitle>Execution Result</CardTitle>
            <CardDescription>Live job status and output from the worker.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {jobId || status !== 'idle' ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
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
                    <code className="text-xs text-muted-foreground font-mono">
                      {jobId.slice(0, 20)}…
                    </code>
                  )}
                </div>

                {isRunning && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Polling for result…
                  </div>
                )}

                {workerOutput && (
                  <div className="space-y-3">
                    {/* success / mode badges */}
                    <div className="flex flex-wrap gap-2">
                      {workerOutput.mode && (
                        <Badge variant="outline">{workerOutput.mode}</Badge>
                      )}
                      {workerOutput.success !== undefined && (
                        <Badge variant={workerOutput.success ? 'default' : 'destructive'}>
                          {workerOutput.success ? 'success' : 'failed'}
                        </Badge>
                      )}
                      {workerOutput.retryAttempts !== undefined && (
                        <Badge variant="secondary">
                          <RotateCcw className="w-3 h-3 mr-1" />
                          {workerOutput.retryAttempts} retr{workerOutput.retryAttempts === 1 ? 'y' : 'ies'}
                        </Badge>
                      )}
                    </div>

                    {/* message */}
                    {workerOutput.message && (
                      <p className="text-sm">{workerOutput.message}</p>
                    )}

                    {/* token usage */}
                    {workerOutput.tokenUsage && (
                      <div className="rounded-lg border p-3 bg-muted/50 space-y-1">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Token Usage
                        </p>
                        <div className="flex gap-6 text-sm">
                          <div>
                            <span className="text-muted-foreground">Input: </span>
                            <span className="font-mono font-medium">
                              {workerOutput.tokenUsage.inputTokens.toLocaleString()}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Output: </span>
                            <span className="font-mono font-medium">
                              {workerOutput.tokenUsage.outputTokens.toLocaleString()}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Total: </span>
                            <span className="font-mono font-medium">
                              {(
                                workerOutput.tokenUsage.inputTokens +
                                workerOutput.tokenUsage.outputTokens
                              ).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* extracted result */}
                    {workerOutput.result !== undefined && (
                      <div className="rounded-lg border p-3 bg-muted/50">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                          Result
                        </p>
                        <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                          {JSON.stringify(workerOutput.result, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* raw output */}
                    <details>
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                        Raw output JSON
                      </summary>
                      <pre className="mt-2 text-xs font-mono whitespace-pre-wrap break-words rounded border bg-background p-2">
                        {JSON.stringify(workerOutput, null, 2)}
                      </pre>
                    </details>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">No execution yet</p>
                <p className="text-xs mt-1">Configure a mode and run the worker</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Feature explanation */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Coins className="w-4 h-4 text-muted-foreground" />
                <h4 className="font-medium text-sm">Token Budget</h4>
              </div>
              <p className="text-xs text-muted-foreground">
                Call <code>await ctx.reportTokenUsage(&#123; inputTokens, outputTokens &#125;)</code> after each LLM call.
                When usage exceeds the budget set via <code>DispatchOptions.maxTokens</code>, a{' '}
                <code>TokenBudgetExceededError</code> is thrown — stopping the job before wasting more tokens.
                Check remaining budget with <code>ctx.getTokenBudget()</code>.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-muted-foreground" />
                <h4 className="font-medium text-sm">Smart Retry</h4>
              </div>
              <p className="text-xs text-muted-foreground">
                Configure <code>retry: &#123; maxAttempts: 3, on: [&apos;rate-limit&apos;, &apos;json-parse&apos;] &#125;</code> on the worker or queue step.
                Only matching errors trigger a retry. On each retry, <code>ctx.retryContext</code> is populated with{' '}
                <code>attempt</code> and <code>lastError</code> — inject the error into your LLM prompt for self-correction.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <FileJson className="w-4 h-4 text-muted-foreground" />
                <h4 className="font-medium text-sm">JSON Extract</h4>
              </div>
              <p className="text-xs text-muted-foreground">
                Combines both features. If the LLM response doesn&apos;t contain valid JSON, a <code>SyntaxError</code> is thrown,
                matching the <code>&apos;json-parse&apos;</code> pattern. On retry, the previous parse error is automatically
                injected into the prompt via <code>ctx.retryContext.lastError.message</code>.
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-lg border bg-muted/30 p-4">
            <p className="text-xs font-semibold mb-2">Worker definition (smart-demo.worker.ts)</p>
            <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">{`export default createWorker({
  id: 'smart-demo',
  inputSchema,
  outputSchema,
  retry: {
    maxAttempts: 3,
    on: ['rate-limit', 'json-parse'],  // only retry these error types
  },
  handler: async ({ input, ctx }) => {
    // Track token usage — throws if over budget
    await ctx.reportTokenUsage({ inputTokens: 500, outputTokens: 200 });

    // On retry, inject last error into your prompt
    const hint = ctx.retryContext
      ? \`Previous error: "\${ctx.retryContext.lastError.message}"\`
      : '';
  },
});`}</pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
