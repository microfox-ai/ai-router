import { withWorkflow } from "workflow/next"; 
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Mark workflow-related packages as server-only external packages
  // This prevents Next.js from trying to bundle them for the client
  serverExternalPackages: [
    'workflow',
    '@workflow/core',
    '@workflow/world-local',
    'undici', // Used by workflow runtime
  ],
  // Don't fail build on ESLint errors (common for example projects)
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Don't fail build on TypeScript errors during build
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      // For client builds, ignore workflow-related imports
      // This prevents webpack from trying to bundle Node.js-only code
      config.plugins = config.plugins || [];
      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /^workflow\/api$/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^workflow$/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^@workflow\//,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^undici$/,
        }),
        // Ignore the workflow adapter chunk file
        new webpack.IgnorePlugin({
          resourceRegExp: /chunk-.*\.mjs$/,
          contextRegExp: /@microfox\/ai-router\/dist/,
        }),
      );
    }
    return config;
  },
};

export default withWorkflow(nextConfig); 
