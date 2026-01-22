import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/fs_store.ts',
    'src/workflow/index.ts',
    'src/workflow/orchestrate.ts',
    'src/workflow/config.ts',
    'src/workflow/runtimeAdapter.ts',
    'src/workflow/types.ts',
    'src/workflow/client.ts',
  ],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
});
