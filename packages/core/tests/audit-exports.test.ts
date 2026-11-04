import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../src/index.js';
import * as crawl from '../src/audit/crawl/index.js';
import * as analysis from '../src/audit/analysis/index.js';
import * as ai from '../src/audit/ai/index.js';
import * as documents from '../src/audit/documents/index.js';
import * as store from '../src/audit/store/index.js';
import * as pipeline from '../src/audit/pipeline/index.js';
import * as phoneLayout from '../src/audit/phone-layout.js';
import * as preview from '../src/audit/preview/index.js';

const coreExports = core as Record<string, unknown>;

/** Entry points of each group that the runner needs from @qa/core. */
const ENTRY_POINTS: Record<string, string[]> = {
  crawl: ['runAuditCrawl'],
  analysis: ['analyseSite', 'readPage', 'accessibilityBasics'],
  ai: ['resolveAuditAi', 'assessPages', 'rankFindings', 'measureSampleSpeeds'],
  store: ['AuditStore', 'createAuditStore', 'selectAuditStoreBackend'],
  pipeline: ['runAuditPipeline', 'createPageRecorder'],
  phoneLayout: ['recordPhoneLayout'],
  preview: ['generatePreview', 'sanitizePreviewHtml'],
};

describe('audit exports reach @qa/core', () => {
  it.each(Object.entries(ENTRY_POINTS).flatMap(([group, names]) => names.map((n) => [group, n] as const)))(
    '%s entry point %s is exported by @qa/core',
    (_group, name) => {
      expect(typeof coreExports[name]).not.toBe('undefined');
    }
  );

  it('every value exported by a group barrel is the same object in @qa/core (no shadowed duplicates)', () => {
    const groups: Record<string, Record<string, unknown>> = {
      crawl,
      analysis,
      ai,
      documents,
      store,
      pipeline,
      phoneLayout,
      preview,
    };
    const missing: string[] = [];
    for (const [group, mod] of Object.entries(groups)) {
      for (const [name, value] of Object.entries(mod)) {
        if (coreExports[name] !== value) missing.push(`${group}.${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

const AUDIT_DIR = join(fileURLToPath(new URL('../src/audit', import.meta.url)));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Drop comments so the assertion looks at code only. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * The audit store talks to Google Cloud Storage, not to an audited site. Its default network function is
 * injectable (`options.fetch`) and is the only place the global fetch is named.
 */
const GLOBAL_FETCH_ALLOWED = new Set(['store/select-backend.ts']);

const FETCH_CALL =
  /(^|[^.\w$])fetch\s*\(|globalThis\.fetch|\bglobal\.fetch|\bwindow\.fetch|from\s+['"](?:undici|node-fetch)['"]/;
const PLAYWRIGHT_REQUEST_API =
  /\b(?:page|context|ctx|browserContext)\.request\b|\bAPIRequestContext\b|\bAPIRequest\b|\brequest\.newContext\b|\.request\.(?:get|post|put|patch|delete|fetch|head)\s*\(/;

describe('audit sources make no direct requests', () => {
  const files = sourceFiles(AUDIT_DIR);

  it('finds the audit sources', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('no module calls Node fetch directly (outbound requests go through makeCheckerFetch)', () => {
    const offenders = files
      .map((f) => ({ rel: relative(AUDIT_DIR, f).split(sep).join('/'), code: stripComments(readFileSync(f, 'utf8')) }))
      .filter(({ rel, code }) => !GLOBAL_FETCH_ALLOWED.has(rel) && FETCH_CALL.test(code))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it('no module uses Playwright request APIs', () => {
    const offenders = files
      .map((f) => ({ rel: relative(AUDIT_DIR, f).split(sep).join('/'), code: stripComments(readFileSync(f, 'utf8')) }))
      .filter(({ code }) => PLAYWRIGHT_REQUEST_API.test(code))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });
});
