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
    // These are ES modules (lazy-imported by the content script); core.js and
    // content.js stay classic scripts.
    files: [
      'extension/render*.js',
      'extension/splat-decode.js',
      'extension/unzip.js',
      'extension/splat-viewer.js',
      'extension/splattie-viewer.js',
    ],
    languageOptions: { sourceType: 'module' },
  },
  {
    // Tests and config: ESM on Node + jsdom, plus the browser render harness.
    files: ['tests/**/*.js', 'test/**/*.{js,mjs}', '*.config.js', '*.config.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, octoview: 'readonly' },
    },
  },
  { ignores: ['extension/vendor/**', 'Safari/**', 'coverage/**', 'node_modules/**', 'build/**'] },
];
