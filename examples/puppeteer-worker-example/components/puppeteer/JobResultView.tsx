'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, Image as ImageIcon, FileText, Database } from 'lucide-react';

type JobOutput = {
  url?: string;
  screenshotBase64?: string;
  width?: number;
  height?: number;
  fullPage?: boolean;
  format?: string;
  sizeBytes?: number;
  pdfBase64?: string;
  landscape?: boolean;
  data?: Record<string, string | string[] | null>;
  fieldsFound?: string[];
  fieldsNotFound?: string[];
  highlights?: Array<{ id: number; textPreview: string }>;
  frameCount?: number;
  previewFramesBase64Jpeg?: string[];
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

  // Screenshot Worker Results
  if (workerId === 'puppeteer-screenshot' && output.screenshotBase64) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5" />
            <CardTitle className="text-base">Screenshot Result</CardTitle>
          </div>
          <CardDescription>
            {output.url && (
              <span>
                URL: <code className="font-mono text-xs">{output.url}</code>
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border overflow-hidden">
            <img
              src={`data:image/png;base64,${output.screenshotBase64}`}
              alt="Screenshot"
              className="w-full h-auto"
            />
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {output.width && output.height && (
              <>
                <div>
                  <div className="text-muted-foreground">Dimensions</div>
                  <div className="font-medium">
                    {output.width} × {output.height}px
                  </div>
                </div>
              </>
            )}
            {output.sizeBytes && (
              <div>
                <div className="text-muted-foreground">File Size</div>
                <div className="font-medium">
                  {(output.sizeBytes / 1024).toFixed(2)} KB
                </div>
              </div>
            )}
            {output.fullPage !== undefined && (
              <div>
                <div className="text-muted-foreground">Type</div>
                <Badge variant="outline">
                  {output.fullPage ? 'Full Page' : 'Viewport'}
                </Badge>
              </div>
            )}
          </div>
          <Button
            onClick={() => {
              if (!output.screenshotBase64) {
                alert('Screenshot data is not available');
                return;
              }
              
              try {
                // Clean the base64 string (remove whitespace, newlines, data URL prefix if present)
                let base64Data = output.screenshotBase64.trim();
                
                // Remove data URL prefix if present (e.g., "data:image/png;base64,")
                if (base64Data.includes(',')) {
                  base64Data = base64Data.split(',')[1];
                }
                
                // Remove any whitespace or newlines
                base64Data = base64Data.replace(/\s/g, '');
                
                // Validate base64 format
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
                const blob = new Blob([bytes], { type: 'image/png' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `screenshot-${Date.now()}.png`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                // Clean up the blob URL after a delay
                setTimeout(() => URL.revokeObjectURL(url), 100);
              } catch (error: any) {
                console.error('Screenshot download error:', error);
                alert(`Failed to download screenshot: ${error.message || 'Unknown error'}`);
              }
            }}
            className="w-full"
            variant="outline"
          >
            <Download className="h-4 w-4 mr-2" />
            Download Screenshot
          </Button>
        </CardContent>
      </Card>
    );
  }

  // PDF Worker Results
  if (workerId === 'puppeteer-pdf' && output.pdfBase64) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            <CardTitle className="text-base">PDF Result</CardTitle>
          </div>
          <CardDescription>
            {output.url && (
              <span>
                URL: <code className="font-mono text-xs">{output.url}</code>
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            {output.format && (
              <div>
                <div className="text-muted-foreground">Format</div>
                <Badge variant="outline">{output.format}</Badge>
              </div>
            )}
            {output.landscape !== undefined && (
              <div>
                <div className="text-muted-foreground">Orientation</div>
                <Badge variant="outline">
                  {output.landscape ? 'Landscape' : 'Portrait'}
                </Badge>
              </div>
            )}
            {output.sizeBytes && (
              <div>
                <div className="text-muted-foreground">File Size</div>
                <div className="font-medium">
                  {(output.sizeBytes / 1024).toFixed(2)} KB
                </div>
              </div>
            )}
          </div>
          <Button
            onClick={() => {
              if (!output.pdfBase64) {
                alert('PDF data is not available');
                return;
              }
              
              try {
                // Clean the base64 string (remove whitespace, newlines, data URL prefix if present)
                let base64Data = output.pdfBase64.trim();
                
                // Remove data URL prefix if present (e.g., "data:application/pdf;base64,")
                if (base64Data.includes(',')) {
                  base64Data = base64Data.split(',')[1];
                }
                
                // Remove any whitespace or newlines
                base64Data = base64Data.replace(/\s/g, '');
                
                // Validate base64 format
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
                const blob = new Blob([bytes], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `generated-${Date.now()}.pdf`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                // Clean up the blob URL after a delay
                setTimeout(() => URL.revokeObjectURL(url), 100);
              } catch (error: any) {
                console.error('PDF download error:', error);
                alert(`Failed to download PDF: ${error.message || 'Unknown error'}`);
              }
            }}
            className="w-full"
            variant="outline"
          >
            <Download className="h-4 w-4 mr-2" />
            Download PDF
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Scraper Worker Results
  if (workerId === 'puppeteer-scraper' && output.data) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            <CardTitle className="text-base">Scraped Data</CardTitle>
          </div>
          <CardDescription>
            {output.url && (
              <span>
                URL: <code className="font-mono text-xs">{output.url}</code>
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {output.fieldsFound && output.fieldsFound.length > 0 && (
            <div>
              <div className="text-sm font-medium mb-2">Fields Found</div>
              <div className="flex flex-wrap gap-2">
                {output.fieldsFound.map((field) => (
                  <Badge key={field} variant="default">
                    {field}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {output.fieldsNotFound && output.fieldsNotFound.length > 0 && (
            <div>
              <div className="text-sm font-medium mb-2 text-muted-foreground">Fields Not Found</div>
              <div className="flex flex-wrap gap-2">
                {output.fieldsNotFound.map((field) => (
                  <Badge key={field} variant="outline">
                    {field}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="text-sm font-medium mb-2">Extracted Data</div>
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <pre className="text-xs whitespace-pre-wrap overflow-x-auto">
                  {JSON.stringify(output.data, null, 2)}
                </pre>
              </CardContent>
            </Card>
          </div>
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

