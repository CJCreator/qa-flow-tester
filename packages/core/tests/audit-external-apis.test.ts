/**
 * QA-400, REQ-043 AC-1: source inspection of the Website Audit (packages/core/src/audit/**). Every absolute
 * https URL in it is listed and classified; the only external data API is the PageSpeed Insights v5 endpoint,
 * and ADR 0035 records that it is used on its free tier. A new https URL in the audit fails this test until it
 * is classified here (and, if it is a data API, its free tier is recorded in an ADR).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PSI_ENDPOINT } from '../src/audit/ai/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const AUDIT_SRC = join(here, '..', 'src', 'audit');
const ADR_0035 = join(here, '..', '..', '..', 'docs', 'adr', '0035-pagespeed-data.md');

const PSI_V5 = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

interface UrlUse {
  file: string;
  line: number;
  url: string;
  /** The URL sits in a comment (documentation example), not in code. */
  inComment: boolean;
}

const URL_RE = /https:\/\/[^\s'"`<>)\]},]+/g;

function urlUses(): UrlUse[] {
  const uses: UrlUse[] = [];
  for (const file of filesUnder(AUDIT_SRC)) {
    const rel = relative(AUDIT_SRC, file).split(sep).join('/');
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((text, i) => {
      for (const m of text.matchAll(URL_RE)) {
        const before = text.slice(0, m.index);
        const inComment =
          /^\s*(\*|\/\/|\/\*)/.test(text) || (before.includes('//') && !before.includes("'") && !before.includes('`'));
        uses.push({ file: rel, line: i + 1, url: m[0].replace(/[.;:]+$/, ''), inComment });
      }
    });
  }
  return uses;
}

/** Every https host the audit source may name, and what it is. Only 'data-api' entries are external data APIs. */
const KNOWN: Record<string, { kind: 'data-api' | 'storage-backend' | 'doc-example'; why: string }> = {
  'www.googleapis.com': {
    kind: 'data-api',
    why: 'PageSpeed Insights v5 (ADR 0035): the only external data API of the Website Audit.',
  },
  'storage.googleapis.com': {
    kind: 'storage-backend',
    why: "The runner's own audit store on Cloud Storage (ADR 0036): where results are kept, not a data source.",
  },
  'example.com': { kind: 'doc-example', why: 'Placeholder origin in doc comments only.' },
};

describe('Website Audit external APIs (REQ-043 AC-1)', () => {
  const uses = urlUses();

  it('finds the https URLs in packages/core/src/audit/**', () => {
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.some((u) => u.url === PSI_V5)).toBe(true);
  });

  it('every https URL in the audit source is a known, classified host', () => {
    const unknown = uses.filter((u) => !(new URL(u.url).host in KNOWN));
    expect(unknown.map((u) => `${u.file}:${u.line} ${u.url}`)).toEqual([]);
  });

  it('placeholder hosts appear in comments only, never in code', () => {
    const inCode = uses.filter((u) => KNOWN[new URL(u.url).host]?.kind === 'doc-example' && !u.inComment);
    expect(inCode.map((u) => `${u.file}:${u.line} ${u.url}`)).toEqual([]);
  });

  it('the only external data API is the PageSpeed Insights v5 endpoint, defined once in pagespeed.ts', () => {
    const dataApis = uses.filter((u) => KNOWN[new URL(u.url).host]?.kind === 'data-api');
    expect([...new Set(dataApis.map((u) => u.url))]).toEqual([PSI_V5]);
    expect(dataApis.map((u) => u.file)).toEqual(['ai/pagespeed.ts']);
    expect(PSI_ENDPOINT).toBe(PSI_V5);
    // Nothing else on the Google APIs host (another Google data API would land here).
    const googleApis = uses.filter((u) => new URL(u.url).host === 'www.googleapis.com');
    for (const u of googleApis) expect(new URL(u.url).pathname).toBe('/pagespeedonline/v5/runPagespeed');
  });

  it('the storage host is only the Cloud Storage audit store backend', () => {
    const storage = uses.filter((u) => KNOWN[new URL(u.url).host]?.kind === 'storage-backend');
    expect([...new Set(storage.map((u) => u.file))]).toEqual(['store/gcs-backend.ts']);
  });

  it('the PageSpeed request goes through makeOutboundFetch and sends the key in a header, not the address', () => {
    const source = readFileSync(join(AUDIT_SRC, 'ai', 'pagespeed.ts'), 'utf8');
    expect(source).toMatch(/makeOutboundFetch\(/);
    expect(source).toMatch(/x-goog-api-key/);
    expect(source).not.toMatch(/searchParams\.(set|append)\(\s*['"]key['"]/);
    // No raw fetch call in code (comments aside).
    const code = source
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join('\n');
    expect(code).not.toMatch(/(^|[^\w.])fetch\(/);
  });

  it('ADR 0035 names the endpoint as the only external data API and says it is used on its free tier', () => {
    const adr = readFileSync(ADR_0035, 'utf8');
    expect(adr).toContain(PSI_V5);
    expect(adr).toMatch(/REQ-043/);
    expect(adr).toMatch(/only external data API/i);
    expect(adr).toMatch(/\*\*Free tier\.\*\*\s*The API is free/);
    expect(adr).toMatch(/no billing account is needed/i);
    expect(adr).toMatch(/Nothing in the tool\s+needs payment/i);
  });
});
