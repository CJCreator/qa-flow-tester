/**
 * ADR 0031 (REQ-047 AC-6): page- and site-derived addresses are reached only through makeOutboundFetch / safeGet.
 * This scan keeps Playwright's request API (context.request, page.request, request.fetch/get/head) and Node
 * `fetch(` out of packages/core/src and packages/checkers/src, except for the calls named below with a reason.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const SCANNED = ['packages/core/src', 'packages/checkers/src'];

type Rule = { name: string; pattern: RegExp };
const RULES: Rule[] = [
  { name: 'context.request', pattern: /\bcontext(?:\(\))?\??\.request\b/ },
  { name: 'page.request', pattern: /\bpage(?:\(\))?\??\.request\b/ },
  { name: 'request.fetch/get/head', pattern: /\brequest\??\.(?:fetch|get|head)\s*\(/ },
  // A call of the global fetch: not a method (`.fetch(`), not a declaration (`async fetch(`, `function fetch(`).
  { name: 'node fetch', pattern: /(?:(?<![.\w$]|async |function )fetch|\bglobalThis\.fetch)\s*\(/ },
];

/** Calls still allowed, each with its reason. A stale entry (nothing left to excuse) fails the test too. */
const EXCEPTIONS: Array<{ file: string; rule: string; reason: string }> = [
  {
    file: 'packages/core/src/ai/providers/anthropic.ts',
    rule: 'node fetch',
    reason: 'AI provider endpoint, fixed address',
  },
  {
    file: 'packages/core/src/ai/providers/gemini.ts',
    rule: 'node fetch',
    reason: 'AI provider endpoint, fixed address',
  },
  {
    file: 'packages/core/src/ai/gemini-models.ts',
    rule: 'node fetch',
    reason: 'AI provider endpoint (Gemini model list and one-line probe), fixed address',
  },
  {
    file: 'packages/core/src/ai/providers/openai.ts',
    rule: 'node fetch',
    reason: 'AI provider endpoint, fixed address',
  },
  {
    file: 'packages/core/src/preflight.ts',
    rule: 'node fetch',
    reason: 'user-provided target address, not page-derived; the caller can pass the pinned getter',
  },
  {
    file: 'packages/core/src/discovery/docs-fetch.ts',
    rule: 'node fetch',
    reason: 'localDocsGet: user-provided address, not page-derived',
  },
  {
    file: 'packages/core/src/plan/playwright-export.ts',
    rule: 'request.fetch/get/head',
    reason: 'generated code text for the exported Playwright test, not a call made by the runner',
  },
  {
    file: 'packages/core/src/audit/store/select-backend.ts',
    rule: 'node fetch',
    reason: 'Cloud Storage and metadata endpoints, fixed addresses, not page-derived',
  },
];

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTs(full));
    else if (/\.(ts|tsx|mts)$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Each rule hit as `rule @ line`, comment lines skipped. */
function scanSource(text: string): Array<{ rule: string; line: number }> {
  const hits: Array<{ rule: string; line: number }> = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(raw)) return;
    for (const r of RULES) if (r.pattern.test(raw)) hits.push({ rule: r.name, line: i + 1 });
  });
  return hits;
}

describe('outbound source grep (ADR 0031)', () => {
  it('flags each forbidden call form', () => {
    const bad = [
      'const r = await page.context().request.fetch(url);',
      'await context.request.get(u);',
      'const res = await page.request.get(address, { timeout: 1 });',
      'await request.head(link);',
      'const res = await fetch(url);',
      'await globalThis.fetch(u, init);',
    ];
    for (const line of bad) expect(scanSource(line), line).not.toEqual([]);
    const fine = [
      'const res = await fetchFn(url);',
      'static async fetch(origin: string) {',
      'await RobotsPolicy.fetch(origin, token);',
      'const response = await opts.fetch(url);',
      '// page.request.get is not used here',
      '  * a comment about fetch(url)',
    ];
    for (const line of fine) expect(scanSource(line), line).toEqual([]);
  });

  it('finds no Playwright request call or Node fetch outside the named exceptions', () => {
    const offenders: string[] = [];
    const used = new Set<number>();
    for (const dir of SCANNED) {
      for (const file of listTs(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        for (const hit of scanSource(readFileSync(file, 'utf8'))) {
          const ex = EXCEPTIONS.findIndex((e) => e.file === rel && e.rule === hit.rule);
          if (ex >= 0) used.add(ex);
          else offenders.push(`${rel}:${hit.line} (${hit.rule})`);
        }
      }
    }
    expect(offenders).toEqual([]);
    const stale = EXCEPTIONS.filter((_, i) => !used.has(i)).map((e) => `${e.file} (${e.rule})`);
    expect(stale).toEqual([]);
  });
});
