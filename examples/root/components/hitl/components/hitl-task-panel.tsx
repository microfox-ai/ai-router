'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { getHitlViewRenderer, listHitlViewIds } from '@/components/hitl/registry';
import type { QueueHitlDecisionPayload, QueueHitlTask } from '@/hooks/useWorkflowJob';
import { useMemo, useState } from 'react';

interface HitlTaskPanelProps {
  task: QueueHitlTask | null | undefined;
  busy: boolean;
  onSubmitDecision: (payload: QueueHitlDecisionPayload) => Promise<void>;
}

function extractUiSpec(task: QueueHitlTask | null | undefined): { type?: string; viewId?: string; title?: string } {
  if (!task?.uiSpec || typeof task.uiSpec !== 'object') return {};
  return task.uiSpec as Record<string, unknown>;
}

function extractViewId(task: QueueHitlTask | null | undefined): string | undefined {
  return extractUiSpec(task).viewId;
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function HitlTaskPanel({ task, busy, onSubmitDecision }: HitlTaskPanelProps) {
  const [rawInput, setRawInput] = useState('{\n  "example": "value"\n}');
  const viewId = extractViewId(task);
  const Renderer = useMemo(() => getHitlViewRenderer(viewId), [viewId]);

  if (!task) {
    return (
      <Alert>
        <AlertTitle>No active HITL task</AlertTitle>
        <AlertDescription>Run a queue job and wait for an `awaiting_approval` step.</AlertDescription>
      </Alert>
    );
  }

  if (Renderer) {
    return <Renderer task={task} busy={busy} onSubmitDecision={onSubmitDecision} />;
  }

  const uiSpec = extractUiSpec(task);
  const isSchemaForm = uiSpec.type === 'schema-form';

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        {isSchemaForm ? (
          <Badge variant="outline">schema-form</Badge>
        ) : (
          <>
            <Badge variant="destructive">Unknown view</Badge>
            <Badge variant="outline">{viewId ?? 'no viewId'}</Badge>
          </>
        )}
        {uiSpec.title ? <span className="text-sm font-medium">{uiSpec.title}</span> : null}
      </div>
      {isSchemaForm ? (
        <p className="text-sm text-muted-foreground">
          Submit reviewer input as JSON, or register a custom view via{' '}
          <code className="font-mono text-xs">registerHitlView(viewId, Component)</code>.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Register a renderer via <code className="font-mono text-xs">registerHitlView(&apos;{viewId}&apos;, Component)</code> in your app. Falling back to raw JSON.
        </p>
      )}
      <Textarea value={rawInput} onChange={(e) => setRawInput(e.target.value)} rows={8} />
      <div className="flex gap-2">
        <Button
          onClick={() => {
            let parsed: Record<string, unknown> = {};
            try {
              parsed = JSON.parse(rawInput) as Record<string, unknown>;
            } catch {
              parsed = { rawInput };
            }
            void onSubmitDecision({ decision: 'approve', input: parsed, reviewerId: 'hitl-fallback-ui' });
          }}
          disabled={busy}
        >
          Approve with JSON
        </Button>
        <Button
          variant="destructive"
          onClick={() => void onSubmitDecision({ decision: 'reject', reviewerId: 'hitl-fallback-ui' })}
          disabled={busy}
        >
          Reject
        </Button>
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Task payload</summary>
        <pre className="mt-2 overflow-auto rounded bg-muted p-2">{pretty(task)}</pre>
      </details>
      <p className="text-xs text-muted-foreground">Known view IDs: {listHitlViewIds().join(', ') || 'none'}</p>
    </div>
  );
}
