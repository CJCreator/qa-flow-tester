import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  AreaAssessment,
  AuditFinding,
  AuditGetReply,
  AuditMarketing,
  AuditPage,
  AuditResult,
  AuditScale,
  AuditSummary as AuditSummaryReply,
  AuditVersion,
  PageSpeed,
} from '@qa/types/src/browser.js';
import { AnalysisView, type AnalysisLoad } from '../src/screens/audit/results/AnalysisScreen';
import { auditFileUrl } from '../src/screens/audit/results/analysis-client';
import { NOT_DONE_REASON_TEXT, fixFirst } from '../src/screens/audit/results/analysis-text';
import { PageFactsView } from '../src/screens/audit/results/PageFactsView';
import { PageContentView } from '../src/screens/audit/results/PageContentView';
import { HierarchyView } from '../src/screens/audit/results/HierarchyView';

const ID = 'abcd1234';

function finding(id: string, impact: AuditScale, effort: AuditScale): AuditFinding {
  return {
    id,
    rule: 'missing-alt',
    group: 'content',
    area: 'content',
    title: `Finding ${id}`,
    detail: 'Seen on the page.',
    suggestion: 'Add alt text.',
    impact,
    effort,
    urlPath: '/',
    sectionId: null,
    source: 'rule',
  };
}

// Deliberately not in ranked order.
const FINDINGS = [
  finding('AF-1', 'low', 'low'),
  finding('AF-2', 'high', 'high'),
  finding('AF-3', 'medium', 'low'),
  finding('AF-4', 'high', 'low'),
  finding('AF-5', 'high', 'medium'),
  finding('AF-6', 'low', 'high'),
  finding('AF-7', 'medium', 'medium'),
];

const page: AuditPage = {
  urlPath: '/',
  title: 'Home',
  depth: 0,
  coverage: 'sample',
  language: { primary: 'en', others: [], declared: 'en' },
  sections: [],
  seo: {
    hasTitle: true,
    hasDescription: true,
    h1Count: 1,
    skippedHeadingLevel: false,
    imagesWithoutAlt: 0,
    htmlLang: 'en',
    findingIds: [],
  },
};

const speed: PageSpeed = {
  lab: {
    status: 'measured',
    source: 'pagespeed-insights',
    method: 'lab',
    strategy: 'mobile',
    values: [
      { metric: 'performance-score', value: 78, unit: 'score' },
      { metric: 'lcp', value: 2400, unit: 'ms' },
    ],
    measuredAt: '2026-11-01T10:00:00.000Z',
  },
  field: { status: 'not-measured', source: 'pagespeed-insights', method: 'field', reason: 'no-field-data' },
};

const AREAS: AreaAssessment[] = [
  { area: 'speed', grade: null, status: 'not-done', reason: 'no-ai-key' },
  { area: 'content', grade: 'B', status: 'done', note: 'Pages read clearly.', evidence: ['AF-1'] },
  { area: 'usability', grade: 'D', status: 'not-done', reason: 'ai-failed' },
];

const version: AuditVersion = {
  auditId: ID,
  version: 3,
  url: 'https://example.org/',
  limits: {} as AuditVersion['limits'],
  language: 'en' as AuditVersion['language'],
  status: 'done',
  startedAt: '2026-11-01T10:00:00.000Z',
};

function result(partial: Partial<AuditResult> = {}): AuditResult {
  return {
    auditId: ID,
    version: 3,
    url: 'https://example.org/',
    limits: {} as AuditResult['limits'],
    language: 'en' as AuditResult['language'],
    startedAt: '2026-11-01T10:00:00.000Z',
    finishedAt: '2026-11-01T10:05:00.000Z',
    technology: { status: 'not-identified' },
    pages: [page],
    coverage: {
      found: 9,
      reached: 4,
      skipped: [
        { urlPath: '/a', why: 'sign-in' },
        { urlPath: '/b', why: 'payment' },
      ],
    },
    leavingSite: [{ to: 'https://maps.example.com/x', from: ['/', '/contact'] }],
    hierarchy: { root: { urlPath: '/', title: 'Home', placedBy: 'start', children: [] }, links: [] },
    internalLinking: { inboundCounts: { '/': 3 }, unlinkedPages: ['/lost'] },
    findings: FINDINGS,
    roadmap: [
      {
        id: 'R-2',
        title: 'Tidy headings',
        priority: 'low',
        phase: 2,
        effort: 'low',
        findingIds: ['AF-6'],
        pages: ['/'],
      },
      {
        id: 'R-1',
        title: 'Add alt text',
        priority: 'high',
        phase: 1,
        effort: 'low',
        findingIds: ['AF-1', 'AF-2'],
        pages: ['/'],
      },
    ],
    marketing: { signals: [] } as unknown as AuditMarketing,
    siteAreas: AREAS,
    notes: ['AI notes need an AI key.'],
    ...partial,
  };
}

