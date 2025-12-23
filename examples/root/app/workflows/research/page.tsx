'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';

export default function ResearchWorkflowPage() {
  const [topic, setTopic] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startWorkflow = async () => {
    if (!topic || !email) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError(null);
    setStatus(null);

    try {
      const response = await fetch('/api/studio/chat/agent/workflows/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { topic, email } }),
      });

      if (!response.ok) {
        throw new Error('Failed to start workflow');
      }

      const data = await response.json();
      const result = data[0]?.parts[0]?.output;
      
      if (result?.instanceId) {
        setInstanceId(result.instanceId);
        setStatus(result.status);
        
        // Poll for status if suspended
        if (result.status === 'suspended') {
          pollStatus(result.instanceId);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to start workflow');
    } finally {
      setLoading(false);
    }
  };

  const pollStatus = async (id: string) => {
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/studio/chat/agent/workflows/research/${id}`);
        if (response.ok) {
          const data = await response.json();
          const result = data[0]?.parts[0]?.output;
          setStatus(result.status);
          
          if (result.status === 'completed' || result.status === 'rejected') {
            clearInterval(interval);
          }
        }
      } catch (err) {
        console.error('Failed to poll status', err);
      }
    }, 2000);

    // Clean up after 5 minutes
    setTimeout(() => clearInterval(interval), 5 * 60 * 1000);
  };

  const getStatusBadge = () => {
    if (!status) return null;
    
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-500"><CheckCircle2 className="w-3 h-3 mr-1" /> Completed</Badge>;
      case 'suspended':
        return <Badge className="bg-yellow-500"><Clock className="w-3 h-3 mr-1" /> Waiting for Approval</Badge>;
      case 'rejected':
        return <Badge className="bg-red-500"><XCircle className="w-3 h-3 mr-1" /> Rejected</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Research Workflow</CardTitle>
          <CardDescription>
            Start a research workflow that will search, summarize, and wait for your approval
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="topic">Research Topic</Label>
              <Input
                id="topic"
                placeholder="e.g., AI trends in 2024"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {instanceId && (
            <Alert>
              <AlertDescription>
                <div className="flex items-center justify-between">
                  <div>
                    <strong>Instance ID:</strong> {instanceId}
                  </div>
                  {getStatusBadge()}
                </div>
                {status === 'suspended' && (
                  <div className="mt-2">
                    <p className="text-sm mb-2">Workflow is waiting for approval. Use the signal endpoint to approve or reject.</p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={async () => {
                          await fetch(`/api/studio/chat/agent/workflows/research/${instanceId}/signal`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              eventName: 'review',
                              payload: { decision: 'approve' },
                            }),
                          });
                          pollStatus(instanceId);
                        }}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={async () => {
                          await fetch(`/api/studio/chat/agent/workflows/research/${instanceId}/signal`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              eventName: 'review',
                              payload: { decision: 'reject' },
                            }),
                          });
                          pollStatus(instanceId);
                        }}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          <Button
            onClick={startWorkflow}
            disabled={loading || !topic || !email}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Starting Workflow...
              </>
            ) : (
              'Start Research Workflow'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

