import type { ComponentType } from 'react';
import type { QueueHitlDecisionPayload, QueueHitlTask } from '@/hooks/useWorkflowJob';

export interface HitlViewProps {
  task: QueueHitlTask;
  busy: boolean;
  onSubmitDecision: (payload: QueueHitlDecisionPayload) => Promise<void>;
}

export type HitlViewRenderer = ComponentType<HitlViewProps>;
