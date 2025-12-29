import { AiRouterTools } from '@/app/ai';
import { AiComponentMap } from '@/components/studio/context/ComponentProvider';

export const summariseComponentMap: AiComponentMap<
  Pick<AiRouterTools, 'summarizeResearch'>,
  Pick<AiRouterTools, 'summarizeResearch'>
>['tools'] = {
  summarizeResearch: {
    // full: SummarizeFull,
    // footer_sticky: SummarizeFooter,
    // header_sticky: SummarizeHeader,
  },
};
