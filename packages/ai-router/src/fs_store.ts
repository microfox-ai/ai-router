/* eslint-disable @typescript-eslint/no-var-requires */
import { Store } from './store';

// Type definition for AsyncLock since @types/async-lock might not be available
type AsyncLock = {
  acquire<T>(key: string, fn: () => Promise<T>): Promise<T>;
};

class NoOpStore implements Store {
  constructor() {
    console.warn(
      'FileSystemStore is not available in the browser. Using a mock store.'
    );
  }

  async get<T>(_key: string): Promise<T | undefined> {
    return undefined;
  }

  async set<T>(_key: string, _value: T): Promise<void> {
    // No-op
  }

  async delete(_key: string): Promise<void> {
    // No-op
  }

  async has(_key: string): Promise<boolean> {
    return false;
  }
}

let store: new (...args: any[]) => Store;
if (typeof window !== 'undefined') {
  store = NoOpStore;
} else {
  const fs = require('fs/promises');
  const path = require('path');
  const AsyncLock = require('async-lock');

  class FileSystemStore implements Store {
    private storeFilePath: string;
    private lock: AsyncLock;

    constructor(storagePath: string = '.ai-router.store.json') {
      this.storeFilePath = path.resolve(storagePath);
      this.lock = new AsyncLock();
      this.init();
    }

    private async init() {
      try {
        // Check if file exists by trying to read it.
        await fs.access(this.storeFilePath);
      } catch (error: unknown) {
        // If not, create it with an empty object.
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          await fs.writeFile(this.storeFilePath, '{}', 'utf-8');
        } else {
          console.error('Failed to access or create storage file:', error);
        }
      }
    }

    private async readStore(): Promise<Record<string, unknown>> {
      try {
        const fileContent = await fs.readFile(this.storeFilePath, 'utf-8');
        return JSON.parse(fileContent);
      } catch (error) {
        console.error(
          'Failed to read store file, returning empty object:',
          error
        );
        return {};
      }
    }

    private async writeStore(data: Record<string, unknown>): Promise<void> {
      const fileContent = JSON.stringify(data, null, 2);
      await fs.writeFile(this.storeFilePath, fileContent, 'utf-8');
    }

    async get<T>(key: string): Promise<T | undefined> {
      return this.lock.acquire(this.storeFilePath, async () => {
        const store = await this.readStore();
        return store[key] as T | undefined;
      });
    }

    async set<T>(key: string, value: T): Promise<void> {
      await this.lock.acquire(this.storeFilePath, async () => {
        const store = await this.readStore();
        store[key] = value;
        await this.writeStore(store);
      });
    }

    async delete(key: string): Promise<void> {
      await this.lock.acquire(this.storeFilePath, async () => {
        const store = await this.readStore();
        delete store[key];
        await this.writeStore(store);
      });
    }

    async has(key: string): Promise<boolean> {
      return this.lock.acquire(this.storeFilePath, async () => {
        const store = await this.readStore();
        return key in store;
      });
    }

    async clear(): Promise<void> {
      await this.lock.acquire(this.storeFilePath, async () => {
        await this.writeStore({});
      });
    }
  }
  store = FileSystemStore;
}

export const FileSystemStore = store;
