import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // The pure, unit-tested logic (DOM/WebGL renderers are covered by the e2e).
      include: [
        'extension/core.js',
        'extension/render-array.js',
        'extension/render-model.js',
        'extension/splat-decode.js',
        'extension/unzip.js',
      ],
    },
  },
});