function reply(r: AuditResult | null = result()): AuditGetReply {
  return {
    summary: { auditId: ID } as AuditSummaryReply,
    version,
    result: r,
    edits: {} as AuditGetReply['edits'],
  };
}

function view(load: AnalysisLoad, extra: { onRetry?: () => void; auditId?: string; isHelper?: boolean | null } = {}) {
  return renderToStaticMarkup(
    createElement(AnalysisView, {
      load,
      selectedPath: null,
      content: { status: 'idle' },
      onSelect: () => {},
      ...extra,
    })
  );
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');
}

const loaded: AnalysisLoad = { status: 'loaded', reply: reply() };
const html = view(loaded);
const text = textOf(html);

describe('summary', () => {
  it('counts pages recorded and skipped, and findings by impact', () => {
    expect(text).toContain('4 pages recorded');
    expect(text).toContain('2 pages skipped, not checked');
    expect(text).toContain('High: 3');
    expect(text).toContain('Medium: 2');
    expect(text).toContain('Low: 2');
  });

  it('lists at most five findings under Fix first: impact, then lower effort', () => {
    const items = [...html.matchAll(/data-fix-first="([^"]+)"/g)].map((m) => m[1]);
    expect(items).toEqual(['AF-4', 'AF-5', 'AF-2', 'AF-3', 'AF-7']);
    expect(fixFirst(FINDINGS).map((f) => f.id)).toEqual(items);
    expect(fixFirst([], 5)).toEqual([]);
  });

  it('gives no whole-site verdict, stamp or pass/fail wording', () => {
    expect(text).not.toMatch(/ready to release|verdict|\bpass(ed)?\b|\bfail(ed)?\b|\bstamp\b/i);
  });
});

describe('site areas', () => {
  const areas = html.slice(html.indexOf('audit-areas-title'), html.indexOf('audit-roadmap-title'));

  it('shows no grade for an area where no checks ran', () => {
    const speedCard = areas.slice(areas.indexOf('data-area="speed"'), areas.indexOf('data-area="content"'));
    expect(textOf(speedCard)).toContain('No grade: no checks ran');
    expect(speedCard).not.toMatch(/Grade [A-F]/);
  });

  it('shows the grade in its token colours and the AI note with an advisory chip', () => {
    const card = areas.slice(areas.indexOf('data-area="content"'), areas.indexOf('data-area="usability"'));
    expect(textOf(card)).toContain('Grade B');
    expect(card).toContain('text-pass');
    expect(card).toContain('bg-stamp-tint');
    expect(textOf(card)).toContain('AI advisory');
    expect(textOf(card)).toContain('Pages read clearly.');
  });

  it('says why an AI note is missing, beside a grade from the checks', () => {
    const card = areas.slice(areas.indexOf('data-area="usability"'));
    expect(textOf(card)).toContain('Grade D');
    expect(textOf(card)).toContain('No AI note was written: the AI did not answer.');
    expect(textOf(card)).not.toContain('AI advisory');
  });
});

describe('notes, roadmap and links', () => {
  it('shows result.notes in a banner that links to Settings, where the AI key is added', () => {
    expect(text).toContain('AI notes need an AI key.');
    expect(html).toMatch(/<a [^>]*href="\/settings"[^>]*>Add an AI key in Settings<\/a>/);
    expect(NOT_DONE_REASON_TEXT['no-ai-key']).toContain('Add one in Settings.');
    expect(NOT_DONE_REASON_TEXT['no-ai-key']).not.toContain('Website Audit settings');
  });

  it('has no banner without notes', () => {
    const none = textOf(view({ status: 'loaded', reply: reply(result({ notes: [] })) }));
    expect(none).not.toContain('Notes about this Website Audit');
  });

  it('groups the Improvement Roadmap by phase, phase 1 first', () => {
    expect(text).toContain('Improvement Roadmap');
    expect(text.indexOf('Phase 1')).toBeLessThan(text.indexOf('Phase 2'));
    expect(text).toContain('Add alt text');
    expect(text).toContain('Covers 2 findings on 1 page');
  });

  it('lists internal linking, with its table in a scroll wrapper, and links that leave the website', () => {
    expect(text).toContain('1 page has no link to it from another recorded page');
    expect(text).toContain('/lost');
    expect(text).toContain('https://maps.example.com/x · on /, /contact');
  });
});

