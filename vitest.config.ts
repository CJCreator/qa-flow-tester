import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/tests/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: [
      // The Wizard imports browser-safe parts of @qa/types from their source (its index pulls in node:crypto).
      { find: /^@qa\/types\/src\/(.+)\.js$/, replacement: path.resolve(__dirname, './packages/types/src/$1.ts') },
      { find: /^@qa\/types$/, replacement: path.resolve(__dirname, './packages/types/src/index.ts') },
      { find: /^@qa\/core$/, replacement: path.resolve(__dirname, './packages/core/src/index.ts') },
      { find: /^@qa\/checkers$/, replacement: path.resolve(__dirname, './packages/checkers/src/index.ts') },
      { find: /^@qa\/runner$/, replacement: path.resolve(__dirname, './packages/runner/src/index.ts') },
    ],
  },
});
