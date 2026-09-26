import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import unusedImports from 'eslint-plugin-unused-imports';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'web-build/**',
      '.expo/**',
      'metro.config.js',
      'babel.config.js',
      'vitest.config.ts',
      'tests/renderer.ts',
      // Artefactos generados y scripts de depuración sueltos (no son código fuente)
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
      '_*.js',
      // Scripts Node de utilidad (gen-icons): globals de Node + CommonJS
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      security,
      react,
      'react-hooks': reactHooks,
      'unused-imports': unusedImports,
    },
    rules: {
      // Seguridad
      'security/detect-object-injection': 'warn',
      'security/detect-non-literal-regexp': 'error',
      'security/detect-non-literal-fs-filename': 'error',
      'security/detect-unsafe-regex': 'error',
      'security/detect-child-process': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-pseudoRandomBytes': 'warn',
      // React
      'react/jsx-key': 'error',
      'react/no-danger': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // TypeScript
      '@typescript-eslint/no-explicit-any': 'warn',
      // unused-imports es auto-fixable y más preciso que no-unused-vars para imports
      'unused-imports/no-unused-imports': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'warn',
      // Calidad
      'no-debugger': 'error',
      'no-undef': 'off',
      'prefer-const': 'warn',
      'eqeqeq': ['warn', 'smart'],
    },
    settings: {
      react: { version: '19.0' },
    },
  },
);
