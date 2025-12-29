'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react';

type JobStatus = 'queued' | 'running' | 'success' | 'error';

type JobDoc = {
  _id: string;
  workerId: string;
  status: JobStatus;
  progressPct: number;
  logs: Array<{ at: string; message: string }>;
  output?: any;
  error?: { message: string; name?: string; stack?: string };
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

interface JobStatusViewProps {
  job: JobDoc | null;
  isLoading?: boolean;
}

function getStatusIcon(status: JobStatus) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-red-600" />;
    case 'running':
      return <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />;
    case 'queued':
    default:
      return <Clock className="h-4 w-4 text-gray-600" />;
  }
}

function getStatusBadgeVariant(status: JobStatus) {
  switch (status) {
    case 'success':
      return 'default' as const;
    case 'error':
      return 'destructive' as const;
    case 'running':
      return 'secondary' as const;
    case 'queued':
    default:
      return 'outline' as const;
  }
}

export function JobStatusView({ job, isLoading }: JobStatusViewProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Job Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading job status...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!job) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Job Status</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No job data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Job Status</CardTitle>
          <div className="flex items-center gap-2">
            {getStatusIcon(job.status)}
            <Badge variant={getStatusBadgeVariant(job.status)}>{job.status}</Badge>
          </div>
        </div>
        <CardDescription>
          Job ID: <code className="font-mono text-xs">{job._id}</code>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-medium tabular-nums">{job.progressPct}%</span>
          </div>
          <Progress value={job.progressPct} className="h-2" />
        </div>

        <Separator />

        {/* Timestamps */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Created</div>
            <div className="font-mono text-xs mt-1">
              {new Date(job.createdAt).toLocaleString()}
            </div>
          </div>
          {job.startedAt && (
            <div>
              <div className="text-muted-foreground">Started</div>
              <div className="font-mono text-xs mt-1">
                {new Date(job.startedAt).toLocaleString()}
              </div>
            </div>
          )}
          {job.finishedAt && (
            <div>
              <div className="text-muted-foreground">Finished</div>
              <div className="font-mono text-xs mt-1">
                {new Date(job.finishedAt).toLocaleString()}
              </div>
            </div>
          )}
          <div>
            <div className="text-muted-foreground">Last Updated</div>
            <div className="font-mono text-xs mt-1">
              {new Date(job.updatedAt).toLocaleString()}
            </div>
          </div>
        </div>

        {/* Error Display */}
        {job.error && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="text-sm font-medium text-destructive">Error</div>
              <Card className="border-destructive/40 bg-destructive/5">
                <CardContent className="pt-4">
                  <div className="space-y-2">
                    {job.error.name && (
                      <div className="text-xs font-mono text-destructive">{job.error.name}</div>
                    )}
                    <div className="text-sm">{job.error.message}</div>
                    {job.error.stack && (
                      <ScrollArea className="h-32 mt-2">
                        <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground">
                          {job.error.stack}
                        </pre>
                      </ScrollArea>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* Logs */}
        {job.logs && job.logs.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="text-sm font-medium">Logs</div>
              <ScrollArea className="h-48 rounded-md border p-3">
                <div className="space-y-2">
                  {job.logs.slice().reverse().map((log, idx) => (
                    <div key={`${log.at}-${idx}`} className="text-xs">
                      <code className="font-mono text-muted-foreground">{log.at}</code>{' '}
                      <span>{log.message}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

