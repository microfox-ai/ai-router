import { AiRouter } from '@microfox/ai-router';
import { jsDom } from './helpers/jsDom';

interface ContactInfo {
  value: string;
  context: string;
}

function extractEmailsWithContext(text: string): ContactInfo[] {
  const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi;
  const emails: ContactInfo[] = [];
  let match;
  while ((match = emailRegex.exec(text)) !== null) {
    const startIndex = Math.max(0, match.index - 50);
    const endIndex = Math.min(text.length, match.index + match[0].length + 50);
    const context = text
      .substring(startIndex, endIndex)
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    emails.push({ value: match[0], context });
  }
  return emails;
}

function extractSocialsWithContext(html: string): ContactInfo[] {
  const socialRegex =
    /href="(https?:\/\/(?:www\.)?(?:linkedin\.com\/in\/|github\.com\/|twitter\.com\/|behance\.net\/|dribbble\.com\/)[a-zA-Z0-9\._-]+)"/gi;
  const socials: ContactInfo[] = [];
  let match;
  while ((match = socialRegex.exec(html)) !== null) {
    const startIndex = Math.max(0, match.index - 100);
    const endIndex = Math.min(html.length, match.index + match[0].length + 100);
    const context = html
      .substring(startIndex, endIndex)
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    socials.push({ value: match[1], context });
  }
  return socials;
}

function extractOtherLinksWithContext(html: string): ContactInfo[] {
  const linkRegex = /href="(https?:\/\/[^"]+)"/gi;
  const links: ContactInfo[] = [];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    if (
      !/(linkedin\.com|github\.com|twitter\.com|behance\.net|dribbble\.com)/.test(
        match[1],
      ) &&
      !/\.(jpg|jpeg|png|gif|svg|ico)$/i.test(match[1])
    ) {
      const startIndex = Math.max(0, match.index - 100);
      const endIndex = Math.min(html.length, match.index + match[0].length + 100);
      const context = html
        .substring(startIndex, endIndex)
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      links.push({ value: match[1], context });
    }
  }
  return links;
}

async function fetchResourceContent(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (
      !response.ok ||
      !response.headers.get('content-type')?.match(/text|javascript/)
    ) {
      return null;
    }
    return await response.text();
  } catch (error) {
    console.error(`Failed to fetch resource ${url}:`, error);
    return null;
  }
}

const aiRouter = new AiRouter();

export const parsingAgent = aiRouter.agent('/', async (ctx) => {
  const { html, url, jsContent, cssContent } = ctx.request.params as {
    html: string;
    url: string;
    jsContent: string[];
    cssContent: string[];
  };

  if (url.includes('github.com')) {
    const dom = await jsDom(html);
    const body = dom.window.document.body;
    const entryContent = body.querySelector('.entry-content')?.innerHTML;
    const vcardDetails = body.querySelector('.vcard-details')?.innerHTML;
    const contentToParse = `${entryContent || ''} ${vcardDetails || ''}`;
    if (!contentToParse) {
      return { emails: [], socials: [], otherLinks: [] };
    }
    return {
      emails: extractEmailsWithContext(contentToParse),
      socials: extractSocialsWithContext(contentToParse),
      otherLinks: extractOtherLinksWithContext(contentToParse),
    };
  }

  // For non-GitHub URLs, combine all content for a full analysis
  const fullContent = [html, ...(jsContent || []), ...(cssContent || [])].join(
    '\n',
  );

  const emails = extractEmailsWithContext(fullContent);
  const socials = extractSocialsWithContext(fullContent);
  // Only parse HTML for "other" links to reduce noise from API endpoints in JS
  const otherLinks = extractOtherLinksWithContext(html);

  const uniqueByValue = (arr: ContactInfo[]) => {
    const seen = new Set();
    return arr.filter((item) => {
      const duplicate = seen.has(item.value);
      seen.add(item.value);
      return !duplicate;
    });
  };

  return {
    emails: uniqueByValue(emails),
    socials: uniqueByValue(socials),
    otherLinks: uniqueByValue(otherLinks),
  };
});
