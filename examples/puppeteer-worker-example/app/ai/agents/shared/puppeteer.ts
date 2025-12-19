import { openPage } from '@microfox/puppeteer-sls';

export async function OpenPageSls(url: string, waitUntil: "load" | "domcontentloaded" | "networkidle0" | "networkidle2") {
    const isLocal =
        process.env.IS_OFFLINE != undefined ||
        process.env.SERVERLESS_OFFLINE != undefined;

    const pageData = await openPage({
        url,
        headless: true,
        isLocal,
        waitUntil,
    });
    return pageData;
}