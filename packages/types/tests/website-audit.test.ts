/**
 * BE-002: the Website Audit contract. Runtime checks for the validator, the fixed lists and the route table;
 * `satisfies` and `expectTypeOf` pin the shapes for the type-check (a removed or renamed field fails there).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  AUDIT_API,
  AUDIT_AREAS,
  AUDIT_DOCUMENT_KINDS,
  AUDIT_ERROR_CODES,
  AUDIT_ID_PATTERN,
  AUDIT_LIMIT_DEFAULTS,
  DOCUMENT_LANGUAGES,
  DOCUMENT_LANGUAGE_INFO,
  EXPORT_CONTENT_TYPES,
  EXPORT_FORMATS,
  HELPER_PERMISSIONS,
  SHARE_LINK_DAYS,
  SHARE_LINK_ID_PATTERN,
  SHARED_LINK_PREFIX,
  SHORTLIST_OUTCOMES,
  TECHNOLOGIES,
  auditPath,
  isAuditDocumentKind,
  isDocumentLanguage,
  isExportFormat,
  isShortlistOutcome,
  matchAuditPath,
  sectionText,
  validateAuditStartBody,
  type AreaAssessment,
  type AuditAiStatus,
  type AuditApi,
  type AuditFinding,
  type AuditPageState,
  type AuditProgressEvent,
  type AuditStage,
  type AuditStartBody,
  type AuditStartErrors,
  type AuditVersion,
  type EditOverlay,
  type ExternalSpeed,
  type PageContent,
  type ShortlistEntry,
  type ShortlistOutcome,
  type SpeedSource,
  type StoredAuditDocument,
  type TechnologyResult,
} from '../src/website-audit.js';
import { ROUTE_SKIP_REASONS, type RouteSkipReason } from '../src/route-telemetry.js';
import { AI_STAGES, STAGE_MODEL_SLOT, modelForStage, type AIStage, type ModelsByStage } from '../src/ai.js';
import { MARKETING_SIGNALS, type MarketingReview } from '../src/aspects.js';
import { CRAWL_LIMIT_BOUNDS, type CrawlLimits } from '../src/discovery.js';

const TYPES_SRC = fileURLToPath(new URL('../src', import.meta.url));

/** The start body with every field valid, so one test changes one field at a time. */
const VALID = { url: 'https://example.com/' };

function errorsFor(body: unknown): AuditStartErrors {
  const check = validateAuditStartBody(body);
  if (check.ok) throw new Error('expected the body to be refused');
  return check.errors;
}

describe('validateAuditStartBody: the address (REQ-001 AC-3)', () => {
  it('accepts an http(s) address, normalises it and fills in every default', () => {
    const check = validateAuditStartBody({ url: '  https://Example.com/shop?x=1#top  ' });
    expect(check).toEqual({
      ok: true,
      value: {
        url: 'https://example.com/shop?x=1',
        limits: {
          maxPages: AUDIT_LIMIT_DEFAULTS.pages,
          maxDepth: AUDIT_LIMIT_DEFAULTS.depth,
          includePaths: [],
          excludePaths: [],
        },
        language: 'en',
      },
    });
    expect(validateAuditStartBody({ url: 'http://127.0.0.1:4173/' }).ok).toBe(true);
  });

  it.each([undefined, null, '', '   ', 42, ['https://example.com'], { href: 'https://example.com' }])(
    'refuses a missing or non-text address (%j) with a message on url only',
    (url) => {
      const errors = errorsFor({ url });
      expect(Object.keys(errors)).toEqual(['url']);
      expect(errors.url).toMatch(/website address/);
    }
  );

  it.each(['not a url', 'example.com', 'www.example.com/blog', 'https://', 'http://exa mple.com'])(
    'refuses a non-URL (%j)',
    (url) => {
      const errors = errorsFor({ url });
      expect(Object.keys(errors)).toEqual(['url']);
      expect(errors.url).toMatch(/not a web address/);
    }
  );

  it.each([
    'ftp://example.com/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'mailto:owner@example.com',
    'data:text/html,hi',
    'ws://example.com/',
  ])('refuses a scheme other than http(s) (%j)', (url) => {
    expect(errorsFor({ url })).toEqual({ url: 'The address must start with http:// or https://.' });
  });

  it('refuses a user name or password in the address, without repeating it', () => {
    const errors = errorsFor({ url: 'https://me:hunter2@example.com/' });
    expect(errors.url).toBe('Leave the user name and password out of the address.');
    expect(errors.url).not.toContain('hunter2');
  });

  it('refuses an address over 2048 characters', () => {
    expect(errorsFor({ url: `https://example.com/${'a'.repeat(2048)}` }).url).toMatch(/longer than 2048/);
  });

  it('treats a body that is not an object as having no address', () => {
    for (const body of [null, undefined, 'https://example.com', ['https://example.com'], 7]) {
      expect(Object.keys(errorsFor(body))).toEqual(['url']);
    }
  });
});

