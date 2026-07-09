import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    // Extension code: classic content scripts running in the browser.
    files: ['extension/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        octoview: 'readonly',
        marked: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Tests and config: ESM on Node + jsdom.
    files: ['tests/**/*.js', 'test/**/*.mjs', '*.config.js', '*.config.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
  { ignores: ['extension/vendor/**', 'Safari/**', 'coverage/**', 'node_modules/**'] },
];
