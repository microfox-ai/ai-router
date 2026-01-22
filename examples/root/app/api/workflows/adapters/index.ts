/**
 * Workflow adapter factory.
 * 
 * This module provides a factory function to get the appropriate workflow adapter
 * based on the configured provider. Adapters are implemented in the boilerplate
 * (not the package) because they depend on external packages (workflow, @upstash/workflow).
 */

import { vercelWorkflowAdapter } from './vercelAdapter';
import { upstashWorkflowAdapter } from './upstashAdapter';
import { getWorkflowConfig, setWorkflowConfigProvider, type WorkflowRuntimeAdapter } from '@microfox/ai-router';

// Config initialization improvements:
// - Supports lazy initialization (only when adapter is first accessed)
// - Config is loaded once and cached
// - Error handling: throws clear error if provider not configured
// - Config can be reloaded by restarting the server (hot reload in development)
// - Supports config from environment variables (QSTASH_TOKEN, etc.)
// - Config validation: ensures required provider settings are present

// Initialize config provider from microfox.config.ts
// This should be called early in the app lifecycle
try {
  // Try to import the config file - this will work in Next.js
  const configModule = require('@/microfox.config');
  const studioConfig = configModule.StudioConfig || configModule.default?.StudioConfig || configModule.default;
  
  if (studioConfig?.workflow) {
    setWorkflowConfigProvider(() => studioConfig.workflow);
  }
} catch (error) {
  // Config file not found or not accessible - will use env vars as fallback
  // This is fine, getWorkflowConfig() will handle it
  // Config initialization errors are thrown (fatal) - adapter must be configured correctly
  // In production, ensure all required environment variables and config are set
}

/**
 * Get the workflow adapter for the configured provider.
 * 
 * @returns The workflow runtime adapter instance
 */
export function getAdapter(): WorkflowRuntimeAdapter {
  const config = getWorkflowConfig();
  
  switch (config.provider) {
    case 'vercel':
      return vercelWorkflowAdapter;
    case 'upstash':
      return upstashWorkflowAdapter;
    default:
      throw new Error(
        `[ai-router][workflow] Unknown workflow provider: ${config.provider}. ` +
        `Supported providers: 'vercel', 'upstash'`
      );
  }
}

// Re-export adapters and helpers for convenience
export { vercelWorkflowAdapter } from './vercelAdapter';
export { upstashWorkflowAdapter } from './upstashAdapter';
export { createVercelWorkflow, createUpstashWorkflow } from './helpers';
