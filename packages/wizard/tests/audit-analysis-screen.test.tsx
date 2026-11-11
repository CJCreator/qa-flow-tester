import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  AuditFinding,
  AuditGetReply,
  AuditMarketing,
  AuditPage,
  AuditResult,
  AuditSummary,
  AuditVersion,
  PageContent,
  RouteSkipReason,
} from '@qa/types/src/browser.js';
import { ROUTE_SKIP_REASONS } from '@qa/types/src/browser.js';
import {
  auditResultUrl,
  getAuditResult,
  getPageContent,
  pageContentUrl,
} from '../src/screens/audit/results/analysis-client';
import {
  AnalysisScreen,
  AnalysisView,
  RESULT_SECTIONS,
  SKIP_REASON_TEXT,
  pageCheckText,
  type AnalysisLoad,
  type ContentLoad,
} from '../src/screens/audit/results/AnalysisScreen';

// ---------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------

const AUDIT_ID = 'abcd1234';

const samplePage: AuditPage = {
  urlPath: '/',
  title: 'Home <script>alert(1)</script>',
  depth: 0,
  coverage: 'sample',
  layoutGroup: 'home',
  language: { primary: 'en', others: [], declared: 'en' },
  sections: [{ id: 's1', kind: 'main' }],
  seo: {
    hasTitle: true,
    hasDescription: true,
    h1Count: 1,
    skippedHeadingLevel: false,
    imagesWithoutAlt: 0,
    htmlLang: 'en',
    findingIds: [],
  },
  accessibility: {
    standard: 'WCAG 2.2',
    level: 'AA',
    method: 'automatic checks only',
    violations: 4,
    findingIds: [],
  },
};

const coveredPage: AuditPage = {
  ...samplePage,
  urlPath: '/services/repair',
  title: 'Repair',
  depth: 2,
  coverage: 'covered',
  sampleUrlPath: '/services',
  accessibility: undefined,
};

const signals = [
  { key: 'ctas', label: 'Calls to action', status: 'found', pages: ['/'], detail: 'A button on the start page.' },
] as AuditMarketing['signals'];

const findings: AuditFinding[] = [
  {
    id: 'AF-001',
    title: 'Image has no alt text',
    rule: 'missing-alt',
    group: 'content',
    area: 'content',
    detail: 'Seen on the page.',
    suggestion: 'Add alt text.',
    impact: 'high',
    effort: 'low',
    urlPath: '/',
    sectionId: 's1',
    source: 'rule',
  },
];

const SKIPPED: Array<{ urlPath: string; why: RouteSkipReason }> = [
  { urlPath: '/account', why: 'sign-in' },
  { urlPath: '/checkout', why: 'payment' },
  { urlPath: '/deep/a/b/c', why: 'depth-limit' },
];

function result(partial: Partial<AuditResult> = {}): AuditResult {
  return {
    auditId: AUDIT_ID,
    version: 2,
    url: 'https://example.org/',
    limits: {} as AuditResult['limits'],
    language: 'en' as AuditResult['language'],
    startedAt: '2026-11-01T10:00:00.000Z',
    finishedAt: '2026-11-01T10:05:00.000Z',
    technology: { status: 'not-identified' },
    pages: [samplePage, coveredPage],
    coverage: { found: 6, reached: 2, skipped: SKIPPED },
    leavingSite: [],
    hierarchy: {
      root: {
        urlPath: '/',
        title: 'Home',
        placedBy: 'start',
        children: [{ urlPath: '/services/repair', title: 'Repair', placedBy: 'menu', children: [] }],
      },
      links: [{ from: '/', to: '/services/repair', region: 'menu', text: 'Repair' }],
    },
    internalLinking: {} as AuditResult['internalLinking'],
    findings,
    roadmap: [],
    marketing: { signals } as AuditMarketing,
    siteAreas: [],
    notes: [],
    ...partial,
  };
}

const version: AuditVersion = {
  auditId: AUDIT_ID,
  version: 2,
  url: 'https://example.org/',
  limits: {} as AuditVersion['limits'],
  language: 'en' as AuditVersion['language'],
  status: 'done',
  startedAt: '2026-11-01T10:00:00.000Z',
};

