import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Architecture rules that the type checker cannot see (ADR 0051). Each one was true when it was added, so a
 * failure here means a change brought back something that was deliberately removed.
 *
 * 1. Package direction: types <- checkers <- core <- runner, and the wizard reads only @qa/types.
 * 2. No import cycles between source files inside a package (type-only imports do not count).
 * 3. One home per shared helper: a name listed in CANONICAL is defined only in its home file, and a name in
 *    RETIRED is not defined anywhere. Add a row when a round of clean-up merges copies into one.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PACKAGES = ['types', 'checkers', 'core', 'runner', 'wizard'] as const;
type Pkg = (typeof PACKAGES)[number];

/** The @qa packages each package's source may import at run time. */
const ALLOWED: Record<Pkg, readonly string[]> = {
  types: [],
  checkers: ['types'],
  core: ['types', 'checkers'],
  runner: ['types', 'core'],
  wizard: ['types'],
};

/** Helper name -> the one file (from the repo root) allowed to define it. */
const CANONICAL: Record<string, string> = {
  isPrivateHost: 'packages/core/src/address-class.ts',
  ruleFixOptions: 'packages/types/src/fix-rules.ts',
  mapInFlight: 'packages/core/src/concurrency.ts',
  createLimiter: 'packages/core/src/concurrency.ts',
  parseCsp: 'packages/checkers/src/security.ts',
  LAB_CHROMIUM_ARGS: 'packages/core/src/audit/lab-browser.ts',
  MAX_CONTEXT_DOCUMENTS: 'packages/runner/src/run-inputs.ts',
  parseDailyLimit: 'packages/runner/src/helpers/helper-access.ts',
  jsonInit: 'packages/wizard/src/screens/audit/audit-call.ts',
  Fetch: 'packages/wizard/src/screens/audit/audit-call.ts',
  sleep: 'packages/core/src/timing.ts',
  settleOrGiveUp: 'packages/core/src/timing.ts',
  parseJsonAnswer: 'packages/core/src/ai/json-answer.ts',
  escapeHtml: 'packages/core/src/html-escape.ts',
  parseRetryAfter: 'packages/core/src/navigate.ts',
  readRawBody: 'packages/runner/src/routes/body.ts',
  isBetaEnv: 'packages/runner/src/beta.ts',
  isSerious: 'packages/types/src/problems.ts',
  readStoredJson: 'packages/wizard/src/lib/storage.ts',
  isInside: 'packages/core/src/fs-inside.ts',
  resolveInside: 'packages/core/src/fs-inside.ts',
  sendJson: 'packages/runner/src/routes/body.ts',
  refuseBadBody: 'packages/runner/src/routes/body.ts',
  refuseStoreFailure: 'packages/runner/src/routes/audit-common.ts',
};

/** Names merged into a canonical helper. They must not be defined again. */
const RETIRED = [
  'isLocalOriginHost',
  'createAiLimiter',
  'LabQueue',
  'MAX_DOCS',
  'MAX_DOC_BYTES',
  'withVersion',
  'escapeText',
  'escapeAttr',
  'SERIOUS',
  'SEVERITY_RANK',
  'sendStoreError',
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const files = PACKAGES.flatMap((pkg) =>
  sourceFiles(path.join(root, 'packages', pkg, 'src')).map((file) => ({
    pkg,
    file,
    text: readFileSync(file, 'utf8'),
  }))
);

const rel = (file: string) => path.relative(root, file).split(path.sep).join('/');

/** Module specifiers a file imports at run time: `import type` and `export type` lines are skipped. */
function runtimeImports(text: string): string[] {
  const specs: string[] = [];
  const re =
    /(?:^|\n)\s*(?:import|export)\s+(type\s)?([^'"]*?)from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of text.matchAll(re)) {
    if (m[1]) continue;
    // `import { type A, type B } from`: every name is a type, so nothing is loaded at run time.
    const names = /\{([^}]*)\}/.exec(m[2] ?? '');
    if (names && !/^[\s\w]*,/.test(m[2] ?? '')) {
      const list = names[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.length > 0 && list.every((s) => s.startsWith('type '))) continue;
    }
    specs.push(m[3] ?? m[4] ?? m[5]);
  }
  return specs;
}

describe('architecture rules', () => {
  it('each package imports only the @qa packages below it', () => {
    const wrong: string[] = [];
    for (const { pkg, file, text } of files) {
      for (const spec of runtimeImports(text)) {
        const m = /^@qa\/([^/]+)/.exec(spec);
        if (m && m[1] !== pkg && !ALLOWED[pkg].includes(m[1])) wrong.push(`${rel(file)} -> ${spec}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('no source files import each other in a cycle', () => {
    const byPath = new Set(files.map((f) => f.file));
    const edges = new Map<string, string[]>();
    for (const { file, text } of files) {
      const out: string[] = [];
      for (const spec of runtimeImports(text)) {
        if (!spec.startsWith('.')) continue;
        const base = path.resolve(path.dirname(file), spec).replace(/\.js$/, '');
        const hit = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')].find((c) =>
          byPath.has(c)
        );
        if (hit) out.push(hit);
      }
      edges.set(file, out);
    }
    // Tarjan's strongly connected components: any component of two or more files is a cycle.
    let index = 0;
    const stack: string[] = [];
    const onStack = new Set<string>();
    const order = new Map<string, number>();
    const low = new Map<string, number>();
    const cycles: string[][] = [];
    const visit = (v: string) => {
      order.set(v, index);
      low.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);
      for (const w of edges.get(v) ?? []) {
        if (!order.has(w)) {
          visit(w);
          low.set(v, Math.min(low.get(v)!, low.get(w)!));
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, order.get(w)!));
      }
      if (low.get(v) === order.get(v)) {
        const group: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          group.push(rel(w));
        } while (w !== v);
        if (group.length > 1) cycles.push(group.sort());
      }
    };
    for (const v of edges.keys()) if (!order.has(v)) visit(v);
    expect(cycles).toEqual([]);
  });

  it('each shared helper is defined in exactly one place', () => {
    const defines = (text: string, name: string) =>
      new RegExp(
        `(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?(?:function|const|let|class|type|interface)\\s+${name}\\b`
      ).test(text);
    const misplaced: string[] = [];
    for (const [name, home] of Object.entries(CANONICAL)) {
      const at = files.filter((f) => defines(f.text, name)).map((f) => rel(f.file));
      if (at.length !== 1 || at[0] !== home) misplaced.push(`${name}: ${at.join(', ') || 'nowhere'} (home: ${home})`);
    }
    for (const name of RETIRED) {
      for (const f of files) if (defines(f.text, name)) misplaced.push(`${name} is retired: ${rel(f.file)}`);
    }
    expect(misplaced).toEqual([]);
  });
});
