import { WebSearchOutput } from '@/components/ai/braveResearch/types';

/**
 * Downsize the research data to the specified maximum characters per search and total
 * @param researchData - The research data to downsize
 * @param maxCharsLengthPerSearch - The maximum characters per search
 * @param maxCharsTotal - The maximum characters total
 * @returns The downsized research data
 */
export const downsizeResearchData = (
  researchData: Record<string, WebSearchOutput>,
  maxCharsTotal: number,
  maxCharsLengthPerSearch?: number,
) => {
  // 10_000 cap & 4 searches => 2_500 per search max context.
  if (!maxCharsLengthPerSearch) {
    maxCharsLengthPerSearch = parseInt(
      Math.floor(maxCharsTotal / Object.keys(researchData).length).toString(),
    );
  }

  const downsizedResearchData = Object.keys(researchData).reduce(
    (acc, key) => {
      const text = JSON.stringify(researchData[key]);
      const textLength = text.length;
      if (textLength > maxCharsLengthPerSearch) {
        acc[key] = text.slice(0, maxCharsLengthPerSearch);
      } else {
        acc[key] = text;
      }
      return acc;
    },
    {} as Record<string, string>,
  );

  const downsizedResearchDataTotal = Object.values(
    downsizedResearchData,
  ).reduce((acc, text) => {
    if (acc.length + text.length > maxCharsTotal) {
      return acc + text.slice(0, maxCharsTotal - acc.length);
    } else {
      return acc + text;
    }
  }, '');

  return downsizedResearchDataTotal;
};
