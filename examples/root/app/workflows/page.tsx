'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Zap, Layers, ListOrdered, Calculator, RefreshCw } from 'lucide-react';

export default function WorkflowsPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Workflow Examples</h1>
        <p className="text-muted-foreground">
          Workers, and queues — one example for each.
        </p>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
        {/* Worker demo */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Layers className="w-5 h-5" />
                Worker
              </CardTitle>
              <Badge variant="secondary">useWorkflowJob</Badge>
            </div>
            <CardDescription>
              Trigger a worker via the API and poll until completion. Uses the shared hook.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
              <li>POST /api/workflows/workers/:id</li>
              <li>Poll job status</li>
              <li>Display output</li>
            </ul>
            <Button asChild>
              <Link href="/workflows/worker-demo">
                <Zap className="w-4 h-4 mr-2" />
                Worker demo
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Queue demo */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <ListOrdered className="w-5 h-5" />
                Queue
              </CardTitle>
              <Badge variant="secondary">useWorkflowJob</Badge>
            </div>
            <CardDescription>
              Trigger a queue and poll queue job status and steps. Uses the same hook in queue mode.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
              <li>POST /api/workflows/queues/:id</li>
              <li>Poll queue job + steps</li>
              <li>Display progress</li>
            </ul>
            <Button asChild>
              <Link href="/workflows/queue-demo">
                <Zap className="w-4 h-4 mr-2" />
                Queue demo
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Smart Demo (token budget + smart retry) */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="w-5 h-5" />
                Smart Retry + Token Budget
              </CardTitle>
              <Badge variant="secondary">ai-worker</Badge>
            </div>
            <CardDescription>
              Demonstrates <code className="text-xs">SmartRetryConfig</code> and <code className="text-xs">ctx.reportTokenUsage()</code> — retry on specific errors with self-correction context, enforce per-job token limits.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
              <li>Token budget mode: simulated LLM calls with budget tracking</li>
              <li>Smart retry mode: fail N times, then succeed with error injection</li>
              <li>JSON extract mode: retry on parse error with context</li>
            </ul>
            <Button asChild>
              <Link href="/workflows/smart-demo">
                <Zap className="w-4 h-4 mr-2" />
                Smart Demo
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Calculator HITL (queue) demo */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Calculator className="w-5 h-5" />
                Calculator HITL
              </CardTitle>
              <Badge variant="secondary">queue + HITL</Badge>
            </div>
            <CardDescription>
              One queue (<code className="text-xs">calculator-session</code>): init step, then several sequential HITL gates with frontend views resolved from a HITL view registry.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
              <li>Multi-step HITL demo: one queue run, multiple approval pauses (only one pending at a time)</li>
              <li>Optional: dispatch again with <code className="text-xs">carry</code> for another session</li>
              <li>Approve pending steps via POST …/queues/:id/approve</li>
            </ul>
            <Button asChild>
              <Link href="/workflows/calculator-hitl">
                <Zap className="w-4 h-4 mr-2" />
                Calculator HITL demo
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>About</CardTitle>
          <CardDescription>
            Orchestration runs multi-step workflows with HITL. Workers and queues run via API + polling with the useWorkflowJob hook.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong>Orchestration:</strong> Durable execution with replay, sleep, and human-in-the-loop hooks.
          </p>
          <p>
            <strong>Workers & Queues:</strong> Trigger via POST, then poll GET until completed. Use <code className="rounded bg-muted px-1">useWorkflowJob</code> in your client components.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
