'use client';

import { AiComponentMap } from '@/components/studio/context/ComponentProvider';
import { Dashboard } from './Dashboard';
import type { AiRouterTools } from '@/app/ai';

export const contactExtractorMap: AiComponentMap<
  Pick<AiRouterTools, 'contactExtractor'>,
  Pick<AiRouterTools, 'contactExtractor'>
>['tools'] = {
  contactExtractor: {
    full: Dashboard,
  },
};
