'use server'

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

async function fetchResourceContent(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (
      !response.ok ||
      !response.headers.get('content-type')?.match(/text|javascript|css/)
    ) {
      return null;
    }
    return await response.text();
  } catch (error) {
    // Suppress fetch errors for non-essential resources
    return null;
  }
}

export async function scrapper(url: string) {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    const pageData = await page.evaluate(() => {
      const html = document.documentElement.outerHTML;
      const title = document.title;
      const description =
        (
          document.querySelector(
            'meta[name="description"]',
          ) as HTMLMetaElement
        )?.content || '';

      const scriptSrcs = Array.from(
        document.querySelectorAll<HTMLScriptElement>('script[src]'),
      ).map((s) => s.src);
      const styleHrefs = Array.from(
        document.querySelectorAll<HTMLLinkElement>(
          'link[rel="stylesheet"][href]',
        ),
      ).map((l) => l.href);

      return { html, title, description, scriptSrcs, styleHrefs };
    });

    const jsUrls = [
      ...new Set(
        pageData.scriptSrcs
          .map((src: string) => {
            try {
              return new URL(src, url).toString();
            } catch {
              return null;
            }
          })
          .filter((u: string | null): u is string => u !== null),
      ),
    ];

    const cssUrls = [
      ...new Set(
        pageData.styleHrefs
          .map((href: string) => {
            try {
              return new URL(href, url).toString();
            } catch {
              return null;
            }
          })
          .filter((u: string | null): u is string => u !== null),
      ),
    ];

    const jsContentPromises = jsUrls.map(fetchResourceContent as any);
    const cssContentPromises = cssUrls.map(fetchResourceContent as any);

    const jsContent = (await Promise.all(jsContentPromises)).filter(
      (c): c is string => c !== null,
    ) || [];
    const cssContent = (await Promise.all(cssContentPromises)).filter(
      (c): c is string => c !== null,
    ) || [];

    return {
      data: {
        html: pageData.html,
        url,
        title: pageData.title,
        description: pageData.description,
        jsContent,
        cssContent,
      },
    };
  }
  catch (error) {
    console.error(`Failed to scrape ${url}:`, error);
    return null;
  }
  finally {
    await browser.close();
  }
}
