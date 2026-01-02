'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { JobStatusView, JobResultView } from '@/components/puppeteer';
import useSWR from 'swr';

type AgentResponse = {
  ok?: boolean;
  jobId?: string;
  workerId?: string;
  statusUrl?: string;
  message?: string;
  error?: string;
};

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

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: 'no-store' });
  const json = (await res.json()) as any;
  if (!res.ok) {
    throw new Error(json?.error || `Request failed (${res.status})`);
  }
  return json;
};

function JobStatusAndResult({ jobId, workerId }: { jobId: string; workerId: string }) {
  const { data, error, isLoading } = useSWR<JobResponse>(
    jobId ? `/api/worker-jobs/${jobId}` : null,
    fetcher,
    {
      refreshInterval: (data) => {
        const job = data?.ok ? data.job : null;
        // Stop polling if job is complete or failed
        if (job && (job.status === 'success' || job.status === 'error')) {
          return 0;
        }
        return 1000; // Poll every second while running
      },
      revalidateOnFocus: false,
    }
  );

  const job = data && data.ok ? data.job : null;

  return (
    <div className="space-y-4">
      <JobStatusView job={job} isLoading={isLoading} />
      {job && job.status === 'success' && (
        <JobResultView output={job.output} workerId={workerId} status={job.status} />
      )}
    </div>
  );
}