function reply(partial: Partial<AuditGetReply> = {}): AuditGetReply {
  return {
    summary: { auditId: AUDIT_ID } as AuditSummary,
    version,
    result: result(),
    edits: {} as AuditGetReply['edits'],
    ...partial,
  };
}

const pageContent: PageContent = {
  urlPath: '/services/repair',
  title: 'Repair',
  description: null,
  text: 'We repair phones.',
  headings: [{ level: 1, text: 'We repair phones', sectionId: 's1' }],
  images: [],
  links: [],
  forms: [],
  ctas: [],
  language: { primary: 'en', others: [], declared: 'en' },
  sections: [{ id: 's1', kind: 'main', heading: 'We repair phones', start: 0, end: 17 }],
};

// ---------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockFetch(response: Response | (() => Promise<Response>)) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    typeof response === 'function' ? response() : response
  );
}

/** Reads a matched item, failing the test with a clear message when it is missing. */
function itemAt(items: string[], index: number): string {
  const item = items[index];
  if (item === undefined) throw new Error(`expected an item at index ${index}, found ${items.length}`);
  return item;
}

function view(load: AnalysisLoad, selectedPath: string | null = null, content: ContentLoad = { status: 'idle' }) {
  return renderToStaticMarkup(createElement(AnalysisView, { load, selectedPath, content, onSelect: () => {} }));
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
}

/** The Avoid words of CONTEXT.md for Website Audit, Page Content, Section, Sample Page and Audit Document. */
const AVOID_WORDS =
  /\b(scan\w*|scrap\w*|page data|page dump|blocks?|components?|regions?|plans?|teardown|site review|runs?|reports?|representative|example page|deliverables?|project)\b/i;
/** Claims ADR 0018 and ADR 0033 rule out, and any release verdict. */
const BANNED_CLAIMS = /\b(accessible|compliant|compliance|secure|verdict|ready to release|release|clean|passed)\b/i;

const loaded: AnalysisLoad = { status: 'loaded', reply: reply() };

// ---------------------------------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------------------------------

