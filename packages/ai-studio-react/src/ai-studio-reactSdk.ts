import { AiStudioReactSdkConfigSchema } from './schemas';

/**
 * Configuration options for the AiStudioReactSdk
 */
export interface AiStudioReactSdkConfig {
  /** API key for authentication */
  apiKey: string;
  /** Base URL for the API (optional) */
  baseUrl?: string;
  /** SDK name identifier (optional) */
  name?: string;
  /** API version to use (optional) */
  version?: string;
}

/**
 * Standard response format for all SDK methods
 */
export interface AiStudioReactSdkResponse<T = any> {
  /** The response data */
  data: T;
  /** Whether the request was successful */
  success: boolean;
  /** HTTP status code */
  status: number;
  /** Response message */
  message: string;
  /** Error object if the request failed */
  error?: Error;
}

/**
 * AiStudioReactSdk - A TypeScript SDK template
 * 
 * @example
 * \`\`\`typescript
 * import { AiStudioReactSdk } from '@microfox/ai-studio-react';
 * 
 * const sdk = new AiStudioReactSdk({
 *   apiKey: 'your-api-key',
 *   baseUrl: 'https://api.example.com'
 * });
 * 
 * const result = await sdk.hello('World');
 * console.log(result.data);
 * \`\`\`
 */
export class AiStudioReactSdk {
  private config: AiStudioReactSdkConfig;

  /**
   * Create a new AiStudioReactSdk instance
   * 
   * @param config - Configuration for the SDK
   */
  constructor(config: AiStudioReactSdkConfig) {
    // Validate configuration using Zod schema
    this.config = AiStudioReactSdkConfigSchema.parse(config);
  }

  /**
   * Get current configuration
   * 
   * @returns Copy of the current config
   */
  getConfig(): AiStudioReactSdkConfig {
    return { ...this.config };
  }

  /**
   * Example hello method - replace with your own methods
   * 
   * @param name - Name to greet
   * @returns Promise with greeting response
   */
  async hello(name: string): Promise<AiStudioReactSdkResponse<string>> {
    return {
      data: `Hello, ${name}! Welcome to ${this.config.name || 'ai-studio-react'} SDK.`,
      success: true,
      status: 200,
      message: 'Success'
    };
  }

  // TODO: Add your SDK methods here
  // Example:
  // async getData(id: string): Promise<AiStudioReactSdkResponse<any>> {
  //   // Your implementation
  // }
  
  // async createItem(data: any): Promise<AiStudioReactSdkResponse<any>> {
  //   // Your implementation  
  // }
}
