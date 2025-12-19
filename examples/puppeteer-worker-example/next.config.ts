import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@microfox/puppeteer-sls',
    'puppeteer-core',
    'puppeteer-extra',
    'puppeteer-extra-plugin-stealth',
    'clone-deep',
    'merge-deep',
  ],
};

export default nextConfig;
