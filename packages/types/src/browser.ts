/**
 * The browser-safe surface of @qa/types, for the wizard (Vite bundles this package from source).
 *
 * Nothing reachable from here may import a Node built-in: `packages/types/tests/browser-entry.test.ts` walks
 * this file's re-exports and their relative imports transitively and fails on one, and fails too if the wizard
 * reaches into an area module by path again.
 */
export * from './route-telemetry.js';
export * from './signin.js';
export * from './intent.js';
export * from './input-rules.js';
export * from './verdict.js';
export * from './problems.js';
export * from './site-map.js';
export * from './context-parse.js';
export * from './evidence-finding.js';
export * from './website-audit.js';
// Add a module only while the guard test stays green.
