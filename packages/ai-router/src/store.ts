export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  entries?(): Promise<[string, any][]>;
  clear?(): Promise<void>;
}

/**
 * An in-memory implementation of the `Store` interface.
 *
 * @remarks
 * Each instance of `MemoryStore` maintains its own isolated key-value map.
 * In a server environment where a single `AiRouter` instance handles multiple
 * concurrent requests, the router's `handle` method automatically creates a new
 * `MemoryStore` for each request to ensure state isolation. This prevents
 * data leakage between different requests.
 */
export class MemoryStore implements Store {
  private store = new Map<string, any>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get(key);
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }
}
