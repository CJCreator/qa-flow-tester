/**
 * QA-400: the Website Audit AI stages end to end, through the audit AI barrel, with a MockAIProvider that
 * records every request (no network, no clock). A small hand-built audit: two Layout Groups ('/' and
 * '/services/a' as Sample Pages, '/services/b' covered by '/services/a'), Sections s1..s3, findings with and
 * without impact/effort. Covers REQ-011 AC-2, REQ-016 AC-1..AC-3, REQ-017 AC-1..AC-2, REQ-039 AC-1, REQ-045 AC-1.
 */
import { describe, it, expect, vi } from 'vitest';
import type {
  AICompletionOptions,
  AIMessage,
  AIProviderType,
  AreaAssessment,
  AspectGrade,
  AuditArea,
  AuditFinding,
  AuditAiModels,
  PageContent,
  PageRecommendation,
} from '@qa/types';
import { AUDIT_AREAS } from '@qa/types';
import { MockAIProvider } from '../src/ai/ai-provider.js';
import type { ResolvedKeyInfo } from '../src/ai/key-resolver.js';
import {
  assessPages,
  assessSite,
  checkCitations,
  findClaimWords,
  hasClaimWords,
  rankFindingsWithIdMap,
  recommendationFor,
  recommendPages,
  resolveAuditAi,
  scoreFindings,
  writeRewrite,
  type AuditAiResolution,
  type RecommendationPageInput,
  type UnscoredAuditFinding,
} from '../src/audit/ai/index.js';

const TEST_KEY = 'test-key-not-real';
const LANGUAGE = 'en' as const;

// ---------------------------------------------------------------------------------------------------
// The hand-built audit

type Content = Pick<PageContent, 'urlPath' | 'title' | 'headings' | 'sections' | 'ctas'>;

const HOME: Content = {
  urlPath: '/',
  title: 'Sunrise Bakery',
  headings: [
    { level: 1, text: 'Fresh bread daily' },
    { level: 2, text: 'Our cakes' },
  ],
  sections: [
    { id: 's1', kind: 'header', start: 0, end: 20 },
    { id: 's2', kind: 'main', heading: 'Fresh bread daily', start: 20, end: 120 },
    { id: 's3', kind: 'footer', start: 120, end: 160 },
  ],
  ctas: [{ text: 'Order now', kind: 'link', to: '/order', sectionId: 's2' }],
};

const SERVICE_A: Content = {
  urlPath: '/services/a',
  title: 'Wedding cakes',
  headings: [{ level: 1, text: 'Wedding cakes' }],
  sections: [
    { id: 's1', kind: 'header', start: 0, end: 15 },
    { id: 's2', kind: 'main', heading: 'Wedding cakes', start: 15, end: 90 },
    { id: 's3', kind: 'footer', start: 90, end: 130 },
  ],
  ctas: [],
};

/** Covered by '/services/a' (same Layout Group): no recommendation of its own. */
const SERVICE_B: Content = { ...SERVICE_A, urlPath: '/services/b', title: 'Birthday cakes' };

function finding(
  id: string,
  rest: Omit<UnscoredAuditFinding, 'id' | 'title' | 'detail' | 'suggestion' | 'source'> &
    Partial<Pick<UnscoredAuditFinding, 'source'>>
): UnscoredAuditFinding {
  return {
    id,
    title: `Finding ${id}`,
    detail: `Seen on ${rest.urlPath}.`,
    suggestion: 'Fix it on the page.',
    source: 'rule',
    ...rest,
  };
}

/** Producer ids raw-1..raw-6, in no particular order. raw-4 and raw-5 have impact/effort set; the rest do not. */
const RAW: UnscoredAuditFinding[] = [
  finding('raw-1', { rule: 'missing-alt', group: 'content', area: 'accessibility', urlPath: '/', sectionId: 's2' }),
  finding('raw-2', { rule: 'missing-title', group: 'technical', area: 'search-ranking', urlPath: '/', sectionId: null }),
  finding('raw-3', { rule: 'ctas', group: 'marketing', area: 'marketing', urlPath: '/services/a', sectionId: 's1' }),
  finding('raw-4', {
    rule: 'unclear-offer',
    group: 'content',
    area: 'content',
    urlPath: '/services/a',
    sectionId: 's2',
    source: 'ai',
    advisory: true,
    impact: 'low',
    effort: 'high',
  }),
  finding('raw-5', {
    rule: 'broken-link',
    group: 'technical',
    area: 'usability',
    urlPath: '/services/a',
    sectionId: 's3',
    target: '/old-menu',
    impact: 'medium',
    effort: 'medium',
  }),
  finding('raw-6', {
    rule: 'color-contrast',
    group: 'technical',
    area: 'accessibility',
    urlPath: '/',
    sectionId: 's1',
    source: 'checker',
    severity: 'Major',
  }),
];

