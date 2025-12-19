/**
 * Workers-config client for resolving queue URLs from the workers-config API Lambda.
 */

export interface WorkersConfig {
  version: string;
  stage: string;
  region: string;
  workers: Record<
    string,
    {
      queueUrl: string;
      region: string;
    }
  >;
}

let cachedConfig: WorkersConfig | null = null;
let cacheExpiry: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches the workers configuration from the workers-config API.
 * Results are cached for 5 minutes to reduce API calls.
 *
 * @param apiUrl - The URL of the workers-config API endpoint
 * @param apiKey - Optional API key for authentication (sent as x-workers-config-key header)
 * @returns The workers configuration mapping worker IDs to queue URLs
 */
export async function getWorkersConfig(
  apiUrl: string,
  apiKey?: string
): Promise<WorkersConfig> {
  const now = Date.now();

  // Return cached config if still valid
  if (cachedConfig && now < cacheExpiry) {
    return cachedConfig;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers['x-workers-config-key'] = apiKey;
  }

  const response = await fetch(apiUrl, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch workers config: ${response.status} ${response.statusText}`
    );
  }

  const config = (await response.json()) as WorkersConfig;
  cachedConfig = config;
  cacheExpiry = now + CACHE_TTL_MS;

  return config;
}

/**
 * Resolves the queue URL for a specific worker ID.
 * Throws an error if the worker ID is not found in the configuration.
 *
 * @param workerId - The ID of the worker
 * @param apiUrl - The URL of the workers-config API endpoint
 * @param apiKey - Optional API key for authentication
 * @returns The queue URL for the worker
 */
export async function resolveQueueUrl(
  workerId: string,
  apiUrl: string,
  apiKey?: string
): Promise<string> {
  const config = await getWorkersConfig(apiUrl, apiKey);
  const worker = config.workers[workerId];

  if (!worker) {
    throw new Error(
      `Worker "${workerId}" not found in workers config. Available workers: ${Object.keys(config.workers).join(', ')}`
    );
  }

  return worker.queueUrl;
}

/**
 * Clears the cached workers configuration.
 * Useful for testing or when you need to force a refresh.
 */
export function clearWorkersConfigCache(): void {
  cachedConfig = null;
  cacheExpiry = 0;
}