export default function PuppeteerDemoPage() {
  // Screenshot Agent
  const [screenshotUrl, setScreenshotUrl] = React.useState('https://example.com');
  const [screenshotFullPage, setScreenshotFullPage] = React.useState(false);
  const [screenshotWidth, setScreenshotWidth] = React.useState(1280);
  const [screenshotHeight, setScreenshotHeight] = React.useState(720);
  const [screenshotLoading, setScreenshotLoading] = React.useState(false);
  const [screenshotResponse, setScreenshotResponse] = React.useState<AgentResponse | null>(null);

  async function callScreenshotAgent() {
    setScreenshotLoading(true);
    setScreenshotResponse(null);

    try {
      const res = await fetch('/api/studio/chat/agent/puppeteer/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: screenshotUrl,
          fullPage: screenshotFullPage,
          viewport: { width: screenshotWidth, height: screenshotHeight },
        }),
      });

      const messages = await res.json();
      // Parse the streaming response format
      if (Array.isArray(messages) && messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        const jobIdPart = lastMessage.parts?.find((p: any) => p.type === 'data-text-jobId');
        const textPart = lastMessage.parts?.find((p: any) => p.type === 'text-delta' || p.type === 'text');
        
        if (jobIdPart) {
          setScreenshotResponse({
            ok: true,
            jobId: jobIdPart.data,
            workerId: 'puppeteer-screenshot',
            statusUrl: `/api/worker-jobs/${jobIdPart.data}`,
            message: textPart?.delta || textPart?.text || 'Screenshot job started',
          });
        } else {
          setScreenshotResponse({ ok: false, error: 'No job ID in response' });
        }
      } else {
        setScreenshotResponse({ ok: false, error: 'Invalid response format' });
      }
    } catch (error: any) {
      setScreenshotResponse({ ok: false, error: error.message });
    } finally {
      setScreenshotLoading(false);
    }
  }

  // PDF Agent
  const [pdfUrl, setPdfUrl] = React.useState('https://example.com');
  const [pdfFormat, setPdfFormat] = React.useState('A4');
  const [pdfLandscape, setPdfLandscape] = React.useState(false);
  const [pdfLoading, setPdfLoading] = React.useState(false);
  const [pdfResponse, setPdfResponse] = React.useState<AgentResponse | null>(null);

  async function callPdfAgent() {
    setPdfLoading(true);
    setPdfResponse(null);

    try {
      const res = await fetch('/api/studio/chat/agent/puppeteer/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: pdfUrl,
          format: pdfFormat,
          landscape: pdfLandscape,
        }),
      });

      const messages = await res.json();
      // Parse the streaming response format
      if (Array.isArray(messages) && messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        const jobIdPart = lastMessage.parts?.find((p: any) => p.type === 'data-text-jobId');
        const textPart = lastMessage.parts?.find((p: any) => p.type === 'text-delta' || p.type === 'text');
        
        if (jobIdPart) {
          setPdfResponse({
            ok: true,
            jobId: jobIdPart.data,
            workerId: 'puppeteer-pdf',
            statusUrl: `/api/worker-jobs/${jobIdPart.data}`,
            message: textPart?.delta || textPart?.text || 'PDF generation started',
          });
        } else {
          setPdfResponse({ ok: false, error: 'No job ID in response' });
        }
      } else {
        setPdfResponse({ ok: false, error: 'Invalid response format' });
      }
    } catch (error: any) {
      setPdfResponse({ ok: false, error: error.message });
    } finally {
      setPdfLoading(false);
    }
  }

  // Scraper Agent
  const [scraperUrl, setScraperUrl] = React.useState('https://example.com');
  const [scraperSelectors, setScraperSelectors] = React.useState('{\n  "title": "h1",\n  "description": "meta[name=\\"description\\"]"\n}');
  const [scraperLoading, setScraperLoading] = React.useState(false);
  const [scraperResponse, setScraperResponse] = React.useState<AgentResponse | null>(null);

  async function callScraperAgent() {
    setScraperLoading(true);
    setScraperResponse(null);

    try {
      let selectors;
      try {
        selectors = JSON.parse(scraperSelectors);
      } catch {
        throw new Error('Invalid JSON for selectors');
      }

      const res = await fetch('/api/studio/chat/agent/puppeteer/scraper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: scraperUrl,
          selectors,
        }),
      });

      const messages = await res.json();
      // Parse the streaming response format
      if (Array.isArray(messages) && messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        const jobIdPart = lastMessage.parts?.find((p: any) => p.type === 'data-text-jobId');
        const textPart = lastMessage.parts?.find((p: any) => p.type === 'text-delta' || p.type === 'text');
        
        if (jobIdPart) {
          setScraperResponse({
            ok: true,
            jobId: jobIdPart.data,
            workerId: 'puppeteer-scraper',
            statusUrl: `/api/worker-jobs/${jobIdPart.data}`,
            message: textPart?.delta || textPart?.text || 'Scraping job started',
          });
        } else {
          setScraperResponse({ ok: false, error: 'No job ID in response' });
        }
      } else {
        setScraperResponse({ ok: false, error: 'Invalid response format' });
      }
    } catch (error: any) {
      setScraperResponse({ ok: false, error: error.message });
    } finally {
      setScraperLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      <div className="container mx-auto max-w-6xl px-4 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Puppeteer Agent Demo</h1>
            <p className="text-muted-foreground mt-2">
              Test Puppeteer worker agents via the agent API route
            </p>
          </div>
          <Button asChild variant="ghost">
            <Link href="/studio">← Back to Studio</Link>
          </Button>
        </div>

        {/* Screenshot Agent */}
        <Card>
          <CardHeader>
            <CardTitle>Screenshot Agent</CardTitle>
            <CardDescription>
              Call <code className="font-mono text-xs">/api/studio/chat/agent/puppeteer/screenshot</code> to capture webpage screenshots
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="screenshot-url">URL</Label>
                <Input
                  id="screenshot-url"
                  value={screenshotUrl}
                  onChange={(e) => setScreenshotUrl(e.target.value)}
                  placeholder="https://example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="screenshot-width">Width</Label>
                <Input
                  id="screenshot-width"
                  type="number"
                  value={screenshotWidth}
                  min={240}
                  max={3840}
                  onChange={(e) => setScreenshotWidth(Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="screenshot-height">Height</Label>
                <Input
                  id="screenshot-height"
                  type="number"
                  value={screenshotHeight}
                  min={240}
                  max={2160}
                  onChange={(e) => setScreenshotHeight(Number(e.target.value))}
                />
              </div>
              <div className="space-y-2 flex items-center gap-2">
                <Checkbox
                  id="screenshot-fullpage"
                  checked={screenshotFullPage}
                  onCheckedChange={(checked) => setScreenshotFullPage(checked === true)}
                />
                <Label htmlFor="screenshot-fullpage" className="cursor-pointer">
                  Full Page Screenshot
                </Label>
              </div>
            </div>

            <Button onClick={callScreenshotAgent} disabled={screenshotLoading}>
              {screenshotLoading ? 'Calling Agent...' : 'Call Screenshot Agent'}
            </Button>

            {screenshotResponse && screenshotResponse.ok && screenshotResponse.jobId && (
              <JobStatusAndResult
                jobId={screenshotResponse.jobId}
                workerId={screenshotResponse.workerId || 'puppeteer-screenshot'}
              />
            )}
            {screenshotResponse && !screenshotResponse.ok && (
              <Card className="border-red-500/50">
                <CardHeader>
                  <CardTitle className="text-base text-destructive">Error</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{screenshotResponse.error}</p>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>

        {/* PDF Agent */}
        <Card>
          <CardHeader>
            <CardTitle>PDF Generator Agent</CardTitle>
            <CardDescription>
              Call <code className="font-mono text-xs">/api/studio/chat/agent/puppeteer/pdf</code> to generate PDFs from webpages
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="pdf-url">URL</Label>
                <Input
                  id="pdf-url"
                  value={pdfUrl}
                  onChange={(e) => setPdfUrl(e.target.value)}
                  placeholder="https://example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pdf-format">Format</Label>
                <select
                  id="pdf-format"
                  value={pdfFormat}
                  onChange={(e) => setPdfFormat(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                >
                  <option value="A4">A4</option>
                  <option value="Letter">Letter</option>
                  <option value="Legal">Legal</option>
                  <option value="A3">A3</option>
                  <option value="A5">A5</option>
                </select>
              </div>
              <div className="space-y-2 flex items-center gap-2">
                <Checkbox
                  id="pdf-landscape"
                  checked={pdfLandscape}
                  onCheckedChange={(checked) => setPdfLandscape(checked === true)}
                />
                <Label htmlFor="pdf-landscape" className="cursor-pointer">
                  Landscape
                </Label>
              </div>
            </div>

            <Button onClick={callPdfAgent} disabled={pdfLoading}>
              {pdfLoading ? 'Calling Agent...' : 'Call PDF Agent'}
            </Button>

            {pdfResponse && pdfResponse.ok && pdfResponse.jobId && (
              <JobStatusAndResult
                jobId={pdfResponse.jobId}
                workerId={pdfResponse.workerId || 'puppeteer-pdf'}
              />
            )}
            {pdfResponse && !pdfResponse.ok && (
              <Card className="border-red-500/50">
                <CardHeader>
                  <CardTitle className="text-base text-destructive">Error</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{pdfResponse.error}</p>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>

        {/* Scraper Agent */}
        <Card>
          <CardHeader>
            <CardTitle>Web Scraper Agent</CardTitle>
            <CardDescription>
              Call <code className="font-mono text-xs">/api/studio/chat/agent/puppeteer/scraper</code> to extract structured data from webpages
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="scraper-url">URL</Label>
                <Input
                  id="scraper-url"
                  value={scraperUrl}
                  onChange={(e) => setScraperUrl(e.target.value)}
                  placeholder="https://example.com"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="scraper-selectors">Selectors (JSON)</Label>
                <Textarea
                  id="scraper-selectors"
                  value={scraperSelectors}
                  onChange={(e) => setScraperSelectors(e.target.value)}
                  placeholder='{ "title": "h1", "description": "meta[name=\"description\"]" }'
                  className="font-mono text-sm"
                  rows={4}
                />
                <div className="text-xs text-muted-foreground">
                  Format: {`{ "fieldName": "css-selector" }`}
                </div>
              </div>
            </div>

            <Button onClick={callScraperAgent} disabled={scraperLoading}>
              {scraperLoading ? 'Calling Agent...' : 'Call Scraper Agent'}
            </Button>

            {scraperResponse && scraperResponse.ok && scraperResponse.jobId && (
              <JobStatusAndResult
                jobId={scraperResponse.jobId}
                workerId={scraperResponse.workerId || 'puppeteer-scraper'}
              />
            )}
            {scraperResponse && !scraperResponse.ok && (
              <Card className="border-red-500/50">
                <CardHeader>
                  <CardTitle className="text-base text-destructive">Error</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{scraperResponse.error}</p>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

