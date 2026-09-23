import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      'react-native': resolve(__dirname, 'tests/mocks/react-native.ts'),
      'expo-router': resolve(__dirname, 'tests/mocks/expo-router.ts'),
      'expo-status-bar': resolve(__dirname, 'tests/mocks/expo-status-bar.ts'),
      'expo-image': resolve(__dirname, 'tests/mocks/expo-image.ts'),
      'react-is': resolve(__dirname, 'tests/mocks/react-is.ts'),
    },
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
});
