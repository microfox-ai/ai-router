'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, CheckCircle2, XCircle, Clock, Play, Pause } from 'lucide-react';
import { createWorkflowClient } from '@microfox/ai-router/workflow';
import type { OrchestrationConfig } from '@microfox/ai-router';

export default function OrchestrateWorkflowPage() {
  const [topic, setTopic] = useState('');
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hookToken, setHookToken] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const startWorkflow = async () => {
    if (!topic || !userId) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError(null);
    setStatus(null);
    setResult(null);
    setRunId(null);

    try {
      const client = createWorkflowClient();

      // Create orchestration config
      const config: OrchestrationConfig = {
        steps: [
          {
            type: 'agent' as const,
            agent: '/system/current_date',
            id: 'date',
            input: {},
          },
          {
            type: 'sleep' as const,
            duration: '2s', // 2 second delay
          },
          {
            type: 'hook' as const,
            token: `orchestrate-approval:${userId}:${topic}`,
            id: 'approval',
          },
          {
            type: 'agent' as const,
            agent: '/system/current_date',
            id: 'dateAfterApproval',
            input: {},
          },
        ],
        input: {
          topic,
          userId,
        },
      };

      const data = await client.startOrchestration(config);
      if (data.runId) {
        setRunId(data.runId);
        setStatus(data.status);

        // Poll for status if not completed
        if (data.status !== 'completed' && data.status !== 'failed') {
          console.log('Polling status for runId:', data.runId);
          // For Vercel, token is deterministic; for Upstash it will be returned by status.
          setHookToken(`orchestrate-approval:${userId}:${topic}`);
          pollStatus(data.runId);
        }
      } else {
        setError('Invalid response format: missing runId');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to start workflow');
      setStatus('error');
    } finally {
      setLoading(false);
    }
  };

  const pollStatus = async (id: string) => {
    const client = createWorkflowClient();
    const interval = setInterval(async () => {
      try {
        // Use orchestrate endpoint for status
        const data = await client.getWorkflowStatus('/orchestrate', id);

          if (data.error) {
            setError(data.error);
            setStatus('error');
            clearInterval(interval);
            return;
          }

          if (data.status) {
            setStatus(data.status);

            // Store hook token if available (when workflow is paused)
            if (data.hook?.token) {
              setHookToken(data.hook.token);
            }

            // Store result if completed
            if (data.status === 'completed' && data.result) {
              setResult(data.result);
            }

            if (
              data.status === 'completed' ||
              data.status === 'failed' ||
              data.status === 'error'
            ) {
              clearInterval(interval);
            }
          }
      } catch (err) {
        console.error('Failed to poll status', err);
        clearInterval(interval);
      }
    }, 2000); // Poll every 2 seconds

    // Clean up after 5 minutes
    setTimeout(() => clearInterval(interval), 5 * 60 * 1000);
  };

  const signalApproval = async (decision: 'approve' | 'reject') => {
    if (!hookToken) {
      setError('Hook token not available');
      return;
    }

    try {
      const client = createWorkflowClient();
      // Use orchestrate endpoint for signals
      await client.sendSignal('/orchestrate', hookToken, {
        decision,
        timestamp: new Date().toISOString(),
      });

      // Continue polling
      if (runId) {
        pollStatus(runId);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to send signal');
    }
  };

  const getStatusBadge = () => {
    if (!status) return null;

    switch (status) {
      case 'completed':
        return (
          <Badge className="bg-green-500">
            <CheckCircle2 className="w-3 h-3 mr-1" /> Completed
          </Badge>
        );
      case 'paused':
        return (
          <Badge className="bg-yellow-500">
            <Clock className="w-3 h-3 mr-1" /> Waiting for Approval
          </Badge>
        );
      case 'running':
        return (
          <Badge className="bg-blue-500">
            <Play className="w-3 h-3 mr-1" /> Running
          </Badge>
        );
      case 'error':
      case 'failed':
        return (
          <Badge className="bg-red-600">
            <XCircle className="w-3 h-3 mr-1" /> Error
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Orchestration Workflow Test</CardTitle>
          <CardDescription>
            Test the orchestration system with multiple agents, sleep, and HITL hooks
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="topic">Topic</Label>
              <Input
                id="topic"
                placeholder="e.g., Test orchestration"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="userId">User ID</Label>
              <Input
                id="userId"
                placeholder="e.g., user123"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <div className="bg-muted p-4 rounded-lg">
            <h4 className="font-semibold mb-2">Workflow Steps:</h4>
            <ol className="list-decimal list-inside space-y-1 text-sm">
              <li>Call /system/current_date agent (get current date)</li>
              <li>Sleep for 2 seconds</li>
              <li>Wait for approval (HITL hook)</li>
              <li>Call /system/current_date agent again (get date after approval)</li>
            </ol>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {runId && (
            <Alert>
              <AlertDescription>
                <div className="flex items-center justify-between mb-2">
                  <div className="space-y-1">
                    <div>
                      <strong>Run ID:</strong> <code className="text-xs">{runId}</code>
                    </div>
                    <div>
                      <strong>Status:</strong> {status}
                    </div>
                  </div>
                  {getStatusBadge()}
                </div>
                {(status === 'paused' || status === 'running') && (
                  <div className="mt-4 space-y-2">
                      <>
                        <p className="text-sm font-medium">
                          Workflow is waiting for approval. Use the buttons below to continue:
                        </p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => signalApproval('approve')}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            <CheckCircle2 className="w-4 h-4 mr-2" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => signalApproval('reject')}
                          >
                            <XCircle className="w-4 h-4 mr-2" />
                            Reject
                          </Button>
                        </div>
                      </>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {result && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Workflow Result</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={JSON.stringify(result, null, 2)}
                  readOnly
                  className="font-mono text-xs"
                  rows={10}
                />
              </CardContent>
            </Card>
          )}

          <Button
            onClick={startWorkflow}
            disabled={loading || !topic || !userId}
            className="w-full"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Starting Orchestration...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Start Orchestration Workflow
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
