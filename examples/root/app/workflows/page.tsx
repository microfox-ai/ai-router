'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Workflow, Zap, Mail, Search } from 'lucide-react';

export default function WorkflowsPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Workflow Examples</h1>
        <p className="text-muted-foreground">
          Test durable workflows with Human-in-the-Loop (HITL) support
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Orchestration Workflow */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Workflow className="w-5 h-5" />
                Orchestration Workflow
              </CardTitle>
              <Badge variant="secondary">New</Badge>
            </div>
            <CardDescription>
              Multi-agent orchestration with sequential steps, sleep, and HITL hooks
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                <strong>Steps:</strong>
              </p>
              <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                <li>Call agent (get current date)</li>
                <li>Sleep for 2 seconds</li>
                <li>Wait for approval (HITL)</li>
                <li>Call agent again (get date after approval)</li>
              </ul>
            </div>
            <div className="flex gap-2">
              <Button asChild>
                <Link href="/workflows/orchestrate">
                  <Zap className="w-4 h-4 mr-2" />
                  Test Orchestration
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Research Workflow */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Search className="w-5 h-5" />
                Research Workflow
              </CardTitle>
              <Badge variant="secondary">v1.0</Badge>
            </div>
            <CardDescription>
              Long-running research workflow with web search, summarization, and human approval
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                <strong>Steps:</strong>
              </p>
              <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                <li>Web search for topic</li>
                <li>Summarize results</li>
                <li>Human approval (HITL)</li>
                <li>Send email with summary</li>
              </ul>
            </div>
            <div className="flex gap-2">
              <Button asChild>
                <Link href="/workflows/research">
                  <Zap className="w-4 h-4 mr-2" />
                  Test Workflow
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/workflows/research/instances">
                  View Instances
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Onboarding Workflow */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5" />
                Onboarding Workflow
              </CardTitle>
              <Badge variant="secondary">v1.0</Badge>
            </div>
            <CardDescription>
              User onboarding with email verification and admin override capabilities
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                <strong>Steps:</strong>
              </p>
              <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                <li>Create user account</li>
                <li>Send verification email</li>
                <li>Wait for verification (HITL)</li>
                <li>Send welcome email</li>
              </ul>
            </div>
            <div className="flex gap-2">
              <Button asChild>
                <Link href="/workflows/onboarding">
                  <Zap className="w-4 h-4 mr-2" />
                  Test Workflow
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/workflows/onboarding/instances">
                  View Instances
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>About Workflows</CardTitle>
          <CardDescription>
            Durable execution with replay-based state management
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong>Durable Execution:</strong> Workflows survive server restarts and can run for days or weeks.
          </p>
          <p>
            <strong>Human-in-the-Loop:</strong> Workflows can pause and wait for human approval or input.
          </p>
          <p>
            <strong>Automatic Retries:</strong> Failed steps are automatically retried with exponential backoff.
          </p>
          <p>
            <strong>Event Sourcing:</strong> Complete execution history is stored for debugging and replay.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

