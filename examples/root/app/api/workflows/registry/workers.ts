/**
 * Worker registry system.
 * 
 * Manages registration and discovery of workers.
 * 
 * Features implemented:
 * 1. Worker registration
 *    - registerWorker(workerId: string, worker: WorkerAgent): void
 *    - Store in memory cache
 * 
 * 2. Worker lookup
 *    - getWorker(workerId: string): WorkerAgent | null
 *    - listWorkers(): Array<{ id: string }>
 * 
 * 3. Auto-discovery
 *    - scanWorkers(): Promise<WorkerAgent[]>
 *    - Scan app/ai/xx/*xworker.ts files
 *    - Extract worker from exported default or named export
 *    - Register discovered workers
 *    - Cache for performance
 * 
 * Example usage:
 * ```typescript
 * // app/ai/agents/my-worker.worker.ts
 * import { createWorker } from '@microfox/ai-worker';
 * 
 * export const myWorker = createWorker({
 *   id: 'my-worker',
 *   inputSchema: z.object({ data: z.string() }),
 *   handler: async ({ input }) => {
 *     // implementation here
 *   }
 * });
 * 
 * // Auto-discovered or manually registered:
 * import { registerWorker } from '@/app/api/workflows/registry/workers';
 * import { myWorker } from '@/app/ai/agents/my-worker.worker';
 * registerWorker(myWorker.id, myWorker);
 * ```
 */

import type { WorkerAgent } from '@microfox/ai-worker';

// In-memory worker registry with auto-discovery support
const workerRegistry = new Map<string, WorkerAgent<any, any>>();

/**
 * Register a worker for use in workflows.
 */
export function registerWorker<INPUT_SCHEMA, OUTPUT>(
  workerId: string,
  worker: WorkerAgent<INPUT_SCHEMA, OUTPUT>
): void {
  // Validate worker has required properties
  if (!worker || typeof worker !== 'object') {
    throw new Error(`Invalid worker: must be an object`);
  }
  
  if (!worker.id || typeof worker.id !== 'string') {
    throw new Error(`Invalid worker: must have an 'id' property (string)`);
  }
  
  if (worker.id !== workerId) {
    throw new Error(`Worker ID mismatch: provided ID "${workerId}" does not match worker.id "${worker.id}"`);
  }
  
  if (typeof worker.dispatch !== 'function') {
    throw new Error(`Invalid worker: must have a 'dispatch' method`);
  }
  
  workerRegistry.set(workerId, worker);
}

/**
 * Get a worker by ID.
 * Auto-discovers workers if not found in registry.
 */
export async function getWorker(workerId: string): Promise<WorkerAgent<any, any> | null> {
  // First, check registry
  let worker = workerRegistry.get(workerId);
  if (worker) {
    return worker;
  }
  
  // Try auto-discovery
  worker = await discoverWorker(workerId);
  if (worker) {
    registerWorker(workerId, worker);
    return worker;
  }
  
  return null;
}

/**
 * List all registered workers.
 */
export function listWorkers(): string[] {
  return Array.from(workerRegistry.keys());
}

/**
 * Scan app/ai/**/*.worker.ts files for workers.
 */
export async function scanWorkers(): Promise<WorkerAgent<any, any>[]> {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  const workers: WorkerAgent<any, any>[] = [];
  const aiPath = path.join(process.cwd(), 'app', 'ai');
  
  // Recursively scan for *.worker.ts files
  async function scanDirectory(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await scanDirectory(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.worker.ts')) {
          try {
            // Import the worker file
            // Use path relative to project root for Next.js dynamic imports
            const relativePath = path.relative(process.cwd(), fullPath);
            const modulePath = relativePath.replace(/\\/g, '/');
            const module = await import(`@/${modulePath}`);
            
            // Look for exported worker (default or named export)
            let worker = module.default;
            if (!worker || !worker.id || !worker.dispatch) {
              // Try to find worker in named exports
              const potentialWorker = Object.values(module).find((exp: any) => 
                exp && typeof exp === 'object' && exp.id && typeof exp.dispatch === 'function'
              );
              if (potentialWorker) {
                worker = potentialWorker;
              }
            }
            
            if (worker && worker.id && typeof worker.dispatch === 'function') {
              if (!workerRegistry.has(worker.id)) {
                registerWorker(worker.id, worker);
                workers.push(worker);
              }
            }
          } catch (error: any) {
            console.warn(`Failed to load worker from ${fullPath}:`, error?.message || String(error));
          }
        }
      }
    } catch (error) {
      // Directory doesn't exist or can't be read - ignore
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`Failed to scan directory ${dir}:`, error);
      }
    }
  }
  
  await scanDirectory(aiPath);
  return workers;
}

/**
 * Discover a specific worker by ID.
 */
async function discoverWorker(workerId: string): Promise<WorkerAgent<any, any> | null> {
  const patterns = [
    `app/ai/agents/${workerId}/${workerId}.worker`,
    `app/ai/workers/${workerId}.worker`,
    `app/ai/${workerId}.worker`,
  ];
  
  for (const pattern of patterns) {
    try {
      const module = await import(`@/${pattern}`);
      
      // Try default export first
      let worker = module.default;
      if (!worker || !worker.id || worker.id !== workerId) {
        // Try named export matching workerId
        worker = module[workerId];
      }
      
      // Try to find any exported worker object
      if (!worker || !worker.id || worker.id !== workerId) {
        worker = Object.values(module).find((exp: any) => 
          exp && typeof exp === 'object' && exp.id === workerId && typeof exp.dispatch === 'function'
        ) as any;
      }
      
      if (worker && worker.id === workerId && typeof worker.dispatch === 'function') {
        return worker;
      }
    } catch {
      // Try next pattern
    }
  }
  
  return null;
}
