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
      'expo-image': resolve(__dirname, 'tests/mocks/expo-image.ts'),
      'react-is': resolve(__dirname, 'tests/mocks/react-is.ts'),
      'react-native-reanimated': resolve(__dirname, 'tests/mocks/reanimated.ts'),
      'react-native-gesture-handler': resolve(__dirname, 'tests/mocks/gesture-handler.ts'),
      '@shopify/flash-list': resolve(__dirname, 'tests/mocks/flash-list.ts'),
      '@react-native-community/netinfo': resolve(__dirname, 'tests/mocks/netinfo.ts'),
      'expo-secure-store': resolve(__dirname, 'tests/mocks/secure-store.ts'),
      'react-native-svg': resolve(__dirname, 'tests/mocks/react-native-svg.ts'),
      'expo-localization': resolve(__dirname, 'tests/mocks/expo-localization.ts'),
      'react-i18next': resolve(__dirname, 'tests/mocks/react-i18next.ts'),
      'lucide-react-native': resolve(__dirname, 'tests/mocks/lucide-react-native.ts'),
      'react-native-unistyles': resolve(__dirname, 'tests/mocks/unistyles.ts'),
      '@gorhom/bottom-sheet': resolve(__dirname, 'tests/mocks/bottom-sheet.ts'),
      'expo-audio': resolve(__dirname, 'tests/mocks/expo-audio.ts'),
    },
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
});