const HOME_GRADES: Partial<Record<AuditArea, AspectGrade | null>> = {
  'search-ranking': 'C',
  marketing: 'B',
  usability: 'B',
  content: 'B',
  accessibility: 'C',
};
/** Usability and content are the two lowest: the fixed rule picks redesign. */
const SERVICE_A_GRADES: Partial<Record<AuditArea, AspectGrade | null>> = {
  'search-ranking': 'B',
  marketing: 'B',
  usability: 'D',
  content: 'D',
  accessibility: 'A',
};
const SITE_GRADES: Partial<Record<AuditArea, AspectGrade | null>> = { ...HOME_GRADES, usability: 'C' };

// ---------------------------------------------------------------------------------------------------
// The recording MockAIProvider

interface Recorded {
  messages: AIMessage[];
  options: AICompletionOptions;
}

/** The JSON data block the prompts embed between "Data:\n" and "\n\nAnswer with ONLY". */
function dataOf(messages: AIMessage[]): Record<string, unknown> & { findings: Array<{ id: string }> } {
  const user = messages[1]!.content as string;
  const m = /Data:\n([\s\S]*?)\n\nAnswer with ONLY/.exec(user);
  if (!m) throw new Error('mock: no data block in the prompt');
  return JSON.parse(m[1]!);
}

class RecordingMock extends MockAIProvider {
  readonly requests: Recorded[] = [];

  override async generateText(messages: AIMessage[], options?: AICompletionOptions): Promise<string> {
    this.requests.push({ messages, options: options ?? {} });
    if (options?.stage === 'rewrite') return 'Every morning our small kitchen bakes loaves you can order ahead.';

    const data = dataOf(messages);
    const ids = data.findings.map((f) => f.id);
    const isRepair = messages.length > 2;
    const system = messages[0]!.content as string;

    if (system.startsWith('You advise website owners')) {
      // Redesign or repair. '/services/a' first answers with a claim word, so it gets one repair request.
      const path = data.urlPath as string;
      if (path === '/services/a' && !isRepair) {
        return JSON.stringify({ action: 'repair', reason: 'The page is safe to keep as it is.', findingIds: ids });
      }
      return JSON.stringify({
        action: path === '/services/a' ? 'redesign' : 'repair',
        reason: `${ids.length} issues were found on the checked parts of ${path}.`,
        findingIds: [...ids, 'AF-999'],
        grade: 'A',
      });
    }

    // Assessment of the six areas. The home page's first answer makes a claim in one note.
    const claimOnHome = data.scope === 'page' && data.urlPath === '/' && !isRepair;
    return JSON.stringify({
      areas: AUDIT_AREAS.map((area) => ({
        area,
        note:
          claimOnHome && area === 'accessibility'
            ? 'This page is fully accessible.'
            : `Checked ${area} on ${String(data.scope)} ${String(data.urlPath ?? data.url)}: ${ids.length} findings.`,
        evidence: [...ids.slice(0, 2), 'AF-999'],
        grade: 'A',
        score: 100,
      })),
    });
  }
}

function keys(found: ResolvedKeyInfo | null) {
  return { resolveKey: vi.fn(async (_preferred?: AIProviderType) => found) };
}

async function resolve(withKey: boolean, models?: AuditAiModels) {
  const mock = new RecordingMock();
  const createProvider = vi.fn((_type: AIProviderType, _key: string) => mock);
  const resolution: AuditAiResolution = await resolveAuditAi({
    setup: { provider: 'openrouter', text: 'default/text', vision: 'default/vision' },
    keys: keys(withKey ? { provider: 'openrouter', apiKey: TEST_KEY, source: 'keychain' } : null),
    models,
    createProvider,
  });
  return { mock, createProvider, resolution };
}

