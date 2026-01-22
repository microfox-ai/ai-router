'use client';

import { useMemo, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { createWorkflowClient } from '@microfox/ai-router/workflow';
import { createOrchestration, type OrchestrationConfig } from '@microfox/ai-router';

export default function WorkflowTestHarnessPage() {
  const client = useMemo(() => createWorkflowClient(), []);

  const [echoMessage, setEchoMessage] = useState('hello');
  const [echoRunId, setEchoRunId] = useState<string | null>(null);
  const [echoStatus, setEchoStatus] = useState<string | null>(null);

  const [orchestrateRunId, setOrchestrateRunId] = useState<string | null>(null);
  const [orchestrateStatus, setOrchestrateStatus] = useState<string | null>(null);
  const [hookToken, setHookToken] = useState<string | null>(null);

  const [workerId, setWorkerId] = useState('echo-worker');
  const [workerJobId, setWorkerJobId] = useState<string | null>(null);
  const [workerStatus, setWorkerStatus] = useState<string | null>(null);

  const [output, setOutput] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function runEchoWorkflow() {
    setError(null);
    setOutput(null);
    setEchoStatus(null);
    setEchoRunId(null);
    // Use a simple test agent path instead of registered workflow
    // For testing, we'll use /system/current_date as a simple agent
    const res = await client.startWorkflow('/system/current_date', {});
    setEchoRunId(res.runId);
    setEchoStatus(res.status);
  }

  async function pollEchoStatus() {
    if (!echoRunId) return;
    setError(null);
    const res = await client.getWorkflowStatus('/system/current_date', echoRunId);
    setEchoStatus(res.status);
    if (res.status === 'completed') setOutput(res.result);
    if (res.error) setError(res.error);
  }

  async function runOrchestration() {
    setError(null);
    setOutput(null);
    setHookToken(null);
    setOrchestrateRunId(null);
    setOrchestrateStatus(null);
    const currentTime = new Date().toISOString();
    setHookToken(`approval:${currentTime}`);

    const cfg: OrchestrationConfig = createOrchestration()
      .agent('/system/current_date', {}, { id: 'date' })
      .hook(`approval:${currentTime}`, z.object({ decision: z.enum(['approve', 'reject']) }))
      .agent('/system/current_date', {}, { id: 'date2' })
      .build();

    const res = await client.startOrchestration(cfg);
    setOrchestrateRunId(res.runId);
    setOrchestrateStatus(res.status);
  }

  async function pollOrchestrationStatus() {
    if (!orchestrateRunId) return;
    setError(null);
    // Use orchestrate endpoint for status
    const res = await client.getWorkflowStatus('/orchestrate', orchestrateRunId);
    setOrchestrateStatus(res.status);
    if (res.hook?.token) setHookToken(res.hook.token);
    if (res.status === 'completed') setOutput(res.result);
    if (res.error) setError(res.error);
  }

  async function resumeOrchestration(decision: 'approve' | 'reject') {
    if (!hookToken) return;
    setError(null);
    // Use orchestrate endpoint for signals
    await client.sendSignal('/orchestrate', hookToken, { decision });
    await pollOrchestrationStatus();
  }

  async function dispatchWorker(awaitMode: boolean) {
    setError(null);
    setOutput(null);
    setWorkerJobId(null);
    setWorkerStatus(null);
    const res = await client.executeWorker(workerId, { message: 'hi from worker' }, { await: awaitMode });
    setWorkerJobId(res.jobId);
    setWorkerStatus(res.status);
  }

  async function pollWorkerStatus() {
    if (!workerJobId) return;
    setError(null);
    const res = await client.getWorkerStatus(workerId, workerJobId);
    setWorkerStatus(res.status);
    if (res.status === 'completed') setOutput(res.output);
    if (res.error?.message) setError(res.error.message);
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Workflow test harness</CardTitle>
          <CardDescription>
            Uses <code>@microfox/ai-router/workflow</code> client helpers (no manual fetch/curl).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-3">
            <h3 className="font-semibold">1) Agent workflow: /system/current_date</h3>
            <div className="space-y-2">
              <Label>Test agent workflow (using /system/current_date)</Label>
              <div className="text-xs text-muted-foreground">
                Agents are called by their path (e.g., /system/current_date)
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={runEchoWorkflow}>Start agent</Button>
              <Button variant="secondary" onClick={pollEchoStatus} disabled={!echoRunId}>
                Poll status
              </Button>
            </div>
            <div className="text-sm">
              runId: <code>{echoRunId || '-'}</code> | status: <code>{echoStatus || '-'}</code>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="font-semibold">2) Orchestration: hook + agents</h3>
            <div className="flex gap-2">
              <Button onClick={runOrchestration}>Start orchestrate</Button>
              <Button variant="secondary" onClick={pollOrchestrationStatus} disabled={!orchestrateRunId}>
                Poll status
              </Button>
              <Button variant="secondary" onClick={() => resumeOrchestration('approve')} disabled={!hookToken}>
                Resume approve
              </Button>
              <Button variant="destructive" onClick={() => resumeOrchestration('reject')} disabled={!hookToken}>
                Resume reject
              </Button>
            </div>
            <div className="text-sm">
              runId: <code>{orchestrateRunId || '-'}</code> | status: <code>{orchestrateStatus || '-'}</code>
              <br />
              hook token: <code>{hookToken || '-'}</code>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="font-semibold">3) Worker: dispatch + status</h3>
            <div className="space-y-2">
              <Label>Worker ID</Label>
              <Input value={workerId} onChange={(e) => setWorkerId(e.target.value)} />
              <div className="text-xs text-muted-foreground">
                Create a worker at <code>app/ai/workers/{'{id}'}.worker.ts</code>.
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => dispatchWorker(false)}>Dispatch (await: false)</Button>
              <Button onClick={() => dispatchWorker(true)} variant="secondary">
                Dispatch (await: true)
              </Button>
              <Button onClick={pollWorkerStatus} variant="secondary" disabled={!workerJobId}>
                Poll job
              </Button>
            </div>
            <div className="text-sm">
              jobId: <code>{workerJobId || '-'}</code> | status: <code>{workerStatus || '-'}</code>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold">Output</h3>
            <Textarea value={output ? JSON.stringify(output, null, 2) : ''} readOnly rows={10} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

