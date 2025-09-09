import { describe, it, expect, beforeEach } from 'vitest';
import { StudioCliSdk, type StudioCliSdkConfig } from '../studio-cliSdk';

describe('StudioCliSdk', () => {
  let config: StudioCliSdkConfig;

  beforeEach(() => {
    config = {
      apiKey: 'test-api-key',
      baseUrl: 'https://api.test.com',
      name: 'studio-cli',
      version: '1.0.0',
    };
  });

  describe('Constructor', () => {
    it('should create an instance with valid config', () => {
      const sdk = new StudioCliSdk(config);
      expect(sdk).toBeInstanceOf(StudioCliSdk);
    });

    it('should throw error with invalid config', () => {
      const invalidConfig = { ...config, apiKey: '' };
      expect(() => new StudioCliSdk(invalidConfig)).toThrow();
    });
  });

  describe('Hello Method', () => {
    it('should return a successful greeting response', async () => {
      const sdk = new StudioCliSdk(config);
      const result = await sdk.hello('World');
      
      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data).toContain('Hello, World!');
      expect(result.message).toBe('Success');
    });
  });

  // TODO: Add your own tests here
  // Example:
  // describe('Your API Method', () => {
  //   it('should do something', async () => {
  //     const sdk = new StudioCliSdk(config);
  //     // Your test implementation
  //   });
  // });
});
