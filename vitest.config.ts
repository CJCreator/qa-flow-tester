import { defineConfig } from 'vitest/config';
import os from 'os';
import path from 'path';

// Many test files start their own Chromium, and often a runner and the fixture app too. Vitest's
// default (one worker per CPU thread, less one) ran seven of them at once on a 4-core, 8-thread laptop
// with 16 GB: memory ran out, Chromium launches passed the 30 s hook timeout and whole runs passed their
// budgets (EV-0006). One worker per 4 GB of memory, never more than the default, fits the machine and
// leaves CI as it was (4 threads and 16 GB: 3 workers either way). `--maxWorkers` still overrides it.
const workers = Math.max(1, Math.min(os.availableParallelism() - 1, Math.floor(os.totalmem() / 2 ** 32)));

// Settings every project in vitest.workspace.ts (`unit`, `browser`) shares. Projects get them by spreading,
// not through `extends`: a merge would concatenate the `include` lists, and each project would run every file.
export const sharedTest = {
  globals: true,
  environment: 'node',
  testTimeout: 30000,
  hookTimeout: 30000,
} as const;

export const sharedResolve = {
  // Exact names only, so a subpath such as '@qa/types/src/verdict.js' (the wizard imports single
  // modules, keeping Node-only code out of the browser) resolves to its own file.
  alias: [
    // The Wizard imports browser-safe parts of @qa/types from their source (its index pulls in node:crypto).
    { find: /^@qa\/types\/src\/(.+)\.js$/, replacement: path.resolve(__dirname, './packages/types/src/$1.ts') },
    { find: /^@qa\/types$/, replacement: path.resolve(__dirname, './packages/types/src/index.ts') },
    { find: /^@qa\/core$/, replacement: path.resolve(__dirname, './packages/core/src/index.ts') },
    { find: /^@qa\/checkers$/, replacement: path.resolve(__dirname, './packages/checkers/src/index.ts') },
    { find: /^@qa\/runner$/, replacement: path.resolve(__dirname, './packages/runner/src/index.ts') },
  ],
};

// Global options (workers). The test files themselves come from the projects in vitest.workspace.ts.
export default defineConfig({
  test: {
    ...sharedTest,
    minWorkers: 1,
    maxWorkers: workers,
    include: ['packages/*/tests/**/*.test.{ts,tsx}'],
  },
  resolve: sharedResolve,
});