describe('validateAuditStartBody: crawl limits (REQ-002)', () => {
  it.each([1, 2, 999, 1000])('accepts max pages %d', (maxPages) => {
    const check = validateAuditStartBody({ ...VALID, maxPages });
    expect(check.ok && check.value.limits.maxPages).toBe(maxPages);
  });

  it.each([0, -1, 1001, 2.5, Number.NaN, Number.POSITIVE_INFINITY, '50', true])(
    'refuses max pages %j outside 1-1000',
    (maxPages) => {
      expect(errorsFor({ ...VALID, maxPages })).toEqual({
        maxPages: 'Max pages must be a whole number from 1 to 1000.',
      });
    }
  );

  it.each([0, 1, 8, 99, 100])('accepts max depth %d', (maxDepth) => {
    const check = validateAuditStartBody({ ...VALID, maxDepth });
    expect(check.ok && check.value.limits.maxDepth).toBe(maxDepth);
  });

  it.each([-1, -8, 101, 1.5, '3', Number.NaN])(
    'refuses max depth %j (negative, fractional or too deep)',
    (maxDepth) => {
      expect(errorsFor({ ...VALID, maxDepth })).toEqual({
        maxDepth: 'Max depth must be a whole number from 0 to 100.',
      });
    }
  );

  it('treats null limits as not given', () => {
    const check = validateAuditStartBody({ ...VALID, maxPages: null, maxDepth: null, includePaths: null });
    expect(check.ok && check.value.limits).toEqual({
      maxPages: AUDIT_LIMIT_DEFAULTS.pages,
      maxDepth: AUDIT_LIMIT_DEFAULTS.depth,
      includePaths: [],
      excludePaths: [],
    });
  });

  it('accepts path prefixes, trims them and drops repeats', () => {
    const check = validateAuditStartBody({
      ...VALID,
      includePaths: [' /blog ', '/blog', '/', '/docs/', '/a%20b', '/தமிழ்', "/x-y_z.~!$&'()+,;=:@"],
      excludePaths: ['/private', '/blog/drafts'],
    });
    expect(check.ok && check.value.limits.includePaths).toEqual([
      '/blog',
      '/',
      '/docs/',
      '/a%20b',
      '/தமிழ்',
      "/x-y_z.~!$&'()+,;=:@",
    ]);
    expect(check.ok && check.value.limits.excludePaths).toEqual(['/private', '/blog/drafts']);
  });

  it.each([
    ['', /path 1 is empty/],
    ['   ', /path 1 is empty/],
    [42, /path 1 is empty/],
    ['blog', /path 1 must start with \//],
    ['blog/2024', /path 1 must start with \//],
    ['https://example.com/blog', /not a full address/],
    ['//evil.example/blog', /not a full address/],
    ['/blog?page=2', /without \? or #/],
    ['/blog#top', /without \? or #/],
    ['/blog/*', /needs no \*/],
    ['/my blog', /spaces/],
    ['/a\tb', /spaces/],
    ['/a b', /spaces/],
    ['/a\u0000b', /spaces or invisible/],
    ['/a\\b', /must use \//],
    ['/a<b>', /character a path cannot contain/],
    ['/a"b', /character a path cannot contain/],
    ['/../admin', /\. or \.\./],
    ['/a/./b', /\. or \.\./],
    ['/%2e%2e/admin', /\. or \.\./],
    ['/100%', /valid escape/],
    ['/%zz', /valid escape/],
    ['/%E0%A4', /valid escape/],
    [`/${'a'.repeat(200)}`, /longer than 200/],
  ])('refuses the malformed path prefix %j, for include and exclude alike', (prefix, message) => {
    const include = errorsFor({ ...VALID, includePaths: [prefix] });
    expect(Object.keys(include)).toEqual(['includePaths']);
    expect(include.includePaths).toMatch(/^Include path 1 /);
    expect(include.includePaths).toMatch(message);

    const exclude = errorsFor({ ...VALID, excludePaths: ['/ok', prefix] });
    expect(Object.keys(exclude)).toEqual(['excludePaths']);
    expect(exclude.excludePaths).toMatch(/^Exclude path 2 /);
  });

  it('never repeats a refused path prefix back in the message', () => {
    const errors = errorsFor({ ...VALID, excludePaths: ['/<script>alert(1)</script>'] });
    expect(errors.excludePaths).not.toContain('<script>');
  });

  it('refuses path lists that are not lists, or too long', () => {
    expect(errorsFor({ ...VALID, includePaths: '/blog' }).includePaths).toMatch(/must be a list/);
    const tooMany = Array.from({ length: 51 }, (_, i) => `/p${i}`);
    expect(errorsFor({ ...VALID, excludePaths: tooMany }).excludePaths).toBe('Use at most 50 exclude paths.');
    expect(validateAuditStartBody({ ...VALID, excludePaths: tooMany.slice(0, 50) }).ok).toBe(true);
  });

  it('gives one message per wrong field when several are wrong', () => {
    const errors = errorsFor({
      url: 'ftp://example.com',
      maxPages: 0,
      maxDepth: -1,
      includePaths: ['blog'],
      excludePaths: ['/x?y'],
      language: 'fr',
    });
    expect(Object.keys(errors).sort()).toEqual(
      ['excludePaths', 'includePaths', 'language', 'maxDepth', 'maxPages', 'url'].sort()
    );
    for (const message of Object.values(errors)) expect(message).toMatch(/\.$/);
  });

  it('takes a document language for the AI notes, defaulting to English', () => {
    const check = validateAuditStartBody({ ...VALID, language: 'ta' });
    expect(check.ok && check.value.language).toBe('ta');
    expect(errorsFor({ ...VALID, language: 'TA' }).language).toMatch(/document languages/);
  });

  it('drops unknown fields from the checked request', () => {
    const check = validateAuditStartBody({ ...VALID, owner: true, apiKey: 'k' });
    expect(check.ok && Object.keys(check.value).sort()).toEqual(['language', 'limits', 'url']);
  });

  it('keeps the start body and the crawl limits in one shape', () => {
    const body = {
      url: 'https://example.com',
      maxPages: 50,
      maxDepth: 3,
      includePaths: ['/blog'],
      excludePaths: ['/blog/drafts'],
      language: 'en',
    } satisfies AuditStartBody;
    expectTypeOf(body).toMatchTypeOf<AuditStartBody>();
    expectTypeOf<AuditStartBody>().toMatchTypeOf<CrawlLimits>();
    expectTypeOf<keyof CrawlLimits>().toEqualTypeOf<'maxPages' | 'maxDepth' | 'includePaths' | 'excludePaths'>();
  });
});

describe('Skipped Page reasons and AI stages', () => {
  it('RouteSkipReason includes depth-limit, excluded and payment, and keeps the older reasons', () => {
    expect(ROUTE_SKIP_REASONS).toEqual(expect.arrayContaining(['depth-limit', 'excluded', 'payment']));
    expect(ROUTE_SKIP_REASONS).toEqual(
      expect.arrayContaining([
        'page-limit',
        'did-not-load',
        'robots',
        'sign-in',
        'http-error',
        'timeout',
        'off-site-redirect',
        'time-limit',
        'trap-limit',
        'session-lost',
        'duplicate',
      ])
    );
    expect(new Set(ROUTE_SKIP_REASONS).size).toBe(ROUTE_SKIP_REASONS.length);
    expectTypeOf<'depth-limit' | 'excluded' | 'payment'>().toMatchTypeOf<RouteSkipReason>();
  });

  it('AIStage includes assessment, documents, preview and rewrite, and keeps the older stages', () => {
    expect(AI_STAGES).toEqual(expect.arrayContaining(['assessment', 'documents', 'preview', 'rewrite']));
    expect(AI_STAGES).toEqual(
      expect.arrayContaining(['planning', 'repair', 'journeys', 'visual-review', 'interpret', 'other'])
    );
    expect(Object.keys(STAGE_MODEL_SLOT).sort()).toEqual([...AI_STAGES].sort());
    expectTypeOf<'assessment' | 'documents' | 'preview' | 'rewrite'>().toMatchTypeOf<AIStage>();
  });

  it('picks the model per stage, falling back to the stage slot default (REQ-039)', () => {
    const models: ModelsByStage = { assessment: 'model-a', rewrite: 'model-b', documents: '  ' };
    const defaults = { text: 'text-default', vision: 'vision-default' };
    expect(modelForStage('assessment', models, defaults)).toBe('model-a');
    expect(modelForStage('rewrite', models, defaults)).toBe('model-b');
    expect(modelForStage('documents', models, defaults)).toBe('text-default');
    expect(modelForStage('preview', undefined, defaults)).toBe('text-default');
    expect(modelForStage('visual-review', {}, defaults)).toBe('vision-default');
    expect(modelForStage('planning', {}, { text: null, vision: 'v' })).toBeNull();
  });
});

describe('Shortlist (REQ-023)', () => {
  it('Outcome is exactly the fixed list, in order', () => {
    expect([...SHORTLIST_OUTCOMES]).toEqual(['No reply', 'Interested', 'Meeting set', 'Won', 'Lost', 'Opted out']);
    expectTypeOf<ShortlistOutcome>().toEqualTypeOf<
      'No reply' | 'Interested' | 'Meeting set' | 'Won' | 'Lost' | 'Opted out'
    >();
    expect(isShortlistOutcome('Meeting set')).toBe(true);
    expect(isShortlistOutcome('won')).toBe(false);
    expect(isShortlistOutcome('Maybe')).toBe(false);
  });

  it('an entry carries the mark, notes, an outcome and a free-text note', () => {
    const entry = {
      auditId: 'audit-0001',
      mark: 'pitch',
      notes: 'Owner prefers phone calls.',
      outcome: 'Interested',
      outcomeNote: 'Call back after Pongal.',
      updatedAt: '2026-10-31T10:00:00.000Z',
    } satisfies ShortlistEntry;
    expectTypeOf(entry).toMatchTypeOf<ShortlistEntry>();
    expectTypeOf<ShortlistEntry['outcomeNote']>().toEqualTypeOf<string>();
    expectTypeOf<ShortlistEntry['outcome']>().toEqualTypeOf<ShortlistOutcome | null>();
  });
});

describe('fixed lists', () => {
  it('has the twelve document languages, Urdu right-to-left, English and Tamil reviewed', () => {
    expect([...DOCUMENT_LANGUAGES]).toEqual(['en', 'ta', 'hi', 'te', 'kn', 'ml', 'mr', 'gu', 'bn', 'or', 'pa', 'ur']);
    expect(Object.keys(DOCUMENT_LANGUAGE_INFO).sort()).toEqual([...DOCUMENT_LANGUAGES].sort());
    expect(DOCUMENT_LANGUAGE_INFO.ur.dir).toBe('rtl');
    expect(DOCUMENT_LANGUAGES.filter((l) => DOCUMENT_LANGUAGE_INFO[l].dir === 'rtl')).toEqual(['ur']);
    expect(DOCUMENT_LANGUAGES.filter((l) => !DOCUMENT_LANGUAGE_INFO[l].beta)).toEqual(['en', 'ta']);
    expect(isDocumentLanguage('ta')).toBe(true);
    expect(isDocumentLanguage('fr')).toBe(false);
  });

  it('has the five export formats and five Audit Documents', () => {
    expect([...EXPORT_FORMATS]).toEqual(['md', 'html', 'pdf', 'docx', 'bundle']);
    expect(Object.keys(EXPORT_CONTENT_TYPES).sort()).toEqual([...EXPORT_FORMATS].sort());
    expect(EXPORT_CONTENT_TYPES.bundle).toBe('application/zip');
    expect([...AUDIT_DOCUMENT_KINDS]).toEqual(['structure', 'content', 'findings', 'roadmap', 'proposal']);
    expect(isExportFormat('docx')).toBe(true);
    expect(isExportFormat('doc')).toBe(false);
    expect(isAuditDocumentKind('roadmap')).toBe(true);
    expect(isAuditDocumentKind('plan')).toBe(false);
  });

  it('has the six assessed areas and the ten marketing signals (REQ-015, REQ-016)', () => {
    expect([...AUDIT_AREAS]).toEqual(['search-ranking', 'marketing', 'usability', 'content', 'accessibility', 'speed']);
    expect(MARKETING_SIGNALS.map((s) => s.key)).toEqual([
      'on-page-seo',
      'schema',
      'internal-linking',
      'social-tags',
      'analytics',
      'ctas',
      'lead-forms',
      'click-to-call',
      'trust-signals',
      'local-signals',
    ]);
    for (const signal of MARKETING_SIGNALS) expect(signal.label.length).toBeGreaterThan(3);
  });

  it('recognises the 21 listed technologies, each once', () => {
    expect(TECHNOLOGIES).toHaveLength(21);
    expect(new Set(TECHNOLOGIES.map((t) => t.name)).size).toBe(21);
    const notIdentified: TechnologyResult = { status: 'not-identified' };
    expect(notIdentified.status).toBe('not-identified');
  });

  it('keeps Helper permissions to view, edit and export, and Shared Links to 30 days on /s/', () => {
    expect([...HELPER_PERMISSIONS]).toEqual(['view', 'edit', 'export']);
    expect(SHARE_LINK_DAYS).toBe(30);
    expect(SHARED_LINK_PREFIX).toBe('/s/');
  });

  it('error codes are unique and include ADR 0042 codes', () => {
    expect(new Set(AUDIT_ERROR_CODES).size).toBe(AUDIT_ERROR_CODES.length);
    expect(AUDIT_ERROR_CODES).toContain('ERR_SITE_BLOCKED');
    expect(AUDIT_ERROR_CODES).toContain('ERR_DNS');
    expect(AUDIT_ERROR_CODES).toContain('ERR_BROWSER_LAUNCH');
    expect(AUDIT_ERROR_CODES).toContain('ERR_PIPELINE');
  });

  it('AUDIT_LIMIT_DEFAULTS defines 50 pages, depth 5, and concurrency (ADR 0042, ADR 0043)', () => {
    expect(AUDIT_LIMIT_DEFAULTS).toEqual({
      pages: 50,
      depth: 5,
      hostedMaxPages: 200,
      fetchInFlight: 3,
      aiInFlight: 4,
    });
  });

  it('AuditStage includes writing-documents between ranking and saving', () => {
    const stage: AuditStage = 'writing-documents';
    expect(stage).toBe('writing-documents');
  });

  it('AuditAiStatus covers ready, key, quota, timeout, and provider error', () => {
    const statuses: AuditAiStatus[] = ['ready', 'no-key', 'key-expired', 'quota', 'timeout', 'provider-error'];
    expect(statuses).toHaveLength(6);
  });

  it('AuditProgressEvent shapes support progress, page, status, snapshot, done, and failed', () => {
    const pageEvent: AuditProgressEvent = {
      type: 'page',
      auditId: 'audit-12345678',
      version: 1,
      path: '/about',
      state: 'recorded',
      ai: 'done',
    };
    const statusEvent: AuditProgressEvent = {
      type: 'status',
      auditId: 'audit-12345678',
      version: 1,
      ai: 'ready',
      speed: 'this-tool',
    };
    const snapshotEvent: AuditProgressEvent = {
      type: 'snapshot',
      auditId: 'audit-12345678',
      version: 1,
      stage: 'writing-documents',
      counts: { pagesFound: 10, pagesRecorded: 8, pagesSkipped: 2 },
      pages: [{ path: '/', state: 'recorded' }],
      ai: 'ready',
      speed: 'this-tool',
    };
    expect(pageEvent.type).toBe('page');
    expect(statusEvent.type).toBe('status');
    expect(snapshotEvent.type).toBe('snapshot');
  });
});

describe('Page Content and results', () => {
  const parts = ['Welcome\n\n', 'வணக்கம் Chennai\n\n', 'Call us'];
  const at = (i: number) => parts.slice(0, i).join('').length;
  const content = {
    urlPath: '/',
    title: 'Example Stores',
    description: null,
    text: parts.join(''),
    headings: [{ level: 1, text: 'Welcome', sectionId: 's1' }],
    images: [
      { src: 'https://example.com/logo.png', alt: null, sectionId: 's1' },
      { src: 'https://example.com/line.png', alt: '' },
    ],
    links: [
      { text: 'Home', to: '/', region: 'menu', sectionId: 's1' },
      { text: 'Contact', to: '/contact', region: 'footer', sectionId: 's3' },
      { text: 'Shop', to: '/shop', region: 'breadcrumb' },
      { text: 'Read more', to: '/blog/1', region: 'internal' },
      { text: 'Facebook', to: 'https://facebook.com/x', region: 'footer', leavesSite: true },
    ],
    forms: [{ method: 'POST', fields: [{ type: 'email', label: 'Email', required: true }] }],
    ctas: [{ text: 'Call us', kind: 'link', to: 'tel:+914400000000', sectionId: 's3' }],
    language: { primary: 'ta', others: ['en'], declared: 'en' },
    sections: [
      { id: 's1', kind: 'header', heading: 'Welcome', start: at(0), end: at(1) },
      { id: 's2', kind: 'main', start: at(1), end: at(2) },
      { id: 's3', kind: 'footer', start: at(2), end: at(3) },
    ],
  } satisfies PageContent;

  it('Sections are contiguous, cover the whole text, and give each part to exactly one Section (REQ-008)', () => {
    expect(content.sections.map((s) => sectionText(content, s)).join('')).toBe(content.text);
    // Tamil text comes back character for character (REQ-044 AC-1).
    expect(sectionText(content, content.sections[1])).toBe('வணக்கம் Chennai\n\n');
    content.sections.forEach((s, i) => {
      expect(s.start).toBe(i === 0 ? 0 : content.sections[i - 1].end);
    });
    expect(content.sections[content.sections.length - 1].end).toBe(content.text.length);
  });

  it('records a missing alt as null, apart from an empty alt (REQ-009 AC-2)', () => {
    expect(content.images.map((i) => i.alt)).toEqual([null, '']);
    expectTypeOf<PageContent['images'][number]['alt']>().toEqualTypeOf<string | null>();
  });

  it('cites the page and Section on every finding, with impact and effort (REQ-017)', () => {
    const finding = {
      id: 'AF-001',
      rule: 'missing-alt',
      group: 'content',
      area: 'accessibility',
      title: 'An image has no alt text',
      detail: 'The logo on / has no alt attribute.',
      suggestion: 'Add alt text that says what the image shows.',
      impact: 'medium',
      effort: 'low',
      urlPath: '/',
      sectionId: 's1',
      target: 'https://example.com/logo.png',
      source: 'rule',
    } satisfies AuditFinding;
    expectTypeOf(finding).toMatchTypeOf<AuditFinding>();
    expectTypeOf<AuditFinding['sectionId']>().toEqualTypeOf<string | null>();
    expectTypeOf<AuditFinding['impact']>().toEqualTypeOf<'high' | 'medium' | 'low'>();
  });

  it('shows an area that did not run as not done, never with a note (REQ-016 AC-3)', () => {
    const notDone: AreaAssessment = { area: 'speed', grade: null, status: 'not-done', reason: 'no-ai-key' };
    expect(notDone.status).toBe('not-done');
    expect('note' in notDone).toBe(false);
    // @ts-expect-error: a not-done area cannot carry a note
    const _bad: AreaAssessment = { area: 'speed', grade: null, status: 'not-done', reason: 'ai-failed', note: 'Fine' };
    expect(_bad.status).toBe('not-done');
  });

  it('labels speed with its source and method, and a missed value carries no numbers (REQ-012)', () => {
    const missed: ExternalSpeed = {
      status: 'not-measured',
      source: 'pagespeed-insights',
      method: 'field',
      reason: 'quota',
    };
    expect('values' in missed).toBe(false);
    const _bad: ExternalSpeed = {
      status: 'not-measured',
      source: 'pagespeed-insights',
      method: 'lab',
      reason: 'failed',
      // @ts-expect-error: a not-measured value cannot carry values
      values: [],
    };
    expect(_bad.status).toBe('not-measured');
  });

  it('keeps edits in an overlay beside the original result (REQ-020)', () => {
    const edits = {
      findings: [{ findingId: 'AF-001', title: 'The logo needs alt text', editedAt: '2026-10-31T10:00:00.000Z' }],
      sections: [
        { urlPath: '/', sectionId: 's2', text: 'New copy', by: 'person', editedAt: '2026-10-31T10:00:00.000Z' },
      ],
      removedPages: ['/old'],
      recommendations: [{ urlPath: '/', action: 'redesign', editedAt: '2026-10-31T10:00:00.000Z' }],
      proposal: { price: '₹45,000 + GST' },
      updatedAt: '2026-10-31T10:00:00.000Z',
    } satisfies EditOverlay;
    expectTypeOf(edits).toMatchTypeOf<EditOverlay>();
  });

  it('adds the ten signals to the marketing review without breaking Check-up reports', () => {
    const checkup: MarketingReview = { readPages: ['/'], checks: [] };
    expect(checkup.signals).toBeUndefined();
  });
});

describe('AUDIT_API', () => {
  const endpoints = Object.entries(AUDIT_API);
  const has = (method: string, p: string) => endpoints.some(([, e]) => e.method === method && e.path === p);

  it('lists every audit endpoint the later tasks use', () => {
    const used: Array<[string, string]> = [
      // BE-027 core routes
      ['POST', '/api/audits'],
      ['GET', '/api/audits'],
      ['GET', '/api/audits/:id'],
      ['GET', '/api/audits/:id/stream'],
      ['DELETE', '/api/audits/:id'],
      ['POST', '/api/audits/:id/rerun'],
      ['POST', '/api/audits/:id/stop'],
      ['GET', '/api/audits/:id/edits'],
      ['PATCH', '/api/audits/:id/edits'],
      ['GET', '/api/audit-settings'],
      ['PUT', '/api/audit-settings'],
      // FE-002 page content and screenshots
      ['GET', '/api/audits/:id/content'],
      ['GET', '/api/audits/:id/file'],
      // BE-019 export
      ['GET', '/api/audits/:id/export'],
      // BE-020 pitch, BE-021 owner, BE-023 preview
      ['GET', '/api/audits/:id/pitch'],
      ['GET', '/api/audits/:id/owner'],
      ['POST', '/api/audits/:id/preview'],
      ['GET', '/api/audits/:id/preview'],
      // BE-022 Shared Links
      ['POST', '/api/audits/:id/share'],
      ['GET', '/api/audits/:id/share'],
      ['DELETE', '/api/audits/:id/share/:linkId'],
      ['GET', '/s/:linkId'],
      // BE-024 rewrite
      ['GET', '/api/audits/:id/rewrite'],
      ['POST', '/api/audits/:id/rewrite/approve'],
      ['POST', '/api/audits/:id/rewrite'],
      ['POST', '/api/audits/:id/rewrite/accept'],
      // BE-025 shortlist
      ['GET', '/api/audits/:id/shortlist'],
      ['PUT', '/api/audits/:id/shortlist'],
      ['GET', '/api/shortlist'],
      // BE-026 helpers
      ['GET', '/api/audits/:id/helpers'],
      ['PUT', '/api/audits/:id/helpers'],
      ['DELETE', '/api/audits/:id/helpers'],
      ['POST', '/api/helper/session'],
      ['GET', '/api/helper/session'],
      ['DELETE', '/api/helper/session'],
      ['GET', '/api/helper/status'],
    ];
    const missing = used.filter(([m, p]) => !has(m, p)).map(([m, p]) => `${m} ${p}`);
    expect(missing).toEqual([]);
    expect(endpoints).toHaveLength(used.length);
  });

  it('has one row per method and path, each under /api/ or the Shared Link prefix', () => {
    const keys = endpoints.map(([, e]) => `${e.method} ${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [, e] of endpoints)
      expect(e.path.startsWith('/api/') || e.path.startsWith(SHARED_LINK_PREFIX)).toBe(true);
  });

  it('opens only the Shared Link without the access key, and keeps Helpers off owner-only routes (REQ-033)', () => {
    expect(endpoints.filter(([, e]) => e.access === 'public').map(([name]) => name)).toEqual(['sharedPage']);
    const ownerOnly = endpoints.filter(([, e]) => e.access === 'owner').map(([name]) => name);
    for (const name of ['remove', 'getSettings', 'putSettings', 'listHelpers', 'grantHelper', 'removeHelper']) {
      expect(ownerOnly).toContain(name);
    }
    // Anything that spends the tool user's AI key is owner-only: Helpers never use the keys.
    for (const name of ['start', 'rerun', 'createPreview', 'runRewrite']) expect(ownerOnly).toContain(name);
  });

  it('types the request and reply of every route', () => {
    expectTypeOf<keyof AuditApi>().toEqualTypeOf<keyof typeof AUDIT_API>();
    expectTypeOf<AuditApi['start']['body']>().toEqualTypeOf<AuditStartBody>();
    expectTypeOf<AuditApi['get']['params']>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<AuditApi['revokeShare']['params']>().toEqualTypeOf<{ id: string; linkId: string }>();
    expectTypeOf<AuditApi['list']['params']>().toEqualTypeOf<Record<never, string>>();
    expectTypeOf<AuditApi['getShortlist']['reply']['entry']>().toEqualTypeOf<ShortlistEntry>();
  });

  it('fills in and matches path parameters, encoded', () => {
    expect(auditPath(AUDIT_API.get.path, { id: 'audit-0001' })).toBe('/api/audits/audit-0001');
    expect(auditPath(AUDIT_API.revokeShare.path, { id: 'audit-0001', linkId: 'abcdefghijklmnopqrstuv' })).toBe(
      '/api/audits/audit-0001/share/abcdefghijklmnopqrstuv'
    );
    expect(auditPath(AUDIT_API.list.path, {})).toBe('/api/audits');
    expect(auditPath('/api/x/:name', { name: 'a/b c' })).toBe('/api/x/a%2Fb%20c');
    expect(() => auditPath(AUDIT_API.get.path, { id: '' })).toThrow(/id/);

    expect(matchAuditPath(AUDIT_API.get.path, '/api/audits/audit-0001')).toEqual({ id: 'audit-0001' });
    expect(matchAuditPath(AUDIT_API.revokeShare.path, '/api/audits/audit-0001/share/abcdefghijklmnopqrstuv')).toEqual({
      id: 'audit-0001',
      linkId: 'abcdefghijklmnopqrstuv',
    });
    expect(matchAuditPath(AUDIT_API.list.path, '/api/audits')).toEqual({});
    expect(matchAuditPath(AUDIT_API.get.path, '/api/audits/audit-0001/')).toBeNull();
    expect(matchAuditPath(AUDIT_API.get.path, '/api/audits/audit-0001/edits')).toBeNull();
    expect(matchAuditPath(AUDIT_API.stream.path, '/api/audits/audit-0001/stream')).toEqual({ id: 'audit-0001' });
  });

  it('refuses ids that could name another folder or are not ids', () => {
    for (const id of [
      '..',
      '%2e%2e',
      '..%2F..%2Fetc',
      'a%2Fb%2Fcdefgh',
      'short',
      '%E0%A4',
      'audit 0001',
      'a'.repeat(65),
    ]) {
      expect(matchAuditPath(AUDIT_API.get.path, `/api/audits/${id}`)).toBeNull();
    }
    expect(matchAuditPath(AUDIT_API.sharedPage.path, '/s/too-short')).toBeNull();
    expect(AUDIT_ID_PATTERN.test('audit-0001')).toBe(true);
    // 128 bits of randomness need at least 22 base64url characters.
    expect(SHARE_LINK_ID_PATTERN.test('a'.repeat(21))).toBe(false);
    expect(SHARE_LINK_ID_PATTERN.test('a'.repeat(22))).toBe(true);
  });
});

describe('@qa/types stays browser-safe', () => {
  const BUILTIN =
    /^(node:|(assert|buffer|child_process|cluster|crypto|dgram|dns|events|fs|http|http2|https|net|os|path|perf_hooks|process|querystring|readline|stream|string_decoder|timers|tls|tty|url|util|v8|vm|worker_threads|zlib)(\/|$))/;

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      return statSync(full).isDirectory() ? sourceFiles(full) : entry.endsWith('.ts') ? [full] : [];
    });
  }

  it('no file in packages/types/src imports a Node built-in', () => {
    const files = sourceFiles(TYPES_SRC);
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      const specs = [...text.matchAll(/\b(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      return specs.filter((s) => BUILTIN.test(s)).map((s) => `${path.relative(TYPES_SRC, file)} imports ${s}`);
    });
    expect(offenders).toEqual([]);
  });

  it('the browser entry re-exports the audit contract', () => {
    const entry = readFileSync(path.join(TYPES_SRC, 'browser.ts'), 'utf8');
    expect(entry).toContain("export * from './website-audit.js';");
  });
});
