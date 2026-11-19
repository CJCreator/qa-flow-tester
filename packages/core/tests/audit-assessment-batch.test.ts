/** T-406: small pages share one AI assessment request; a wrong citation is asked again alone. */
import { describe, it, expect, vi } from 'vitest';
import type { AIMessage, AIProviderType, AuditArea, AuditFinding } from '@qa/types';
import { AUDIT_AREAS } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { resolveAuditAi } from '../src/audit/ai/stage-ai.js';
import {
  assessPages,
  auditAiInFlight,
  batchPages,
  type AreaGrades,
  type AssessmentPageInput,
} from '../src/audit/ai/assessment.js';

const GRADES: AreaGrades = { 'search-ranking': 'B', marketing: 'C', usability: 'A', content: 'D', accessibility: 'F' };

function finding(id: string, urlPath: string): AuditFinding {
  return {
    id,
    rule: 'missing-alt',
    group: 'technical',
    area: 'accessibility' as AuditArea,
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

function page(urlPath: string, id: string, wordCount = 300): AssessmentPageInput {
  return {
    urlPath,
    content: {
      title: `Title of ${urlPath}`,
      headings: [{ level: 1, text: `Heading of ${urlPath}`, sectionId: 's1' }],
      sections: [{ id: 's1', kind: 'main', heading: `Heading of ${urlPath}`, start: 0, end: 10 }],
      ctas: [],
    },
    findings: [finding(id, urlPath)],
    grades: GRADES,
    wordCount,
  };
}

const areas = (evidence: string[]) => AUDIT_AREAS.map((area) => ({ area, note: `Note about ${area}.`, evidence }));
const single = (evidence: string[]) => JSON.stringify({ areas: areas(evidence) });

function scripted(script: string[]) {
  const requests: AIMessage[][] = [];
  const provider: AIProvider = {
    providerType: 'mock',
    async generateText(messages) {
      requests.push(messages);
      const next = script.shift();
      if (next === undefined) throw new Error('script ran out');
      return next;
    },
  };
  return { provider, requests };
}

async function aiWith(provider: AIProvider) {
  return resolveAuditAi({
    setup: { provider: 'mock' },
    keys: { resolveKey: async () => ({ provider: 'mock', apiKey: 'test-key-not-real', source: 'env' }) },
    createProvider: vi.fn((_t: AIProviderType, _k: string) => provider),
  });
}

const PAGES = [page('/a', 'AF-001'), page('/b', 'AF-002'), page('/c', 'AF-003'), page('/d', 'AF-004')];

describe('AI assessment in batches (T-406)', () => {
  it('groups pages under 1,500 words 4 to a request; others go alone', () => {
    const list = [
      page('/1', 'x'),
      page('/2', 'x'),
      page('/big', 'x', 4000),
      page('/3', 'x'),
      page('/4', 'x'),
      page('/5', 'x'),
    ];
    expect(batchPages(list)).toEqual([[2], [0, 1, 3, 4], [5]]);
    expect(batchPages([{ wordCount: undefined }])).toEqual([[0]]);
  });

  it('a batch of 4 pages gives 4 assessments, each citing its own page', async () => {
    const answer = JSON.stringify({
      pages: PAGES.map((p) => ({ urlPath: p.urlPath, areas: areas([p.findings[0].id]) })),
    });
    const { provider, requests } = scripted([answer]);
    const out = await assessPages({ language: 'en', pages: PAGES }, await aiWith(provider));
    expect(requests).toHaveLength(1);
    expect(out.map((o) => o.urlPath)).toEqual(['/a', '/b', '/c', '/d']);
    out.forEach((o, i) => {
      expect(o.areas.every((a) => a.status === 'done')).toBe(true);
      for (const a of o.areas) if (a.status === 'done') expect(a.evidence).toEqual([PAGES[i].findings[0].id]);
    });
  });

  it('a wrong citation causes a single re-ask of that page alone', async () => {
    const answer = JSON.stringify({
      pages: [
        { urlPath: '/a', areas: areas(['AF-001']) },
        // Cites /c's finding: dropped, /b is asked again alone.
        { urlPath: '/b', areas: areas(['AF-003']) },
        { urlPath: '/c', areas: areas(['AF-003']) },
        { urlPath: '/d', areas: areas(['AF-004']) },
        // A page outside the batch: dropped.
        { urlPath: '/elsewhere', areas: areas([]) },
      ],
    });
    const { provider, requests } = scripted([answer, single(['AF-002'])]);
    const out = await assessPages({ language: 'en', pages: PAGES }, await aiWith(provider));
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1])).toContain('/b');
    expect(JSON.stringify(requests[1])).not.toContain('Title of /a');
    const b = out.find((o) => o.urlPath === '/b')!;
    expect(b.areas.every((a) => a.status === 'done')).toBe(true);
  });

  it('uses the provider limit up to 8, otherwise 4', () => {
    expect(auditAiInFlight()).toBe(4);
    expect(auditAiInFlight(6)).toBe(6);
    expect(auditAiInFlight(50)).toBe(8);
  });
});
