import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/client.ts',
    'src/handler.ts',
    'src/config.ts',
    'src/queue.ts',
    'src/queueJobStore.ts',
    'src/queueInputEnvelope.ts',
    'src/chainMapDefaults.ts',
    'src/hitlConfig.ts',
  ],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['@aws-sdk/client-sqs'],
});
