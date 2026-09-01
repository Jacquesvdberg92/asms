import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * The code carried `eslint-disable` comments for a long time without an ESLint
 * to read them, so those directives meant nothing. This is that ESLint.
 *
 * Deliberately not a style linter — formatting is not what breaks a server
 * manager. The rules kept here are the ones that catch real bugs: unused
 * symbols, floating promises, and the React hook dependency rule that would
 * have caught the duplicate-websocket bug.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'data/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['apps/server/src/**/*.ts'],
    languageOptions: {
      globals: globals.node,
      parserOptions: { project: './apps/server/tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // A promise nobody waits for is how a failed stop looks like a successful
      // one. `void expr` is the documented way to say "deliberately not awaited".
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // The store's socket payloads are genuinely untyped over the wire.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    files: ['apps/server/src/tests/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      'no-console': 'off',
    },
  },
);