// ---------------------------------------------------------------------------------------------------
// The flow

function rank() {
  const { findings, idMap } = rankFindingsWithIdMap(RAW);
  return { ranked: findings, idMap };
}

function pageInputs(ranked: AuditFinding[]) {
  const of = (path: string) => ranked.filter((f) => f.urlPath === path);
  return [
    { urlPath: '/', content: HOME, findings: of('/'), grades: HOME_GRADES },
    { urlPath: '/services/a', content: SERVICE_A, findings: of('/services/a'), grades: SERVICE_A_GRADES },
  ];
}

function recommendationInputs(ranked: AuditFinding[]): RecommendationPageInput[] {
  const [home, a] = pageInputs(ranked);
  return [
    { urlPath: '/', title: HOME.title, coverage: 'sample', findings: home!.findings, grades: HOME_GRADES },
    { urlPath: '/services/a', title: SERVICE_A.title, coverage: 'sample', findings: a!.findings, grades: SERVICE_A_GRADES },
    {
      urlPath: '/services/b',
      title: SERVICE_B.title,
      coverage: 'covered',
      sampleUrlPath: '/services/a',
      findings: [],
      grades: SERVICE_A_GRADES,
    },
    // The same Sample Page listed twice still gets exactly one recommendation.
    { urlPath: '/', title: HOME.title, coverage: 'sample', findings: home!.findings, grades: HOME_GRADES },
  ];
}

async function runFlow(resolution: AuditAiResolution) {
  const { ranked, idMap } = rank();
  const pages = await assessPages({ language: LANGUAGE, pages: pageInputs(ranked) }, resolution);
  const site = await assessSite(
    {
      language: LANGUAGE,
      url: 'https://bakery.test',
      pages: [
        { urlPath: '/', title: HOME.title },
        { urlPath: '/services/a', title: SERVICE_A.title },
      ],
      findings: ranked,
      grades: SITE_GRADES,
    },
    resolution
  );
  const recommendations = await recommendPages(
    { language: LANGUAGE, pages: recommendationInputs(ranked) },
    resolution
  );
  return { ranked, idMap, pages, site, recommendations };
}

function expectSixAreas(areas: AreaAssessment[], grades: Partial<Record<AuditArea, AspectGrade | null>>) {
  expect(areas.map((a) => a.area)).toEqual([...AUDIT_AREAS]);
  // The grade is always the deterministic one: the AI's "grade"/"score" fields are ignored.
  for (const a of areas) expect(a.grade).toBe(grades[a.area] ?? null);
}

