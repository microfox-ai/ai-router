'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { JobStatusView, JobResultView } from '@/components/ffmpeg';

type AgentResponse =
  | {
      ok: true;
      jobId: string;
      workerId: string;
      dispatchMode?: 'local' | 'remote';
      statusUrl: string;
      message?: string;
    }
  | { ok: false; error: string };

type JobDoc = {
  _id: string;
  workerId: string;
  status: 'queued' | 'running' | 'success' | 'error';
  progressPct: number;
  logs: Array<{ at: string; message: string }>;
  output?: any;
  error?: { message: string; name?: string; stack?: string };
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

type JobResponse =
  | { ok: true; job: JobDoc }
  | { ok: false; error: string; details?: string };

export function FFDemoClient() {
  // --- ffprobe worker ---
  const [mediaUrl, setMediaUrl] = React.useState('https://samplelib.com/lib/preview/mp4/sample-5s.mp4');
  const [ffprobeMaxBytes, setFfprobeMaxBytes] = React.useState<number>(8 * 1024 * 1024);
  const [ffprobeResponse, setFfprobeResponse] = React.useState<AgentResponse | null>(null);
  const [ffprobeLoading, setFfprobeLoading] = React.useState(false);
  const [ffprobeJob, setFfprobeJob] = React.useState<JobDoc | null>(null);
  const [ffprobeStatusLoading, setFfprobeStatusLoading] = React.useState(false);

  async function callFfprobeAgent() {
    setFfprobeLoading(true);
    setFfprobeJob(null);
    setFfprobeResponse(null);

    try {
      const res = await fetch('/api/studio/chat/agent/ffmpeg/ffprobe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaUrl,
          maxBytes: ffprobeMaxBytes,
        }),
      });

      const messages = await res.json();
      // Parse the streaming response format
      if (Array.isArray(messages) && messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        const jobIdPart = lastMessage.parts?.find((p: any) => p.type === 'data-text-jobId');
        const textPart = lastMessage.parts?.find((p: any) => p.type === 'text-delta');

        if (jobIdPart) {
          setFfprobeResponse({
            ok: true,
            jobId: jobIdPart.data,
            workerId: 'ffprobe-media-summary',
            statusUrl: `/api/worker-jobs/${jobIdPart.data}`,
            message: textPart?.delta || 'FFprobe analysis started',
          });
        } else {
          setFfprobeResponse({ ok: false, error: 'No job ID in response' });
        }
      } else {
        setFfprobeResponse({ ok: false, error: 'Invalid response format' });
      }
    } catch (error: any) {
      setFfprobeResponse({ ok: false, error: error.message });
    } finally {
      setFfprobeLoading(false);
    }
  }

  async function loadFfprobeStatus() {
    if (!ffprobeResponse || !ffprobeResponse.ok) return;
    setFfprobeStatusLoading(true);
    try {
      const res = await fetch(ffprobeResponse.statusUrl, { cache: 'no-store' });
      const json = (await res.json()) as JobResponse;
      if (json.ok) {
        setFfprobeJob(json.job);
      } else {
        console.error('Failed to load ffprobe job status', json.error);
      }
    } catch (error) {
      console.error('Failed to load ffprobe job status', error);
    } finally {
      setFfprobeStatusLoading(false);
    }
  }

  // --- video converter worker ---
  const [converterMediaUrl, setConverterMediaUrl] = React.useState(
    'https://samplelib.com/lib/preview/mp4/sample-5s.mp4'
  );
  const [converterOutputFormat, setConverterOutputFormat] = React.useState<'mp4' | 'webm' | 'mov' | 'avi'>('mp4');
  const [converterResolution, setConverterResolution] = React.useState<string>('');
  const [converterQuality, setConverterQuality] = React.useState<number>(23);
  const [converterMaxBytes, setConverterMaxBytes] = React.useState<number>(50 * 1024 * 1024);
  const [converterResponse, setConverterResponse] = React.useState<AgentResponse | null>(null);
  const [converterLoading, setConverterLoading] = React.useState(false);
  const [converterJob, setConverterJob] = React.useState<JobDoc | null>(null);
  const [converterStatusLoading, setConverterStatusLoading] = React.useState(false);

  async function callVideoConverterAgent() {
    setConverterLoading(true);
    setConverterJob(null);
    setConverterResponse(null);

    try {
      const res = await fetch('/api/studio/chat/agent/ffmpeg/video-converter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaUrl: converterMediaUrl,
          outputFormat: converterOutputFormat,
          resolution: converterResolution || undefined,
          quality: converterQuality,
          maxBytes: converterMaxBytes,
        }),
      });

      const messages = await res.json();
      // Parse the streaming response format
      if (Array.isArray(messages) && messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        const jobIdPart = lastMessage.parts?.find((p: any) => p.type === 'data-text-jobId');
        const textPart = lastMessage.parts?.find((p: any) => p.type === 'text-delta');

        if (jobIdPart) {
          setConverterResponse({
            ok: true,
            jobId: jobIdPart.data,
            workerId: 'video-converter',
            statusUrl: `/api/worker-jobs/${jobIdPart.data}`,
            message: textPart?.delta || 'Video conversion started',
          });
        } else {
          setConverterResponse({ ok: false, error: 'No job ID in response' });
        }
      } else {
        setConverterResponse({ ok: false, error: 'Invalid response format' });
      }
    } catch (error: any) {
      setConverterResponse({ ok: false, error: error.message });
    } finally {
      setConverterLoading(false);
    }
  }

  async function loadConverterStatus() {
    if (!converterResponse || !converterResponse.ok) return;
    setConverterStatusLoading(true);
    try {
      const res = await fetch(converterResponse.statusUrl, { cache: 'no-store' });
      const json = (await res.json()) as JobResponse;
      if (json.ok) {
        setConverterJob(json.job);
      } else {
        console.error('Failed to load converter job status', json.error);
      }
    } catch (error) {
      console.error('Failed to load converter job status', error);
    } finally {
      setConverterStatusLoading(false);
    }
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-10 space-y-6">
      {/* FFprobe Section */}
      <Card>
        <CardHeader>
          <CardTitle>FFprobe - Media Analysis</CardTitle>
          <CardDescription>
            Analyzes media files using ffprobe to extract metadata like duration, resolution, fps, and audio presence.
            In Lambda, ffprobe is typically provided via a Layer at <code className="font-mono">/opt/bin/ffprobe</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="mediaUrl">Media URL</Label>
              <Input id="mediaUrl" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ffprobeMaxBytes">Max bytes</Label>
              <Input
                id="ffprobeMaxBytes"
                type="number"
                value={ffprobeMaxBytes}
                min={131072}
                max={30 * 1024 * 1024}
                onChange={(e) => setFfprobeMaxBytes(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <Button onClick={callFfprobeAgent} disabled={ffprobeLoading}>
              {ffprobeLoading ? 'Calling Agent...' : 'Call FFprobe Agent'}
            </Button>
            {ffprobeResponse && ffprobeResponse.ok && (
              <Button variant="outline" onClick={loadFfprobeStatus} disabled={ffprobeStatusLoading}>
                {ffprobeStatusLoading ? 'Loading status…' : 'Load latest status (webhook-saved)'}
              </Button>
            )}
          </div>

          {ffprobeResponse && ffprobeResponse.ok && ffprobeResponse.jobId && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Job Started</CardTitle>
                <CardDescription>
                  Job ID: <code className="font-mono text-xs">{ffprobeResponse.jobId}</code>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  The worker is running in the background. When it finishes, it will POST results to the webhook and
                  store them in the database. Use &quot;Load latest status&quot; to read the saved record.
                </p>
              </CardContent>
            </Card>
          )}

          {ffprobeJob && (
            <div className="space-y-4">
              <JobStatusView job={ffprobeJob} isLoading={ffprobeStatusLoading} />
              <JobResultView output={ffprobeJob.output} workerId={ffprobeJob.workerId} status={ffprobeJob.status} />
            </div>
          )}
          {ffprobeResponse && !ffprobeResponse.ok && (
            <Card className="border-red-500/50">
              <CardHeader>
                <CardTitle className="text-base text-destructive">Error</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{ffprobeResponse.error}</p>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      {/* Video Converter Section */}
      <Card>
        <CardHeader>
          <CardTitle>Video Converter</CardTitle>
          <CardDescription>
            Converts videos between formats (MP4, WebM, MOV, AVI) with optional resolution scaling and quality
            adjustments. In Lambda, ffmpeg is typically provided via a Layer at{' '}
            <code className="font-mono">/opt/bin/ffmpeg</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="converterMediaUrl">Media URL</Label>
              <Input
                id="converterMediaUrl"
                value={converterMediaUrl}
                onChange={(e) => setConverterMediaUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="converterOutputFormat">Output Format</Label>
              <Select
                value={converterOutputFormat}
                onValueChange={(v) => setConverterOutputFormat(v as 'mp4' | 'webm' | 'mov' | 'avi')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mp4">MP4</SelectItem>
                  <SelectItem value="webm">WebM</SelectItem>
                  <SelectItem value="mov">MOV</SelectItem>
                  <SelectItem value="avi">AVI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="converterResolution">Resolution (e.g., 1920x1080, optional)</Label>
              <Input
                id="converterResolution"
                value={converterResolution}
                onChange={(e) => setConverterResolution(e.target.value)}
                placeholder="1920x1080"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="converterQuality">Quality (0-51, lower is better)</Label>
              <Input
                id="converterQuality"
                type="number"
                value={converterQuality}
                min={0}
                max={51}
                onChange={(e) => setConverterQuality(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="converterMaxBytes">Max bytes</Label>
              <Input
                id="converterMaxBytes"
                type="number"
                value={converterMaxBytes}
                min={131072}
                max={100 * 1024 * 1024}
                onChange={(e) => setConverterMaxBytes(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <Button onClick={callVideoConverterAgent} disabled={converterLoading}>
              {converterLoading ? 'Calling Agent...' : 'Call Video Converter Agent'}
            </Button>
            {converterResponse && converterResponse.ok && (
              <Button variant="outline" onClick={loadConverterStatus} disabled={converterStatusLoading}>
                {converterStatusLoading ? 'Loading status…' : 'Load latest status (webhook-saved)'}
              </Button>
            )}
          </div>

          {converterResponse && converterResponse.ok && converterResponse.jobId && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Job Started</CardTitle>
                <CardDescription>
                  Job ID: <code className="font-mono text-xs">{converterResponse.jobId}</code>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  The worker is running in the background. When it finishes, it will POST results to the webhook and
                  store them in the database. Use &quot;Load latest status&quot; to read the saved record.
                </p>
              </CardContent>
            </Card>
          )}

          {converterJob && (
            <div className="space-y-4">
              <JobStatusView job={converterJob} isLoading={converterStatusLoading} />
              <JobResultView
                output={converterJob.output}
                workerId={converterJob.workerId}
                status={converterJob.status}
              />
            </div>
          )}
          {converterResponse && !converterResponse.ok && (
            <Card className="border-red-500/50">
              <CardHeader>
                <CardTitle className="text-base text-destructive">Error</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{converterResponse.error}</p>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
