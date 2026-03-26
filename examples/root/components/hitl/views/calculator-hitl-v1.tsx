'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { HitlViewProps } from '@/components/hitl/types';
import {
  CALCULATOR_OPERATORS,
  type CalculatorHitlUiSpec,
  type CalculatorOperator,
} from '@/app/ai/queues/calculator-session.hitl-shared';

export function isCalculatorHitlUiSpec(value: unknown): value is CalculatorHitlUiSpec {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.viewId === 'calculator-hitl-v1' && Array.isArray(v.sections);
}

const OP_LABELS: Record<CalculatorOperator, string> = {
  add: '+',
  subtract: '-',
  multiply: 'x',
  divide: '/',
};

function parseNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getCurrentAndHistory(task: HitlViewProps['task']) {
  const prev = task.previousOutputs ?? [];
  const last = prev[prev.length - 1]?.output as
    | { current?: number; history?: string[] }
    | undefined;
  return {
    current: typeof last?.current === 'number' ? last.current : 0,
    history: Array.isArray(last?.history) ? last.history : [],
  };
}

export function CalculatorHitlV1View({ task, busy, onSubmitDecision }: HitlViewProps) {
  const [entry, setEntry] = useState('0');
  const [operator, setOperator] = useState<CalculatorOperator>('add');
  const [continueLoop, setContinueLoop] = useState(true);

  const { current, history } = useMemo(() => getCurrentAndHistory(task), [task]);
  const ui = isCalculatorHitlUiSpec(task.uiSpec) ? task.uiSpec : null;
  const keypadSection = ui?.sections.find((s) => s.type === 'calculator-keypad');
  const hintSection = ui?.sections.find((s) => s.type === 'hint');
  const quickNumbers = keypadSection?.type === 'calculator-keypad' ? keypadSection.quickNumbers ?? [] : [];

  const submitApprove = async () => {
    await onSubmitDecision({
      decision: 'approve',
      input: {
        nextNumber: parseNumber(entry),
        operator,
        continueLoop,
      },
      reviewerId: 'calculator-demo',
      comment: '',
    });
    setEntry('0');
  };

  const appendDigit = (digit: string) => {
    setEntry((prev) => {
      if (digit === '.' && prev.includes('.')) return prev;
      if (prev === '0' && digit !== '.') return digit;
      return `${prev}${digit}`;
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-black px-4 py-3 text-right text-3xl font-mono text-green-400">
        {entry !== '0' ? entry : current.toString()}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">step {task.stepIndex}</Badge>
        <Badge variant="secondary">
          {task.progress ? `${task.progress.completedSteps + 1}/${task.progress.totalSteps}` : 'awaiting input'}
        </Badge>
      </div>

      <div className="space-y-2">
        <Label>Operator</Label>
        <div className="flex gap-2">
          {CALCULATOR_OPERATORS.map((op) => (
            <Button
              key={op}
              type="button"
              variant={operator === op ? 'default' : 'outline'}
              onClick={() => setOperator(op)}
              disabled={busy}
            >
              {OP_LABELS[op]}
            </Button>
          ))}
        </div>
      </div>

      {quickNumbers.length > 0 ? (
        <div className="space-y-2">
          <Label>Quick numbers</Label>
          <div className="flex flex-wrap gap-2">
            {quickNumbers.map((n) => (
              <Button key={n} type="button" variant="outline" size="sm" onClick={() => setEntry(String(n))} disabled={busy}>
                {n}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-4 gap-2">
        {['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.', 'C'].map((v) => (
          <Button
            key={v}
            type="button"
            variant={v === 'C' ? 'secondary' : 'outline'}
            onClick={() => (v === 'C' ? setEntry('0') : appendDigit(v))}
            disabled={busy}
            className="h-11 text-base"
          >
            {v}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-3 rounded-md border px-3 py-2">
        <span className="flex-1 text-sm">Continue after this step?</span>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={continueLoop ? 'default' : 'outline'}
            onClick={() => setContinueLoop(true)}
            disabled={busy}
          >
            Continue
          </Button>
          <Button
            type="button"
            size="sm"
            variant={!continueLoop ? 'destructive' : 'outline'}
            onClick={() => setContinueLoop(false)}
            disabled={busy}
          >
            Finish
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="hitl-comment">Reviewer comment (optional)</Label>
        <Input id="hitl-comment" placeholder="Why this decision?" disabled={busy} />
      </div>

      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => void submitApprove()} disabled={busy}>
          {continueLoop ? `Apply ${OP_LABELS[operator]} ${entry} & continue` : `Apply ${OP_LABELS[operator]} ${entry} & finish`}
        </Button>
        <Button
          variant="destructive"
          onClick={() =>
            void onSubmitDecision({
              decision: 'reject',
              comment: 'Rejected from calculator UI',
              reviewerId: 'calculator-demo',
            })
          }
          disabled={busy}
        >
          Reject
        </Button>
      </div>

      {hintSection?.type === 'hint' ? (
        <>
          <Separator />
          <p className="text-xs text-muted-foreground">{hintSection.text}</p>
        </>
      ) : null}

      {history.length > 0 && keypadSection?.type === 'calculator-keypad' && keypadSection.showHistory ? (
        <div className="rounded-md border p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">History</p>
          <div className="space-y-1">
            {history.map((line, idx) => (
              <div key={`${line}-${idx}`} className="font-mono text-xs">
                {line}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
