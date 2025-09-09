import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/fs_store.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
});
