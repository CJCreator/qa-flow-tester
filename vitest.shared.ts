import path from 'path';

// Settings every project in vitest.workspace.ts (`unit`, `browser`) shares. Projects get them by spreading,
// not through `extends`: a merge would concatenate the `include` lists, and each project would run every file.
// Kept apart from vitest.config.ts so that the config can list the projects without an import cycle.
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