describe('Website Audit AI flow (QA-400)', () => {
  it('REQ-017 AC-1: unset impact/effort is scored, set values are kept, and ranking is impact then lower effort', () => {
    const scored = scoreFindings(RAW);
    const by = (id: string) => scored.find((f) => f.id === id)!;
    expect([by('raw-1').impact, by('raw-1').effort]).toEqual(['medium', 'low']); // missing-alt rule
    expect([by('raw-2').impact, by('raw-2').effort]).toEqual(['high', 'low']); // missing-title rule
    expect([by('raw-3').impact, by('raw-3').effort]).toEqual(['high', 'medium']); // ctas signal
    expect([by('raw-4').impact, by('raw-4').effort]).toEqual(['low', 'high']); // set by producer
    expect([by('raw-5').impact, by('raw-5').effort]).toEqual(['medium', 'medium']); // set, rule default ignored
    expect([by('raw-6').impact, by('raw-6').effort]).toEqual(['high', 'medium']); // by severity Major
    expect(RAW.find((f) => f.id === 'raw-1')!.impact).toBeUndefined(); // input not changed

    const { ranked, idMap } = rank();
    expect(ranked.map((f) => f.id)).toEqual(['AF-001', 'AF-002', 'AF-003', 'AF-004', 'AF-005', 'AF-006']);
    expect([...idMap.entries()]).toEqual([
      ['raw-2', 'AF-001'], // high / low
      ['raw-6', 'AF-002'], // high / medium, '/'
      ['raw-3', 'AF-003'], // high / medium, '/services/a'
      ['raw-1', 'AF-004'], // medium / low
      ['raw-5', 'AF-005'], // medium / medium
      ['raw-4', 'AF-006'], // low / high
    ]);
    expect(ranked.map((f) => `${f.impact}/${f.effort}`)).toEqual([
      'high/low',
      'high/medium',
      'high/medium',
      'medium/low',
      'medium/medium',
      'low/high',
    ]);
    // Same input, same output.
    expect(rank().ranked).toEqual(ranked);
  });

  it('REQ-017 AC-2: every ranked finding cites an audited page and one of its Sections (or the whole page)', () => {
    const { ranked } = rank();
    const audited = [HOME, SERVICE_A, SERVICE_B];
    expect(checkCitations(ranked, audited)).toEqual([]);

    const bad: AuditFinding[] = [
      { ...ranked[0]!, id: 'AF-101', urlPath: '/not-audited' },
      { ...ranked[1]!, id: 'AF-102', sectionId: 's9' },
      { ...ranked[2]!, id: 'AF-103', sectionId: null },
    ];
    expect(checkCitations(bad, audited).map((p) => [p.findingId, p.kind])).toEqual([
      ['AF-101', 'unknown-page'],
      ['AF-102', 'unknown-section'],
      ['AF-103', 'missing-section'],
    ]);
  });

  it('REQ-016, REQ-045, REQ-039 AC-1: with a key, six areas per Sample Page and site-wide, one recommendation per Sample Page, model A for assessment', async () => {
    const { mock, createProvider, resolution } = await resolve(true, { assessment: 'model/A', rewrite: 'model/B' });
    expect(resolution.ok).toBe(true);
    expect(createProvider).toHaveBeenCalledWith('openrouter', TEST_KEY);

    const { ranked, pages, site, recommendations } = await runFlow(resolution);
    const idsOf = (path: string) => new Set(ranked.filter((f) => f.urlPath === path).map((f) => f.id));
    const allIds = new Set(ranked.map((f) => f.id));

    // REQ-016 AC-1: six areas for every Sample Page, in order, each with a note citing only that page's findings.
    expect(pages.map((p) => p.urlPath)).toEqual(['/', '/services/a']);
    for (const page of pages) {
      expectSixAreas(page.areas, page.urlPath === '/' ? HOME_GRADES : SERVICE_A_GRADES);
      for (const area of page.areas) {
        expect(area.status).toBe('done');
        if (area.status !== 'done') continue;
        expect(area.note.length).toBeGreaterThan(0);
        expect(area.evidence.length).toBeGreaterThan(0);
        for (const id of area.evidence) expect(idsOf(page.urlPath).has(id)).toBe(true);
        expect(area.evidence).not.toContain('AF-999');
      }
    }
    // REQ-016 AC-2: the note with a claim word got one repair request and was replaced.
    const homeAccessibility = pages[0]!.areas.find((a) => a.area === 'accessibility')!;
    expect(homeAccessibility).toMatchObject({ status: 'done' });
    if (homeAccessibility.status === 'done') expect(homeAccessibility.note).not.toMatch(/fully accessible/i);

    // Site-wide: six areas, evidence only from the audit's findings.
    expectSixAreas(site, SITE_GRADES);
    for (const area of site) {
      expect(area.status).toBe('done');
      if (area.status === 'done') for (const id of area.evidence) expect(allIds.has(id)).toBe(true);
    }

    // REQ-045 AC-1: exactly one recommendation per Sample Page, none for the covered page, ids of that page only.
    expect(recommendations.map((r) => r.urlPath)).toEqual(['/', '/services/a']);
    for (const r of recommendations) {
      expect(r.decidedBy).toBe('ai');
      expect(['redesign', 'repair']).toContain(r.action);
      expect(r.findingIds.length).toBeGreaterThan(0);
      for (const id of r.findingIds) expect(idsOf(r.urlPath).has(id)).toBe(true);
    }
    // The claim-word reason for '/services/a' was repaired, not shown.
    expect(recommendations[1]).toMatchObject({ action: 'redesign', decidedBy: 'ai' });
    expect(recommendations[1]!.reason).not.toMatch(/\bsafe\b/i);
    // A covered page refers to its Layout Group's Sample Page.
    expect(
      recommendationFor({ urlPath: '/services/b', coverage: 'covered', sampleUrlPath: '/services/a' }, recommendations)
    ).toBe(recommendations[1]);

    // No ADR 0018 word anywhere in the output.
    const output = JSON.stringify({ ranked, pages, site, recommendations });
    expect(findClaimWords(output)).toEqual([]);
    expect(hasClaimWords(output)).toBe(false);

    // REQ-039 AC-1: every request so far is the 'assessment' stage with model A.
    // assessPages: '/' 1 + 1 repair, '/services/a' 1; assessSite 1; recommendPages: '/' 1, '/services/a' 1 + 1 repair.
    expect(mock.requests).toHaveLength(7);
    for (const r of mock.requests) expect([r.options.stage, r.options.model]).toEqual(['assessment', 'model/A']);
    // Untrusted page data stays data: the prompts never carry the key.
    for (const r of mock.requests) expect(JSON.stringify(r.messages)).not.toContain(TEST_KEY);

    // REQ-039 AC-1: the rewrite stage uses model B.
    const resolved = resolution.ok ? resolution.ai : undefined;
    if (!resolved) throw new Error('expected AI');
    const rewrite = await writeRewrite(resolved, {
      sectionText: 'Fresh bread daily from the Sunrise Bakery oven, baked before dawn.',
      language: LANGUAGE,
    });
    expect(rewrite).toMatchObject({ ok: true });
    expect(mock.requests).toHaveLength(8);
    expect([mock.requests[7]!.options.stage, mock.requests[7]!.options.model]).toEqual(['rewrite', 'model/B']);
    if (rewrite.ok) expect(hasClaimWords(rewrite.text)).toBe(false);
  });

  it('REQ-039 AC-1: without per-stage models, assessment uses the vision default and rewrite the text default', async () => {
    const { mock, resolution } = await resolve(true);
    if (!resolution.ok) throw new Error('expected AI');
    await assessSite(
      { language: LANGUAGE, url: 'https://bakery.test', pages: [], findings: rank().ranked, grades: SITE_GRADES },
      resolution
    );
    await writeRewrite(resolution.ai, { sectionText: 'Wedding cakes made to order.', language: LANGUAGE });
    expect(mock.requests.map((r) => [r.options.stage, r.options.model])).toEqual([
      ['assessment', 'default/vision'],
      ['rewrite', 'default/text'],
    ]);
  });

  it('REQ-011 AC-2, REQ-016 AC-3: with no key, no AI request is made and every output is not-done or rule-based', async () => {
    const { mock, createProvider, resolution } = await resolve(false, { assessment: 'model/A', rewrite: 'model/B' });
    expect(resolution).toEqual({ ok: false, reason: 'no-ai-key' });
    expect(createProvider).not.toHaveBeenCalled();

    const { pages, site, recommendations, ranked } = await runFlow(resolution);
    expect(mock.requests).toHaveLength(0);

    expect(pages.map((p) => p.urlPath)).toEqual(['/', '/services/a']);
    for (const page of pages) {
      expectSixAreas(page.areas, page.urlPath === '/' ? HOME_GRADES : SERVICE_A_GRADES);
      for (const a of page.areas) expect(a).toMatchObject({ status: 'not-done', reason: 'no-ai-key' });
    }
    expectSixAreas(site, SITE_GRADES);
    for (const a of site) expect(a).toMatchObject({ status: 'not-done', reason: 'no-ai-key' });

    // REQ-045 AC-1 still holds on the rule: one per Sample Page, marked rule-based.
    expect(recommendations.map((r) => r.urlPath)).toEqual(['/', '/services/a']);
    for (const r of recommendations) expect(r.decidedBy).toBe('rule');
    const byPath = new Map<string, PageRecommendation>(recommendations.map((r) => [r.urlPath, r]));
    expect(byPath.get('/')!.action).toBe('repair');
    expect(byPath.get('/services/a')!.action).toBe('redesign'); // usability and content are the lowest grades
    for (const r of recommendations) {
      const own = new Set(ranked.filter((f) => f.urlPath === r.urlPath).map((f) => f.id));
      for (const id of r.findingIds) expect(own.has(id)).toBe(true);
    }

    expect(hasClaimWords(JSON.stringify({ pages, site, recommendations }))).toBe(false);
  });
});
