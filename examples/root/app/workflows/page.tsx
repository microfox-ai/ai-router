'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Workflow, Zap, Layers, ListOrdered } from 'lucide-react';

export default function WorkflowsPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Workflow Examples</h1>
        <p className="text-muted-foreground">
          Orchestration, workers, and queues — one example for each.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Orchestration (ai-workflow) */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Workflow className="w-5 h-5" />
                Orchestration
              </CardTitle>
              <Badge variant="secondary">@microfox/ai-workflow</Badge>
            </div>
            <CardDescription>
              Multi-step orchestration with parallel agents, HITL approval, worker step, and conditionals.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
              <li>Parallel content generation</li>
              <li>Analyzer + HITL approval</li>
              <li>Worker + conditional branch</li>
            </ul>
            <Button asChild>
              <Link href="/workflows/orchestration-demo">
                <Zap className="w-4 h-4 mr-2" />
                Orchestration demo
              </Link>
            </Button>
          </CardContent>
        </Card>

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
