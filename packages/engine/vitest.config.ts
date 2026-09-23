import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@nt4h/schema': resolve(__dirname, '../schema/src/index.ts'),
      '@nt4h/catalog': resolve(__dirname, '../catalog/src/index.ts'),
    },
  },
});