describe('action row and states', () => {
  it('links to review, export, shared links and the Website Audit', () => {
    expect(html).toMatch(/<a [^>]*href="\/audits\/abcd1234\/versions\/3\/review"[^>]*>Review Audit Documents<\/a>/);
    expect(html).toMatch(/<a [^>]*href="\/audits\/abcd1234\/versions\/3\/export"[^>]*>Export<\/a>/);
    expect(html).toMatch(/<a [^>]*href="\/audits\/abcd1234\/share"[^>]*>Preview and Shared Links<\/a>/);
    expect(html).toMatch(/<a [^>]*href="\/audits\/abcd1234"[^>]*>Back to this Website Audit<\/a>/);
  });

  it('hides Preview and Shared Links from a Helper and until the check has answered', () => {
    const loadedView = (isHelper: boolean | null) => view(loaded, { isHelper });
    expect(loadedView(true)).not.toContain('Preview and Shared Links');
    expect(loadedView(null)).not.toContain('Preview and Shared Links');
    expect(textOf(loadedView(true))).toContain('Review Audit Documents');
    expect(loadedView(false)).toContain('Preview and Shared Links');
  });

  it('gives an error Retry and the way back, and uses a div, not a nested main', () => {
    const error = view({ status: 'error', message: 'Not found.' }, { auditId: ID, onRetry: () => {} });
    expect(error).toMatch(/<button[^>]*>Retry<\/button>/);
    expect(error).toMatch(/href="\/audits\/abcd1234"[^>]*>Back to this Website Audit/);
    expect(error).not.toContain('<main');
    expect(error).toContain('max-w-4xl');
  });

  it('shows a running version no action row but the way back', () => {
    const running = view({ status: 'loaded', reply: reply(null) });
    expect(running).not.toContain('Review Audit Documents');
    expect(running).toContain('Back to this Website Audit');
  });
});

describe('page facts: speed, phone layout, screenshot', () => {
  const props = { technology: { status: 'not-identified' } as const, signals: [] };
  const facts = (p: AuditPage, extra = {}) =>
    renderToStaticMarkup(createElement(PageFactsView, { page: p, ...props, ...extra }));

  it('shows how speed was measured, its values and why a part was not measured', () => {
    const t = textOf(facts({ ...page, speed }));
    expect(t).toContain('Lab test: a Lighthouse test made by the Google PageSpeed Insights API, simulating a phone');
    expect(t).toContain('Performance score (0 to 100) 78');
    expect(t).toContain('Largest Contentful Paint 2400 ms');
    expect(t).toContain('Not measured: Google has no visitor data for this page.');
    expect(t).toContain('not a guarantee');
  });

  it('shows the phone layout and a lazy screenshot through the file endpoint', () => {
    const out = facts(
      { ...page, phone: { widthPx: 390, screenshotPath: 'shots/home phone.png', overflow: true, findingIds: [] } },
      { auditId: ID, version: 3 }
    );
    expect(textOf(out)).toContain('Screen width tested 390 px');
    expect(textOf(out)).toContain('The page is wider than the screen');
    expect(out).toMatch(/<img[^>]*loading="lazy"/);
    expect(out).toContain('src="/api/audits/abcd1234/file?path=shots%2Fhome%20phone.png&amp;version=3"');
    expect(out).toMatch(/alt="[^"]+390 px/);
    expect(auditFileUrl(ID, 'a.png')).toBe('/api/audits/abcd1234/file?path=a.png');
  });

  it('says so when the screenshot failed, and shows nothing without speed or phone data', () => {
    const failed = facts(
      { ...page, phone: { widthPx: 390, screenshotPath: null, overflow: null, findingIds: [] } },
      { auditId: ID }
    );
    expect(textOf(failed)).toContain('No screenshot was taken.');
    expect(failed).not.toContain('<img');
    const bare = facts(page, { auditId: ID, version: 3 });
    expect(bare).not.toContain('<img');
    expect(textOf(bare)).not.toMatch(/Phone layout|Speed \(PageSpeed Insights\)/);
  });
});

describe('tables', () => {
  it('sit inside an overflow-x-auto wrapper in every view', () => {
    const views = [
      html,
      renderToStaticMarkup(
        createElement(PageFactsView, {
          page,
          technology: { status: 'not-identified' },
          signals: [
            { key: 'ctas', label: 'Calls to action', status: 'found', pages: ['/'], detail: 'x' },
          ] as AuditMarketing['signals'],
        })
      ),
      renderToStaticMarkup(
        createElement(HierarchyView, {
          hierarchy: {
            root: { urlPath: '/', title: 'Home', placedBy: 'start', children: [] },
            links: [{ from: '/', to: '/x', region: 'menu', text: 'X' }],
          },
        })
      ),
      renderToStaticMarkup(
        createElement(PageContentView, {
          content: {
            urlPath: '/',
            title: 'T',
            description: null,
            text: 'hi',
            headings: [{ level: 1, text: 'H', sectionId: null }],
            images: [{ src: '/i.png', alt: 'i' }],
            links: [],
            forms: [],
            ctas: [],
            language: { primary: 'en', others: [], declared: 'en' },
            sections: [],
          } as never,
        })
      ),
    ];
    for (const out of views) {
      const tables = out.match(/<table/g) ?? [];
      const wrapped = out.match(/<div class="overflow-x-auto"><table/g) ?? [];
      expect(tables.length).toBeGreaterThan(0);
      expect(wrapped).toHaveLength(tables.length);
    }
  });
});
