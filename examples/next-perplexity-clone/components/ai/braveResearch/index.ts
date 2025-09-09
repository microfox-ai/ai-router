import { AiRouterTools } from '@/app/ai';
import { AiComponentMap } from '@/components/studio/context/ComponentProvider';
import { BraveResults } from './fast/output';
import { ToolUIPart } from 'ai';
import { BraveSourceFooter } from './fast/footer';
import { BraveSourceHeader } from './fast/header';
import { braveResearchAgent } from '@/app/ai/agents/braveResearch';

export const braveResearchMap: AiComponentMap<
  Pick<AiRouterTools, 'braveResearchFast' | 'braveResearchDeep'>,
  Pick<AiRouterTools, 'braveResearchFast' | 'braveResearchDeep'>
>['tools'] = {
  braveResearchDeep: {
    full: BraveResults,
    footer_sticky: BraveSourceFooter,
    header_sticky: BraveSourceHeader,
  },
  braveResearchFast: {
    full: BraveResults,
    footer_sticky: BraveSourceFooter,
    header_sticky: BraveSourceHeader,
  },
};
