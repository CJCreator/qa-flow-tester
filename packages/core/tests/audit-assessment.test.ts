import { describe, it, expect, vi } from 'vitest';
import type { AIMessage, AIProviderType, AreaAssessment, AuditArea, AuditFinding } from '@qa/types';
import { AUDIT_AREAS } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { MockAIProvider } from '../src/ai/providers/mock.js';
import { AITimeoutError } from '../src/ai/timeout.js';
import { auditAiRequestBudget, resolveAuditAi, type AuditAiRequestBudget } from '../src/audit/ai/stage-ai.js';
import { findClaimWords } from '../src/audit/ai/claim-words.js';
import {
  assessPages,
  assessSite,
  type AreaGrades,
  type AssessmentPageInput,
  type AssessPagesInput,
  type AssessSiteInput,
} from '../src/audit/ai/assessment.js';

const TEST_KEY = 'test-key-not-real';

function finding(id: string, urlPath: string, area: AuditArea): AuditFinding {
  return {
    id,
    rule: 'missing-alt',
    group: 'technical',
    area,
    title: `Finding ${id}`,
    detail: 'An image has no alt text.',
    suggestion: 'Add alt text.',
    impact: 'high',
    effort: 'low',
    urlPath,
    sectionId: 's1',
    source: 'rule',
  };
}

const GRADES: AreaGrades = {
  'search-ranking': 'B',
  marketing: 'C',
  usability: 'A',
  content: 'D',
  accessibility: 'F',
  // speed: nothing checked
};

function page(urlPath: string, ids: string[]): AssessmentPageInput {
  return {
    urlPath,
    content: {
      title: `Title of ${urlPath}`,
      headings: [{ level: 1, text: `Heading of ${urlPath}`, sectionId: 's1' }],
      sections: [{ id: 's1', kind: 'main', heading: `Heading of ${urlPath}`, start: 0, end: 10 }],
      ctas: [{ text: 'Book a call', kind: 'button', sectionId: 's1' }],
    },
    findings: ids.map((id) => finding(id, urlPath, 'accessibility')),
    grades: GRADES,
    speed: {
      lab: {
        status: 'measured',
        source: 'pagespeed-insights',
        method: 'lab',
        strategy: 'mobile',
        values: [{ metric: 'lcp', value: 2400, unit: 'ms' }],
        measuredAt: '2026-11-01T00:00:00.000Z',
      },
      field: { status: 'not-measured', source: 'pagespeed-insights', method: 'field', reason: 'no-field-data' },
    },
  };
}

/** An answer for all six areas; `overrides` replaces the note of some areas. */
function answer(evidence: string[], overrides: Partial<Record<AuditArea, string>> = {}, extra: object = {}): string {
  return JSON.stringify({
    areas: AUDIT_AREAS.map((area) => ({
      area,
      note: overrides[area] ?? `Note about ${area}.`,
      evidence,
      ...extra,
    })),
  });
}