describe('analysis client: request paths', () => {
  it('requests AUDIT_API.get with the audit id, and the version only when given', async () => {
    const fetchImpl = mockFetch(() => Promise.resolve(jsonResponse(reply())));
    const latest = await getAuditResult(AUDIT_ID, undefined, fetchImpl);
    const second = await getAuditResult(AUDIT_ID, 2, fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/audits/abcd1234');
    expect(fetchImpl.mock.calls[1][0]).toBe('/api/audits/abcd1234?version=2');
    expect(fetchImpl.mock.calls[0][1]?.method).toBe('GET');
    expect(latest.ok && second.ok).toBe(true);
    if (latest.ok) expect(latest.reply.result?.pages).toHaveLength(2);
    expect(auditResultUrl(AUDIT_ID, 0)).toBe('/api/audits/abcd1234');
    expect(auditResultUrl(AUDIT_ID, 1.5)).toBe('/api/audits/abcd1234');
  });

  it('requests AUDIT_API.content with the page path as an encoded query value and the version', async () => {
    const fetchImpl = mockFetch(() => Promise.resolve(jsonResponse({ content: pageContent })));
    const outcome = await getPageContent(AUDIT_ID, '/a b/ü?x=1&y=#top', 3, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      '/api/audits/abcd1234/content?path=%2Fa%20b%2F%C3%BC%3Fx%3D1%26y%3D%23top&version=3'
    );
    expect(fetchImpl.mock.calls[0][1]?.method).toBe('GET');
    expect(outcome).toEqual({ ok: true, reply: { content: pageContent } });
    expect(pageContentUrl(AUDIT_ID, '/')).toBe('/api/audits/abcd1234/content?path=%2F');
  });

  it('never requests an audit id that does not match the id rule', async () => {
    const fetchImpl = mockFetch(jsonResponse(reply()));
    for (const id of ['', '../etc', 'ab', 'abcd1234/../x']) {
      const outcome = await getAuditResult(id, undefined, fetchImpl);
      expect(outcome.ok).toBe(false);
      const content = await getPageContent(id, '/', undefined, fetchImpl);
      expect(content.ok).toBe(false);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('analysis client: refusals come back as { error, code }, never thrown', () => {
  it('returns the reply error and code of a refusal', async () => {
    const fetchImpl = mockFetch(() =>
      Promise.resolve(jsonResponse({ error: 'This Website Audit was deleted.', code: 'ERR_AUDIT_NOT_FOUND' }, 404))
    );
    await expect(getAuditResult(AUDIT_ID, 1, fetchImpl)).resolves.toEqual({
      ok: false,
      error: 'This Website Audit was deleted.',
      code: 'ERR_AUDIT_NOT_FOUND',
    });
    await expect(getPageContent(AUDIT_ID, '/x', 1, fetchImpl)).resolves.toEqual({
      ok: false,
      error: 'This Website Audit was deleted.',
      code: 'ERR_AUDIT_NOT_FOUND',
    });
  });

  it('gives a plain sentence for a known code without a message, and drops an unknown code', async () => {
    const running = await getAuditResult(
      AUDIT_ID,
      undefined,
      mockFetch(jsonResponse({ code: 'ERR_AUDIT_RUNNING' }, 409))
    );
    expect(running).toEqual({
      ok: false,
      error: 'This Website Audit is still in progress. Its analysis shows once it has finished.',
      code: 'ERR_AUDIT_RUNNING',
    });
    const unknown = await getAuditResult(AUDIT_ID, undefined, mockFetch(jsonResponse({ code: 'ERR_WHATEVER' }, 400)));
    expect(unknown.ok).toBe(false);
    expect(unknown).not.toHaveProperty('code');
  });

  it('never passes on raw text from an error page', async () => {
    const raw = 'Error: ENOENT at /srv/app/audits/stack.js:12 <b>trace</b>';
    for (const call of [
      (f: typeof fetch) => getAuditResult(AUDIT_ID, undefined, f),
      (f: typeof fetch) => getPageContent(AUDIT_ID, '/', undefined, f),
    ]) {
      const outcome = await call(mockFetch(() => Promise.resolve(new Response(raw, { status: 500 }))));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).not.toContain('ENOENT');
        expect(outcome.error).toMatch(/^The Website Audit could not be opened/);
      }
    }
  });

  it('returns a sentence when the tool does not answer or answers with something unreadable', async () => {
    const down = await getAuditResult(
      AUDIT_ID,
      undefined,
      mockFetch(() => Promise.reject(new TypeError('fetch failed')))
    );
    expect(down).toEqual({
      ok: false,
      error: 'The tool is not answering. Check your connection and that the tool is still running, then try again.',
    });
    const odd = await getAuditResult(AUDIT_ID, undefined, mockFetch(jsonResponse({ hello: 'world' })));
    expect(odd).toEqual({ ok: false, error: 'The tool sent an answer that could not be read. Try again.' });
    const oddContent = await getPageContent(AUDIT_ID, '/', undefined, mockFetch(jsonResponse({ content: null })));
    expect(oddContent.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------------------------------

describe('AnalysisScreen: loading, error and empty states in words', () => {
  it('starts under an h1 with a loading line, before anything has loaded', () => {
    const fetchImpl = mockFetch(jsonResponse(reply()));
    const html = renderToStaticMarkup(createElement(AnalysisScreen, { auditId: AUDIT_ID, version: 2, fetchImpl }));
    expect(html).toMatch(/<h1[^>]*>Website Audit results<\/h1>/);
    // Until the Helper check answers, the way back is the one a Helper may follow too.
    expect(html).toContain('Back to this Website Audit');
    expect(html).toContain('role="status"');
    expect(textOf(html)).toContain('Loading the Website Audit…');
    expect(html).not.toContain('<main');
  });

  it('states an error in words, as an alert, with Retry and the way back', () => {
    const html = view({ status: 'error', message: 'This Website Audit was deleted.' });
    expect(html).toContain('role="alert"');
    expect(textOf(html)).toContain('This Website Audit was deleted.');
    expect(html).not.toContain('Page hierarchy');
  });

  it('says a version in progress or stopped has no analysis yet', () => {
    const running = view({
      status: 'loaded',
      reply: reply({ result: null, version: { ...version, status: 'running' } }),
    });
    expect(textOf(running)).toContain('This Website Audit is still in progress.');
    const failed = view({
      status: 'loaded',
      reply: reply({
        result: null,
        version: { ...version, status: 'failed', error: 'The website stopped answering.' },
      }),
    });
    expect(textOf(failed)).toContain(
      'stopped before it finished, so it has no analysis. The website stopped answering.'
    );
    expect(failed).not.toContain('Findings');
  });

  it('states empty pages, Skipped Pages and findings in words', () => {
    const empty = view({
      status: 'loaded',
      reply: reply({ result: result({ pages: [], findings: [], coverage: { found: 0, reached: 0, skipped: [] } }) }),
    });
    const text = textOf(empty);
    expect(text).toContain('No pages were recorded.');
    expect(text).toContain('No pages were skipped.');
    expect(text).toContain('No findings were recorded.');
  });
});

describe('AnalysisScreen: the loaded result', () => {
  const html = view(loaded);
  const text = textOf(html);

  it('shows the hierarchy, the page list, the Skipped Pages and the findings under one h1', () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    const h1 = html.indexOf('<h1');
    for (const id of ['audit-hierarchy-title', 'audit-pages-title', 'audit-skipped-title', 'audit-findings-title']) {
      const at = html.indexOf(`<h2 id="${id}"`);
      expect(at, id).toBeGreaterThan(h1);
    }
    expect(text).toContain('https://example.org/ · version 2');
    expect(text).toContain('Image has no alt text');
    expect(text).toContain('No page is picked yet.');
  });

  it('puts Audit Documents ready right after the summary, followed by Findings, with an index of the sections', () => {
    const at = (id: string) => html.indexOf(`<h2 id="${id}"`);
    expect(at('audit-summary-title')).toBeLessThan(at('audit-documents-title'));
    expect(at('audit-documents-title')).toBeLessThan(at('audit-findings-title'));
    for (const id of ['audit-areas-title', 'audit-roadmap-title', 'audit-hierarchy-title', 'audit-pages-title'])
      expect(at('audit-findings-title'), id).toBeLessThan(at(id));
    expect(html).toContain('aria-label="Sections of the results"');
    for (const section of RESULT_SECTIONS) expect(html, section.id).toContain(`id="${section.id}"`);
  });

  it('has one primary action, Review documents, and the audit tabs', () => {
    expect(html.match(/btn-primary/g)).toHaveLength(1);
    expect(html).toMatch(
      /<a [^>]*href="\/audits\/[^"]+\/versions\/2\/review"[^>]*btn-primary[^>]*>Review documents<\/a>|<a [^>]*btn-primary[^>]*href="\/audits\/[^"]+\/versions\/2\/review"[^>]*>Review documents<\/a>/
    );
    expect(html).toContain('aria-label="This Website Audit"');
    expect(html).toMatch(/aria-current="page"[^>]*>Results</);
  });

  it('lists every page as a button that says where its checks come from', () => {
    // Only the page list's buttons: the section index has buttons of its own.
    const pageList = html.slice(
      html.indexOf('<h2 id="audit-pages-title"'),
      html.indexOf('<h2 id="audit-skipped-title"')
    );
    const buttons = pageList.match(/<button[^>]*>.*?<\/button>/g) ?? [];
    expect(buttons).toHaveLength(2);
    const [first, second] = [itemAt(buttons, 0), itemAt(buttons, 1)];
    expect(first).toContain('type="button"');
    expect(first).toContain('aria-pressed="false"');
    expect(textOf(first)).toContain('Sample Page: checked itself');
    expect(textOf(second)).toContain('Checked on its Sample Page /services');
  });

  it('escapes page text taken from the website', () => {
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('lists Skipped Pages as not checked, with their reason, never as clean', () => {
    const skipped = html.slice(
      html.indexOf('<h2 id="audit-skipped-title"'),
      html.indexOf('<h2 id="audit-linking-title"')
    );
    expect(textOf(skipped)).toContain('Pages found: 6 · recorded: 2 · skipped: 3');
    expect(textOf(skipped)).toContain('so it was not checked: it is not a clean result');
    const items = skipped.match(/<li>.*?<\/li>/g) ?? [];
    expect(items).toHaveLength(3);
    for (const [i, page] of SKIPPED.entries()) {
      expect(textOf(items[i])).toContain(`${page.urlPath} · Not checked: ${SKIP_REASON_TEXT[page.why]}`);
    }
    expect(textOf(itemAt(items, 0))).toContain('needs a sign-in');
  });

  it('has a plain reason for every skip reason', () => {
    for (const why of ROUTE_SKIP_REASONS) {
      expect(SKIP_REASON_TEXT[why], why).toMatch(/\S/);
      expect(SKIP_REASON_TEXT[why], why).not.toMatch(BANNED_CLAIMS);
    }
  });
});

describe('AnalysisScreen: the picked page', () => {
  it('shows a Sample Page with its own accessibility results and its Page Content once loaded', () => {
    const html = view(loaded, '/', { status: 'loaded', urlPath: '/', content: { ...pageContent, urlPath: '/' } });
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*?<span[^>]*>\/<\/span>/);
    expect(html).toContain('id="page-facts-title"');
    expect(textOf(html)).toContain('Violations found');
    expect(html).toContain('id="page-content-title"');
    expect(textOf(html)).toContain('We repair phones');
    expect(html.indexOf('id="page-content-title"')).toBeGreaterThan(html.indexOf('<h1'));
  });

  it('says a covered page is checked on its Sample Page instead of showing empty accessibility results', () => {
    const html = view(loaded, '/services/repair', {
      status: 'loaded',
      urlPath: '/services/repair',
      content: pageContent,
    });
    const text = textOf(html);
    expect(text).toContain(
      'Checked on its Sample Page /services. Its checks, notes and recommendation come from that Sample Page'
    );
    expect(text).not.toContain('Violations found');
    expect(pageCheckText({ ...coveredPage, sampleUrlPath: undefined })).toBe('Checked on its Sample Page');
  });

  it('states loading and error of the Page Content in words', () => {
    const loading = view(loaded, '/services/repair', { status: 'loading', urlPath: '/services/repair' });
    expect(loading).toContain('role="status"');
    expect(textOf(loading)).toContain('Loading the Page Content of /services/repair…');
    expect(loading).not.toContain('id="page-content-title"');
    const failed = view(loaded, '/services/repair', {
      status: 'error',
      urlPath: '/services/repair',
      message: 'This Website Audit, version or page was not found. It may have been deleted.',
    });
    expect(failed).toMatch(/role="alert"[^>]*>The Page Content of \/services\/repair could not be loaded\./);
  });

  it('does not show the Page Content of another page than the picked one', () => {
    const html = view(loaded, '/', { status: 'loaded', urlPath: '/services/repair', content: pageContent });
    expect(html).not.toContain('id="page-content-title"');
  });
});

describe('AnalysisScreen: wording', () => {
  const renders: Record<string, string> = {
    loading: view({ status: 'loading' }),
    error: view({ status: 'error', message: 'This Website Audit was deleted.' }),
    loaded: view(loaded),
    sample: view(loaded, '/', { status: 'loaded', urlPath: '/', content: { ...pageContent, urlPath: '/' } }),
    covered: view(loaded, '/services/repair', { status: 'loaded', urlPath: '/services/repair', content: pageContent }),
    contentLoading: view(loaded, '/', { status: 'loading', urlPath: '/' }),
    running: view({ status: 'loaded', reply: reply({ result: null, version: { ...version, status: 'running' } }) }),
  };

  it('uses no Avoid word of CONTEXT.md', () => {
    for (const [name, html] of Object.entries(renders)) {
      expect(textOf(html), name).not.toMatch(AVOID_WORDS);
    }
  });

  it('shows no release verdict and calls nothing clean, passed or accessible', () => {
    for (const [name, html] of Object.entries(renders)) {
      // The Skipped Pages line says a Skipped Page is "not a clean result"; nothing else may say clean.
      const text = textOf(html).replace('it is not a clean result', '');
      expect(text, name).not.toMatch(BANNED_CLAIMS);
    }
  });
});

describe('imports', () => {
  it('reaches @qa/types only through @qa/types/src/browser.js', () => {
    for (const file of [
      '../src/screens/audit/results/AnalysisScreen.tsx',
      '../src/screens/audit/results/DocumentsReady.tsx',
      '../src/screens/audit/results/SkippedPagesView.tsx',
      '../src/screens/audit/results/analysis-client.ts',
      './audit-analysis-screen.test.tsx',
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      const specifiers = [...source.matchAll(/from '(@qa\/types[^']*)'/g)].map((m) => m[1]);
      expect(specifiers.length, file).toBeGreaterThan(0);
      for (const specifier of specifiers) expect(specifier, file).toBe('@qa/types/src/browser.js');
    }
  });
});
