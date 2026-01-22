/**
 * Workflow configuration loader.
 * 
 * Reads workflow configuration from microfox.config.ts with environment variable fallback.
 * This file does NOT import adapter implementations to avoid external dependencies.
 * 
 * In Next.js, the config file should be imported directly in the boilerplate code.
 * This loader provides a way to access the config with env var fallback.
 */

export type WorkflowProvider = 'vercel' | 'upstash';

export interface WorkflowAdapterConfig {
  vercel?: Record<string, any>;
  upstash?: {
    token?: string;
    url?: string;
    currentSigningKey?: string;
    nextSigningKey?: string;
  };
}

export interface WorkflowConfig {
  provider: WorkflowProvider;
  adapters: WorkflowAdapterConfig;
}

let cachedConfig: WorkflowConfig | null = null;
let configProvider: (() => WorkflowConfig) | null = null;

/**
 * Set a custom config provider function.
 * This should be called from the boilerplate code that imports microfox.config.ts.
 * 
 * @example
 * ```typescript
 * import { setWorkflowConfigProvider } from '@microfox/ai-router/workflow/config';
 * import { StudioConfig } from '@/microfox.config';
 * 
 * setWorkflowConfigProvider(() => StudioConfig.workflow);
 * ```
 */
export function setWorkflowConfigProvider(provider: () => WorkflowConfig): void {
  configProvider = provider;
  cachedConfig = null; // Reset cache
}

/**
 * Get workflow configuration from the config provider or environment variables.
 * 
 * The config provider should be set by the boilerplate code that imports microfox.config.ts.
 * If not set, falls back to environment variables.
 * 
 * @returns Workflow configuration object
 */
export function getWorkflowConfig(): WorkflowConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  // Try to get config from provider (set by boilerplate)
  if (configProvider) {
    try {
      cachedConfig = configProvider();
      if (cachedConfig) {
        return cachedConfig;
      }
    } catch (error) {
      // Provider failed, fall back to env vars
      console.warn('[ai-router][workflow] Config provider failed, using env vars:', error);
    }
  }

  // Fallback to environment variables
  const provider = (process.env.WORKFLOW_PROVIDER as WorkflowProvider) || 'vercel';
  
  cachedConfig = {
    provider,
    adapters: {
      vercel: {},
      upstash: {
        token: process.env.QSTASH_TOKEN,
        url: process.env.QSTASH_URL,
        currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
        nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
      },
    },
  };

  return cachedConfig;
}

/**
 * Reset cached configuration (useful for testing).
 */
export function resetWorkflowConfig(): void {
  cachedConfig = null;
}

// TODO: Add config validation
// - Validate provider is supported ('vercel' | 'upstash')
// - Validate adapter config has required fields (e.g., upstash.token)
// - Provide helpful error messages for missing config
// - Support config schema validation

// TODO: Add config reload support
// - Support reloading config in development (hot reload)
// - Clear cache and reload from provider
// - Useful for testing different providers without restart