/** A provider answering from a script, one entry per request; records every request. */
function scripted(script: Array<string | Error>) {
  const requests: AIMessage[][] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const provider: AIProvider = {
    providerType: 'mock',
    async generateText(messages) {
      requests.push(messages);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      const next = script.shift();
      if (next === undefined) throw new Error('script ran out');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { provider, requests, maxInFlight: () => maxInFlight };
}

async function aiWith(provider: AIProvider, budget?: AuditAiRequestBudget) {
  const createProvider = vi.fn((_type: AIProviderType, _key: string) => provider);
  const resolution = await resolveAuditAi({
    setup: { provider: 'mock' },
    keys: { resolveKey: async () => ({ provider: 'mock', apiKey: TEST_KEY, source: 'env' }) },
    createProvider,
    budget,
  });
  return { resolution, createProvider };
}

function pagesInput(pages: AssessmentPageInput[], extra: Partial<AssessPagesInput> = {}): AssessPagesInput {
  return { language: 'en', pages, ...extra };
}

function siteInput(findings: AuditFinding[], extra: Partial<AssessSiteInput> = {}): AssessSiteInput {
  return {
    language: 'en',
    url: 'https://example.test/',
    pages: [
      { urlPath: '/pricing', title: 'Pricing' },
      { urlPath: '/about', title: 'About' },
    ],
    findings,
    grades: GRADES,
    ...extra,
  };
}

function expectGradesFromInput(areas: AreaAssessment[]) {
  expect(areas.map((a) => a.area)).toEqual([...AUDIT_AREAS]);
  for (const a of areas) expect(a.grade).toBe(GRADES[a.area] ?? null);
}

describe('assessPages and assessSite', () => {
  it('REQ-016 AC-1: every Sample Page and the whole site get all six areas (MockAIProvider)', async () => {
    const mock = new MockAIProvider();
    // The site prompt lists the Sample Pages too, so its key must be matched first.
    mock.setMockResponse('"scope":"site"', answer(['AF-001', 'AF-003', 'AF-999']));
    mock.setMockResponse('"urlPath":"/pricing"', answer(['AF-001', 'AF-003', 'AF-999']));
    mock.setMockResponse('"urlPath":"/about"', answer(['AF-003', 'AF-001']));
    const { resolution } = await aiWith(mock);

    const pricing = page('/pricing', ['AF-001', 'AF-002']);
    const about = page('/about', ['AF-003']);
    const pages = await assessPages(pagesInput([pricing, about]), resolution);
    const site = await assessSite(siteInput([...pricing.findings, ...about.findings]), resolution);

    expect(pages.map((p) => p.urlPath)).toEqual(['/pricing', '/about']);
    for (const p of pages) {
      expectGradesFromInput(p.areas);
      for (const a of p.areas) expect(a).toMatchObject({ status: 'done', note: `Note about ${a.area}.` });
    }
    expectGradesFromInput(site);
    for (const a of site) expect(a.status).toBe('done');

    // Evidence: only findings of that page (site-wide: of the audit).
    const evidenceOf = (areas: AreaAssessment[]) => areas.map((a) => (a.status === 'done' ? a.evidence : null));
    expect(new Set(evidenceOf(pages[0].areas).map((e) => JSON.stringify(e)))).toEqual(new Set(['["AF-001"]']));
    expect(new Set(evidenceOf(pages[1].areas).map((e) => JSON.stringify(e)))).toEqual(new Set(['["AF-003"]']));
    expect(new Set(evidenceOf(site).map((e) => JSON.stringify(e)))).toEqual(new Set(['["AF-001","AF-003"]']));
  });

  it('sends the page summary, its findings, its grades and its PageSpeed values on the assessment stage', async () => {
    const fake = scripted([answer([])]);
    const calls: Array<string | undefined> = [];
    const original = fake.provider.generateText.bind(fake.provider);
    fake.provider.generateText = async (messages, options) => {
      calls.push(options?.stage);
      return original(messages, options);
    };
    const { resolution } = await aiWith(fake.provider);
    await assessPages(pagesInput([page('/pricing', ['AF-001'])]), resolution);

    expect(calls).toEqual(['assessment']);
    const prompt = fake.requests[0].map((m) => m.content).join('\n');
    expect(prompt).toContain('Title of /pricing');
    expect(prompt).toContain('Heading of /pricing');
    expect(prompt).toContain('"sections":[{"id":"s1"');
    expect(prompt).toContain('Book a call');
    expect(prompt).toContain('"id":"AF-001"');
    expect(prompt).toContain('"accessibility":"F"');
    expect(prompt).toContain('"speed":"not checked"');
    expect(prompt).toContain('"metric":"lcp","value":2400');
    expect(prompt).toContain('"notMeasured":"no-field-data"');
  });

  it("writes notes in the audit's document language", async () => {
    const fake = scripted([answer([]), answer([])]);
    const { resolution } = await aiWith(fake.provider);
    await assessPages(pagesInput([page('/pricing', [])], { language: 'ta' }), resolution);
    await assessSite(siteInput([], { language: 'hi' }), resolution);
    expect(fake.requests[0].map((m) => m.content).join('\n')).toContain('Tamil (ta)');
    expect(fake.requests[1].map((m) => m.content).join('\n')).toContain('Hindi (hi)');
  });

  it('grades come from the input: the AI cannot change them and no AI score appears', async () => {
    const fake = scripted([answer([], {}, { grade: 'A', score: 97 })]);
    const { resolution } = await aiWith(fake.provider);
    const [result] = await assessPages(pagesInput([page('/pricing', [])]), resolution);
    expectGradesFromInput(result.areas);
    expect(result.areas.find((a) => a.area === 'speed')!.grade).toBeNull();
    for (const a of result.areas) {
      expect(Object.keys(a).sort()).toEqual(['area', 'evidence', 'grade', 'note', 'status']);
    }
    expect(JSON.stringify(result)).not.toContain('97');
  });

  describe('REQ-016 AC-2: claim words', () => {
    it('a claim-word note gets one repair request and the clean rewrite is kept', async () => {
      const fake = scripted([
        answer([], { accessibility: 'The page is fully accessible.', speed: 'The site is secure and fast.' }),
        JSON.stringify({
          areas: [
            { area: 'accessibility', note: 'Automatic checks found two images without alt text.', evidence: [] },
            { area: 'speed', note: 'Largest content shows after 2.4 seconds.', evidence: [] },
          ],
        }),
      ]);
      const { resolution } = await aiWith(fake.provider);
      const [result] = await assessPages(pagesInput([page('/pricing', [])]), resolution);

      expect(fake.requests).toHaveLength(2);
      const repair = fake.requests[1].at(-1)!.content;
      expect(repair).toContain('accessibility, speed');
      expect(result.areas.find((a) => a.area === 'accessibility')).toMatchObject({
        status: 'done',
        note: 'Automatic checks found two images without alt text.',
      });
      expect(result.areas.find((a) => a.area === 'marketing')).toMatchObject({ status: 'done' });
      expect(findClaimWords(JSON.stringify(result))).toEqual([]);
    });

    it('a note still making a claim after the repair is not-done ai-failed (MockAIProvider repeats itself)', async () => {
      const mock = new MockAIProvider();
      mock.setMockResponse(
        'Data:',
        answer([], { 'search-ranking': 'This site is compliant and certified.', accessibility: 'It passes WCAG.' })
      );
      const spy = vi.spyOn(mock, 'generateText');
      const { resolution } = await aiWith(mock);

      const [result] = await assessPages(pagesInput([page('/pricing', [])]), resolution);
      const site = await assessSite(siteInput([]), resolution);

      expect(spy).toHaveBeenCalledTimes(4); // one answer and one repair each
      for (const areas of [result.areas, site]) {
        expect(areas.find((a) => a.area === 'search-ranking')).toMatchObject({
          status: 'not-done',
          reason: 'ai-failed',
        });
        expect(areas.find((a) => a.area === 'accessibility')).toMatchObject({
          status: 'not-done',
          reason: 'ai-failed',
        });
        expect(areas.find((a) => a.area === 'content')).toMatchObject({ status: 'done' });
        expectGradesFromInput(areas);
      }
      expect(findClaimWords(JSON.stringify([result, site]))).toEqual([]);
    });
  });

  describe('REQ-016 AC-3: the AI step did not run or failed', () => {
    it('no key: every area of every page and of the site is not-done no-ai-key, nothing created', async () => {
      const createProvider = vi.fn();
      const resolution = await resolveAuditAi({
        setup: { provider: 'mock' },
        keys: { resolveKey: async () => null },
        createProvider,
      });
      const pages = await assessPages(pagesInput([page('/pricing', ['AF-001']), page('/about', [])]), resolution);
      const site = await assessSite(siteInput([]), resolution);

      expect(createProvider).not.toHaveBeenCalled();
      for (const areas of [...pages.map((p) => p.areas), site]) {
        expectGradesFromInput(areas);
        for (const a of areas)
          expect(a).toEqual({ area: a.area, grade: a.grade, status: 'not-done', reason: 'no-ai-key' });
      }
    });

    it('provider error or timeout: that page is ai-failed, the next page is still assessed', async () => {
      const fake = scripted([
        new Error('upstream 500'),
        new AITimeoutError('The AI did not answer in time.', 1000),
        answer([]),
      ]);
      const { resolution } = await aiWith(fake.provider);
      const results = await assessPages(pagesInput([page('/a', []), page('/b', []), page('/c', [])]), resolution);
      for (const areas of [results[0].areas, results[1].areas]) {
        for (const a of areas) expect(a).toMatchObject({ status: 'not-done', reason: 'ai-failed' });
        expect(JSON.stringify(areas)).not.toContain('upstream');
      }
      for (const a of results[2].areas) expect(a.status).toBe('done');
      expect(fake.requests).toHaveLength(3);
    });

    it('an unparsable answer gets one repair; still unparsable is ai-failed', async () => {
      const fake = scripted(['not json at all', answer([]), 'still not json', '{"nope":1}']);
      const { resolution } = await aiWith(fake.provider);
      const [fixed, broken] = await assessPages(pagesInput([page('/a', []), page('/b', [])]), resolution);

      for (const a of fixed.areas) expect(a.status).toBe('done');
      for (const a of broken.areas) expect(a).toMatchObject({ status: 'not-done', reason: 'ai-failed' });
      expect(fake.requests).toHaveLength(4);
    });

    it('a missing area gets one repair; still missing is ai-failed', async () => {
      const withoutSpeed = JSON.stringify({
        areas: AUDIT_AREAS.filter((a) => a !== 'speed').map((area) => ({ area, note: 'n', evidence: [] })),
      });
      const fake = scripted([withoutSpeed, JSON.stringify({ areas: [] })]);
      const { resolution } = await aiWith(fake.provider);
      const [result] = await assessPages(pagesInput([page('/a', [])]), resolution);
      expect(result.areas.find((a) => a.area === 'speed')).toMatchObject({ status: 'not-done', reason: 'ai-failed' });
      expect(result.areas.filter((a) => a.status === 'done')).toHaveLength(5);
    });

    it('budget spent: pages past the budget are not-done budget-spent, with no request', async () => {
      const fake = scripted([answer([]), answer([])]);
      const { resolution } = await aiWith(fake.provider, auditAiRequestBudget(1));
      const results = await assessPages(pagesInput([page('/a', []), page('/b', [])]), resolution);
      const site = await assessSite(siteInput([]), resolution);

      for (const a of results[0].areas) expect(a.status).toBe('done');
      for (const areas of [results[1].areas, site]) {
        expectGradesFromInput(areas);
        for (const a of areas) expect(a).toMatchObject({ status: 'not-done', reason: 'budget-spent' });
      }
      expect(fake.requests).toHaveLength(1);
    });
  });

  it('assesses pages one request at a time', async () => {
    const fake = scripted([answer([]), answer([]), answer([])]);
    const { resolution } = await aiWith(fake.provider);
    await assessPages(pagesInput([page('/a', []), page('/b', []), page('/c', [])]), resolution);
    expect(fake.requests).toHaveLength(3);
    expect(fake.maxInFlight()).toBe(1);
  });

  it('a caller stop is passed on, not reported as a failed note', async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = scripted([answer([])]);
    const { resolution } = await aiWith(fake.provider);
    await expect(
      assessPages(pagesInput([page('/a', [])], { signal: controller.signal }), resolution)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fake.requests).toHaveLength(0);
  });
});
