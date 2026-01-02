'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, FileVideo, Info } from 'lucide-react';

type JobOutput = {
  mediaUrl?: string;
  ffprobePath?: string;
  ffprobeVersion?: string;
  bytesDownloaded?: number;
  summary?: {
    durationSec: number | null;
    containerFormat: string | null;
    hasVideo: boolean;
    hasAudio: boolean;
    width: number | null;
    height: number | null;
    fps: number | null;
    orientation: 'landscape' | 'portrait' | 'square' | 'unknown';
  };
  notes?: string[];
  outputFormat?: string;
  ffmpegPath?: string;
  ffmpegVersion?: string;
  inputBytes?: number;
  outputBytes?: number;
  outputPath?: string;
  outputBase64?: string;
  conversionTimeMs?: number;
  [key: string]: any;
};

interface JobResultViewProps {
  output: JobOutput | null | undefined;
  workerId: string;
  status: 'queued' | 'running' | 'success' | 'error';
}

export function JobResultView({ output, workerId, status }: JobResultViewProps) {
  if (!output || status !== 'success') {
    return null;
  }

  // FFprobe Worker Results
  if (workerId === 'ffprobe-media-summary' && output.summary) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            <CardTitle className="text-base">Media Analysis Result</CardTitle>
          </div>
          <CardDescription>
            {output.mediaUrl && (
              <span>
                URL: <code className="font-mono text-xs">{output.mediaUrl}</code>
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            {output.summary.durationSec !== null && (
              <div>
                <div className="text-muted-foreground">Duration</div>
                <div className="font-medium">
                  {output.summary.durationSec.toFixed(2)}s
                </div>
              </div>
            )}
            {output.summary.containerFormat && (
              <div>
                <div className="text-muted-foreground">Format</div>
                <Badge variant="outline">{output.summary.containerFormat}</Badge>
              </div>
            )}
            {output.summary.width && output.summary.height && (
              <div>
                <div className="text-muted-foreground">Resolution</div>
                <div className="font-medium">
                  {output.summary.width} × {output.summary.height}px
                </div>
              </div>
            )}
            {output.summary.fps !== null && (
              <div>
                <div className="text-muted-foreground">Frame Rate</div>
                <div className="font-medium">
                  {output.summary.fps.toFixed(2)} fps
                </div>
              </div>
            )}
            <div>
              <div className="text-muted-foreground">Video</div>
              <Badge variant={output.summary.hasVideo ? 'default' : 'outline'}>
                {output.summary.hasVideo ? 'Yes' : 'No'}
              </Badge>
            </div>
            <div>
              <div className="text-muted-foreground">Audio</div>
              <Badge variant={output.summary.hasAudio ? 'default' : 'outline'}>
                {output.summary.hasAudio ? 'Yes' : 'No'}
              </Badge>
            </div>
            {output.summary.orientation && (
              <div>
                <div className="text-muted-foreground">Orientation</div>
                <Badge variant="outline" className="capitalize">
                  {output.summary.orientation}
                </Badge>
              </div>
            )}
            {output.bytesDownloaded && (
              <div>
                <div className="text-muted-foreground">File Size</div>
                <div className="font-medium">
                  {(output.bytesDownloaded / 1024 / 1024).toFixed(2)} MB
                </div>
              </div>
            )}
          </div>
          {output.ffprobeVersion && (
            <div className="text-xs text-muted-foreground">
              FFprobe: {output.ffprobeVersion}
            </div>
          )}
          {output.notes && output.notes.length > 0 && (
            <div className="space-y-1">
              <div className="text-sm font-medium">Notes</div>
              <div className="space-y-1">
                {output.notes.map((note, idx) => (
                  <div key={idx} className="text-xs text-muted-foreground">
                    • {note}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Video Converter Worker Results
  if (workerId === 'video-converter' && output.outputFormat) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileVideo className="h-5 w-5" />
            <CardTitle className="text-base">Video Conversion Result</CardTitle>
          </div>
          <CardDescription>
            {output.mediaUrl && (
              <span>
                URL: <code className="font-mono text-xs">{output.mediaUrl}</code>
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            {output.outputFormat && (
              <div>
                <div className="text-muted-foreground">Output Format</div>
                <Badge variant="outline" className="uppercase">
                  {output.outputFormat}
                </Badge>
              </div>
            )}
            {output.inputBytes && (
              <div>
                <div className="text-muted-foreground">Input Size</div>
                <div className="font-medium">
                  {(output.inputBytes / 1024 / 1024).toFixed(2)} MB
                </div>
              </div>
            )}
            {output.outputBytes && (
              <div>
                <div className="text-muted-foreground">Output Size</div>
                <div className="font-medium">
                  {(output.outputBytes / 1024 / 1024).toFixed(2)} MB
                </div>
              </div>
            )}
            {output.conversionTimeMs && (
              <div>
                <div className="text-muted-foreground">Conversion Time</div>
                <div className="font-medium">
                  {(output.conversionTimeMs / 1000).toFixed(2)}s
                </div>
              </div>
            )}
          </div>
          {output.ffmpegVersion && (
            <div className="text-xs text-muted-foreground">
              FFmpeg: {output.ffmpegVersion}
            </div>
          )}
          {output.outputBase64 && (
            <Button
              onClick={() => {
                if (!output.outputBase64) {
                  alert('Video data is not available');
                  return;
                }
                
                try {
                  // Clean the base64 string
                  let base64Data = output.outputBase64.trim();
                  if (base64Data.includes(',')) {
                    base64Data = base64Data.split(',')[1];
                  }
                  base64Data = base64Data.replace(/\s/g, '');
                  
                  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Data)) {
                    throw new Error('Invalid base64 format');
                  }
                  
                  // Convert base64 to binary
                  const binaryString = atob(base64Data);
                  const bytes = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  
                  // Create blob and download
                  const mimeType = `video/${output.outputFormat}`;
                  const blob = new Blob([bytes], { type: mimeType });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `converted-${Date.now()}.${output.outputFormat}`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  
                  setTimeout(() => URL.revokeObjectURL(url), 100);
                } catch (error: any) {
                  console.error('Video download error:', error);
                  alert(`Failed to download video: ${error.message || 'Unknown error'}`);
                }
              }}
              className="w-full"
              variant="outline"
            >
              <Download className="h-4 w-4 mr-2" />
              Download Converted Video
            </Button>
          )}
          {output.notes && output.notes.length > 0 && (
            <div className="space-y-1">
              <div className="text-sm font-medium">Notes</div>
              <div className="space-y-1">
                {output.notes.map((note, idx) => (
                  <div key={idx} className="text-xs text-muted-foreground">
                    • {note}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Generic output display
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Job Output</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="text-xs whitespace-pre-wrap overflow-x-auto rounded-md bg-muted p-3">
          {JSON.stringify(output, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}

