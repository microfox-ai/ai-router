import { UIMessage } from '@ai-sdk/react';
import { AgentTool } from '@microfox/ai-router';
import { ToolUIPart } from 'ai';

const EXCLUDED_PARTS = ['tool-', 'step-start'];
const MUST_INCLUDE_PARTS = ['tool-ui-'];

export const getDisplayParts = (
  message: UIMessage<any, any, any>,
  aiRouterMetadata?: Record<string, AgentTool['metadata']>,
) => {
  return message?.parts?.filter((part) => {
    if (part.type.startsWith('tool-ui-')) {
      if ((part as any).output?.props?.isUISticky) {
        return false;
      }
      return true;
    }
    if (part.type === 'text') {
      if ((part as any).text.replaceAll('/n', '').trim() === '') {
        return false;
      }
      return true;
    }
    if (
      part.type.startsWith('tool-') &&
      (part as any).state == 'output-available' &&
      !(aiRouterMetadata
        ? aiRouterMetadata[
            (part as any).type.replace(
              'tool-',
              '',
            ) as keyof typeof aiRouterMetadata
          ]?.hideUI
        : true)
      // && ((part as any).output?.data || (part as any).output?.ui)
    ) {
      return true;
    }
    if (
      part.type.startsWith('data-') &&
      !(part as any).data?.metadata?.hideUI
    ) {
      return true;
    }
    if (
      part.type.match(/summary/i) &&
      (part as any).state == 'output-available' &&
      (part as any).output?.summary &&
      (part as any).output?._isFinal
    ) {
      return true;
    }
    if (EXCLUDED_PARTS.some((excluded) => part.type.startsWith(excluded))) {
      return false;
    }
    return true;
  });
};

export const getToolParts = (message: UIMessage<any, any, any>) => {
  return message?.parts?.filter((part) => {
    if (part.type.startsWith('tool-')) {
      return true;
    }
  }) as ToolUIPart<any>[];
};

export const getUiParts = (message: UIMessage<any, any, any>) => {
  return message?.parts?.filter(
    (part) =>
      part.type.startsWith('tool-ui-') ||
      (part as any).output?._humanIntervention,
  ) as ToolUIPart[];
};

/**
 * Sticky Parts are that parts which are sticky even in the next parts they appear..
 * @param parts
 * @returns
 */
export const getStickyUiParts = (parts: ToolUIPart<any>[]) => {
  return parts?.filter(
    (part, _index) =>
      (part.type.startsWith('data-') &&
        (part as any).data?.metadata?.isUISticky) ||
      (part.state === 'output-available' &&
        ((part as any).output?.metadata?.isUISticky ||
          part.output?._humanIntervention)),
  );
};

export const getLastActiveToolPart = (
  message: UIMessage<any, any, any>,
  activePart: number,
  displayParts?: UIMessage<any, any, any>['parts'],
): ToolUIPart<any> | undefined => {
  if (!displayParts || displayParts.length === 0) {
    return undefined;
  }

  if (activePart === displayParts.length - 1) {
    const lastDisplayPart = displayParts[activePart];

    if (lastDisplayPart && displayParts) {
      const originalIndexOfLastDisplayPart =
        displayParts.lastIndexOf(lastDisplayPart);

      if (originalIndexOfLastDisplayPart > 0) {
        for (let i = originalIndexOfLastDisplayPart - 1; i >= 0; i--) {
          const part = displayParts[i];
          if (
            part &&
            part.type.startsWith('tool-') &&
            !part.type.startsWith('tool-ui-')
          ) {
            return part as ToolUIPart<any>;
          }
        }
      }
    }
  }

  return undefined;
};
