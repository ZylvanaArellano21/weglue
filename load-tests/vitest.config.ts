import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const stub = (name: string) => fileURLToPath(new URL(`./tests/k6-stubs/${name}.js`, import.meta.url));

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
  resolve: {
    // Lets the contract tests execute k6/main.js under Node with inert k6 modules.
    alias: [
      { find: /^k6\/http$/, replacement: stub('http') },
      { find: /^k6\/execution$/, replacement: stub('execution') },
      { find: /^k6\/crypto$/, replacement: stub('crypto') },
      { find: /^k6\/data$/, replacement: stub('data') },
      { find: /^k6\/metrics$/, replacement: stub('metrics') },
      { find: /^k6$/, replacement: stub('k6') },
    ],
  },
});
