'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, XCircle, Play, RefreshCw, Globe, Film, Zap, ChevronDown, ChevronRight } from 'lucide-react';
import { useWorkflowJob } from '@/hooks/useWorkflowJob';
import type { WorkerJobResult } from '@/hooks/useWorkflowJob';

function OutputSection({ workerOutput, status }: { workerOutput: WorkerJobResult | null; status: string }) {
  const [showRaw, setShowRaw] = useState(false);
  if (!workerOutput) return null;

  const hasResultOutput = workerOutput.output !== undefined && workerOutput.output !== null;
  const hasErrorOutput = workerOutput.error !== undefined && workerOutput.error !== null;

  return (
    <div className="space-y-3">
      {status === 'completed' && hasResultOutput && (
        <div className="rounded-lg border bg-muted/50 p-3 text-sm">
          <p className="font-medium mb-2 text-muted-foreground">Result output</p>
          <pre className="whitespace-pre-wrap break-words overflow-auto max-h-80">{JSON.stringify(workerOutput.output, null, 2)}</pre>
        </div>
      )}
      {status === 'failed' && hasErrorOutput && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <p className="font-medium mb-2 text-destructive">Job error</p>
          <pre className="whitespace-pre-wrap break-words overflow-auto max-h-48">{JSON.stringify(workerOutput.error, null, 2)}</pre>
        </div>
      )}
      <div>
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {showRaw ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Raw job result
        </button>
        {showRaw && (
          <pre className="mt-2 rounded-lg border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words overflow-auto max-h-60">
            {JSON.stringify(workerOutput, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function DemoWorkerPanel() {
  const [message, setMessage] = useState('Hello from worker');
  const { trigger, jobId, status, output, error, loading, polling, reset } = useWorkflowJob({
    type: 'worker',
    workerId: 'demo',
    pollIntervalMs: 1500,
    pollTimeoutMs: 60_000,
    autoPoll: true,
  });

  const workerOutput = output && 'workerId' in output ? output : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Demo worker</CardTitle>
        <CardDescription>Echo or dispatch-demo. Dispatch demo proves ctx.dispatchWorker with await: true / false.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="demo-message">Message (echo mode)</Label>
          <Input
            id="demo-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Message to echo back"
            disabled={loading || polling}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => trigger({ mode: 'echo', message })} disabled={loading || polling}>
            {(loading || polling) ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            {loading ? 'Triggering…' : polling ? 'Waiting…' : 'Run echo'}
          </Button>
          <Button variant="secondary" onClick={() => trigger({ mode: 'dispatch-demo' })} disabled={loading || polling}>
            Run dispatch demo
          </Button>
          <Button variant="outline" onClick={reset} disabled={loading || polling}>
            <RefreshCw className="w-4 h-4 mr-2" /> Reset
          </Button>
        </div>
        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        {(jobId || status !== 'idle') && (
          <div className="space-y-4 rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Status:</span>
              <Badge variant={status === 'completed' ? 'default' : status === 'failed' ? 'destructive' : 'secondary'}>{status}</Badge>
            </div>
            {jobId && <p className="text-sm text-muted-foreground font-mono break-all">Job ID: {jobId}</p>}
            {workerOutput && <OutputSection workerOutput={workerOutput} status={status} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScraperWorkerPanel() {
  const [url, setUrl] = useState('https://vishwaj33t.com');
  const [selectorsJson, setSelectorsJson] = useState('{"title": "title", "description": "meta[name=\\"description\\"]"}');
  const { trigger, jobId, status, output, error, loading, polling, reset } = useWorkflowJob({
    type: 'worker',
    workerId: 'puppeteer-scraper',
    pollIntervalMs: 2000,
    pollTimeoutMs: 120_000,
    autoPoll: true,
  });

  const workerOutput = output && 'workerId' in output ? output : null;

  const handleRun = () => {
    let selectors: Record<string, string>;
    try {
      selectors = JSON.parse(selectorsJson) as Record<string, string>;
    } catch {
      selectors = { body: 'body' };
    }
    trigger({ url, selectors });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Puppeteer Scraper (group: scraper)</CardTitle>
        <CardDescription>Extract structured data from a URL using CSS selectors. Uses @microfox/puppeteer-sls.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="scraper-url">URL</Label>
          <Input
            id="scraper-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://vishwaj33t.com"
            disabled={loading || polling}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="scraper-selectors">Selectors (JSON)</Label>
          <Input
            id="scraper-selectors"
            value={selectorsJson}
            onChange={(e) => setSelectorsJson(e.target.value)}
            placeholder='{"title": "title", "description": "meta[name=\"description\"]"}'
            disabled={loading || polling}
            className="font-mono text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleRun} disabled={loading || polling}>
            {(loading || polling) ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            {loading ? 'Triggering…' : polling ? 'Waiting…' : 'Run scraper'}
          </Button>
          <Button variant="outline" onClick={reset} disabled={loading || polling}>
            <RefreshCw className="w-4 h-4 mr-2" /> Reset
          </Button>
        </div>
        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        {(jobId || status !== 'idle') && (
          <div className="space-y-4 rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Status:</span>
              <Badge variant={status === 'completed' ? 'default' : status === 'failed' ? 'destructive' : 'secondary'}>{status}</Badge>
            </div>
            {jobId && <p className="text-sm text-muted-foreground font-mono break-all">Job ID: {jobId}</p>}
            {workerOutput && <OutputSection workerOutput={workerOutput} status={status} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FFprobeWorkerPanel() {
  const [mediaUrl, setMediaUrl] = useState('https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_30MB.mp4');
  const [timeoutSeconds, setTimeoutSeconds] = useState(90);
  const { trigger, jobId, status, output, error, loading, polling, reset } = useWorkflowJob({
    type: 'worker',
    workerId: 'ffprobe-media',
    pollIntervalMs: 2000,
    pollTimeoutMs: 90_000,
    autoPoll: true,
  });

  const workerOutput = output && 'workerId' in output ? output : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>FFprobe Media (group: media)</CardTitle>
        <CardDescription>Analyze a media file: duration, resolution, fps, container. Requires ffprobe (Lambda: ffmpeg layer).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ffprobe-url">Media URL</Label>
          <Input
            id="ffprobe-url"
            value={mediaUrl}
            onChange={(e) => setMediaUrl(e.target.value)}
            placeholder="https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_30MB.mp4"
            disabled={loading || polling}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ffprobe-timeout">Timeout (seconds)</Label>
          <Input
            id="ffprobe-timeout"
            type="number"
            min={1}
            max={300}
            value={timeoutSeconds}
            onChange={(e) => setTimeoutSeconds(Number(e.target.value) || 90)}
            disabled={loading || polling}
          />
          <p className="text-xs text-muted-foreground">Time allowed for download + ffprobe (1–300s). Default 90s for Lambda.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => trigger({ mediaUrl, timeoutMs: timeoutSeconds * 1000 })} disabled={loading || polling}>
            {(loading || polling) ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            {loading ? 'Triggering…' : polling ? 'Waiting…' : 'Analyze media'}
          </Button>
          <Button variant="outline" onClick={reset} disabled={loading || polling}>
            <RefreshCw className="w-4 h-4 mr-2" /> Reset
          </Button>
        </div>
        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        {(jobId || status !== 'idle') && (
          <div className="space-y-4 rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Status:</span>
              <Badge variant={status === 'completed' ? 'default' : status === 'failed' ? 'destructive' : 'secondary'}>{status}</Badge>
            </div>
            {jobId && <p className="text-sm text-muted-foreground font-mono break-all">Job ID: {jobId}</p>}
            {workerOutput && <OutputSection workerOutput={workerOutput} status={status} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function WorkerDemoPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Worker demo</h1>
        <p className="text-muted-foreground">
          Trigger workers from different groups: <code className="rounded bg-muted px-1">default</code>, <code className="rounded bg-muted px-1">scraper</code>, and <code className="rounded bg-muted px-1">media</code>. Each uses the same workflow API; workers are deployed via ai-worker push (multi-group).
        </p>
      </div>

      <Tabs defaultValue="demo" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="demo" className="flex items-center gap-2">
            <Zap className="h-4 w-4" /> Demo
          </TabsTrigger>
          <TabsTrigger value="scraper" className="flex items-center gap-2">
            <Globe className="h-4 w-4" /> Scraper
          </TabsTrigger>
          <TabsTrigger value="ffprobe" className="flex items-center gap-2">
            <Film className="h-4 w-4" /> FFprobe
          </TabsTrigger>
        </TabsList>
        <TabsContent value="demo" className="mt-4">
          <DemoWorkerPanel />
        </TabsContent>
        <TabsContent value="scraper" className="mt-4">
          <ScraperWorkerPanel />
        </TabsContent>
        <TabsContent value="ffprobe" className="mt-4">
          <FFprobeWorkerPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
