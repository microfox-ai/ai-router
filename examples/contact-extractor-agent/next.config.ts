import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
    serverExternalPackages: [
      'puppeteer',
      'puppeteer-core',
      'puppeteer-extra',
      'puppeteer-extra-plugin-stealth',
      // 'jsdom',
      // 'mongodb',
      // '@microfox/rag-upstash'
    ],
};

export default nextConfig;
