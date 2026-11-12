/**
 * T-211: the browser-safe entry stays browser-safe, and the wizard keeps using it.
 *
 * Two halves, both read from disk (nothing from the source under test is imported, so the guard cannot be
 * fooled by a module that only *looks* fine once loaded):
 *
 * 1. every module reachable from `src/browser.ts` — its re-exports, and their relative imports, transitively —
 *    imports no Node built-in. The wizard bundles this package from source, so one `node:crypto` in the closure
 *    is a broken (or subtly wrong) bundle at build time, not a failing test;
 * 2. no file under `packages/wizard/` reaches into `@qa/types/src/` by path for anything but `browser.js`.
 */
import { describe, expect, it } from 'vitest';
import { lstatSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const TYPES_SRC = fileURLToPath(new URL('../src', import.meta.url));
const WIZARD_DIR = fileURLToPath(new URL('../../wizard', import.meta.url));
const BROWSER_ENTRY = path.join(TYPES_SRC, 'browser.ts');

/** Node's built-in modules, by name and by `node:` prefix. */
const BUILTINS = new Set([
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
]);

/** Every module specifier a file references: `from 'x'`, `import 'x'`, `import('x')`, `require('x')`. */
function importedSpecifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specs: string[] = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) specs.push(match[1]);
  }
  return specs;
}

function isNodeBuiltin(specifier: string): boolean {
  if (specifier.startsWith('node:')) return true;
  return BUILTINS.has(specifier.split('/')[0]);
}

/** Every file reachable from an entry by relative imports (the entry first). */
function closureOf(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importedSpecifiers(file)) {
      if (!specifier.startsWith('.')) continue;
      let resolved = path.resolve(path.dirname(file), specifier);
      if (!resolved.startsWith(TYPES_SRC)) continue;
      if (
        !statSync(resolved, { throwIfNoEntry: false }) &&
        statSync(resolved.replace(/\.js$/, '.ts'), { throwIfNoEntry: false })
      ) {
        resolved = resolved.replace(/\.js$/, '.ts');
      }
      queue.push(resolved);
    }
  }
  return [...seen];
}

/**
 * Source files of a package, for the wizard scan. Skips `node_modules` at any depth: its entries are installed
 * packages (and workspace symlinks to other packages), not this package's source. Symlinks are not followed,
 * so a link back into the tree cannot loop.
 */
function sourceFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = path.join(dir, entry);
    const info = lstatSync(full);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      found.push(...sourceFilesUnder(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

describe('the browser-safe entry into @qa/types (T-211)', () => {
  it('re-exports the modules the wizard needs', () => {
    const text = readFileSync(BROWSER_ENTRY, 'utf8');
    const reExports = [...text.matchAll(/export \* from '\.\/([^']+)'/g)].map((m) => m[1]);
    expect(reExports).toEqual([
      'route-telemetry.js',
      'signin.js',
      'intent.js',
      'input-rules.js',
      'verdict.js',
      'problems.js',
      'site-map.js',
      'context-parse.js',
      'evidence-finding.js',
      'website-audit.js',
    ]);
  });

  it('reaches no Node built-in, transitively', () => {
    const closure = closureOf(BROWSER_ENTRY);
    // The closure is not empty and is not only the entry: a guard over nothing proves nothing.
    expect(closure.length).toBeGreaterThan(5);

    const offenders = closure.flatMap((file) =>
      importedSpecifiers(file)
        .filter(isNodeBuiltin)
        .map((specifier) => `${path.relative(TYPES_SRC, file)} imports ${specifier}`)
    );
    expect(offenders).toEqual([]);
  });

  it('is the only way the wizard reaches into @qa/types by path', () => {
    const offenders: string[] = [];
    for (const file of sourceFilesUnder(WIZARD_DIR)) {
      for (const specifier of importedSpecifiers(file)) {
        if (!specifier.startsWith('@qa/types/src/')) continue;
        if (specifier === '@qa/types/src/browser.js') continue;
        offenders.push(`${path.relative(WIZARD_DIR, file)} imports ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('declares the browser entry in package.json and marks the package side-effect free (T-351)', () => {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    expect(pkg.exports?.['./browser']).toBeDefined();
    expect(pkg.sideEffects).toBe(false);
  });
});
