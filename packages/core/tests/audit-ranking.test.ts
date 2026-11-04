import { describe, it, expect } from 'vitest';
import { AUDIT_SCALE, MARKETING_SIGNALS } from '@qa/types';
import type { AuditFinding } from '@qa/types';
import {
  DEFAULT_IMPACT_EFFORT,
  IMPACT_EFFORT_BY_RULE,
  IMPACT_EFFORT_BY_SEVERITY,
  checkCitations,
  defaultImpactEffort,
  rankFindings,
  rankFindingsWithIdMap,
  scoreFindings,
  type UnscoredAuditFinding,
} from '../src/audit/ai/ranking.js';

function finding(over: Partial<UnscoredAuditFinding> & { id: string; rule: string }): UnscoredAuditFinding {
  return {
    group: 'content',
    area: 'content',
    title: 't',
    detail: 'd',
    suggestion: 's',
    urlPath: '/',
    sectionId: null,
    source: 'rule',
    ...over,
  };
}

const G3_RULES = [
  'missing-title',
  'missing-description',
  'missing-alt',
  'broken-link',
  'duplicate-title',
  'duplicate-description',
  'duplicate-content',
  'no-h1',
  'multiple-h1',
  'skipped-heading-level',
];

describe('IMPACT_EFFORT_BY_RULE', () => {
  it('covers every analysis rule and every marketing signal with scale values', () => {
    for (const rule of [...G3_RULES, ...MARKETING_SIGNALS.map((s) => s.key)]) {
      const entry = IMPACT_EFFORT_BY_RULE[rule];
      expect(entry, rule).toBeDefined();
      expect(AUDIT_SCALE).toContain(entry.impact);
      expect(AUDIT_SCALE).toContain(entry.effort);
    }
  });

  it('maps checker severities: critical/serious and Blocker/Major high, moderate/Minor medium, Suggestion low', () => {
    expect(IMPACT_EFFORT_BY_SEVERITY.critical.impact).toBe('high');
    expect(IMPACT_EFFORT_BY_SEVERITY.serious.impact).toBe('high');
    expect(defaultImpactEffort({ rule: 'color-contrast', severity: 'Blocker' }).impact).toBe('high');
    expect(defaultImpactEffort({ rule: 'color-contrast', severity: 'Major' }).impact).toBe('high');
    expect(defaultImpactEffort({ rule: 'color-contrast', severity: 'Minor' }).impact).toBe('medium');
    expect(defaultImpactEffort({ rule: 'x', severity: 'moderate' as never }).impact).toBe('medium');
    expect(defaultImpactEffort({ rule: 'x', severity: 'Suggestion' }).impact).toBe('low');
  });

  it('falls back to the default for an unknown rule without severity, and ignores prototype keys', () => {
    expect(defaultImpactEffort({ rule: 'ai-note' })).toEqual(DEFAULT_IMPACT_EFFORT);
    expect(defaultImpactEffort({ rule: 'constructor' })).toEqual(DEFAULT_IMPACT_EFFORT);
    expect(defaultImpactEffort({ rule: 'x', severity: 'toString' as never })).toEqual(DEFAULT_IMPACT_EFFORT);
  });
});

describe('scoreFindings', () => {
  it('fills unset impact and effort from the rule table', () => {
    const [f] = scoreFindings([finding({ id: 'AF-001', rule: 'missing-title' })]);
    expect(f.impact).toBe(IMPACT_EFFORT_BY_RULE['missing-title'].impact);
    expect(f.effort).toBe(IMPACT_EFFORT_BY_RULE['missing-title'].effort);
  });

  it('never changes a value the producer set, and fills only the missing one', () => {
    const input = [
      finding({ id: 'AF-001', rule: 'missing-title', impact: 'low', effort: 'high' }),
      finding({ id: 'AF-002', rule: 'broken-link', impact: 'medium' }),
      finding({ id: 'AF-003', rule: 'broken-link', effort: null }),
    ];
    const out = scoreFindings(input);
    expect(out[0]).toMatchObject({ impact: 'low', effort: 'high' });
    expect(out[1]).toMatchObject({ impact: 'medium', effort: IMPACT_EFFORT_BY_RULE['broken-link'].effort });
    expect(out[2]).toMatchObject({ impact: IMPACT_EFFORT_BY_RULE['broken-link'].impact });
    expect(input[1].effort).toBeUndefined();
  });

  it('uses the severity for a checker rule the table does not know', () => {
    const [f] = scoreFindings([finding({ id: 'AF-001', rule: 'image-alt', source: 'checker', severity: 'Major' })]);
    expect(f.impact).toBe('high');
  });
});

describe('rankFindings', () => {
  const mixed = [
    finding({ id: 'AF-001', rule: 'r-a', impact: 'low', effort: 'low', urlPath: '/a' }),
    finding({ id: 'AF-002', rule: 'r-b', impact: 'high', effort: 'high', urlPath: '/a' }),
    finding({ id: 'AF-003', rule: 'r-c', impact: 'medium', effort: 'medium', urlPath: '/a' }),
    finding({ id: 'AF-004', rule: 'r-d', impact: 'high', effort: 'low', urlPath: '/a' }),
    finding({ id: 'AF-005', rule: 'r-e', impact: 'high', effort: 'medium', urlPath: '/a' }),
    finding({ id: 'AF-006', rule: 'missing-title', urlPath: '/b' }),
  ];

  it('orders by impact, then lower effort, and every finding has impact and effort (REQ-017 AC-1)', () => {
    const ranked = rankFindings(mixed);
    expect(ranked.map((f) => `${f.impact}/${f.effort}`)).toEqual([
      'high/low',
      'high/low',
      'high/medium',
      'high/high',
      'medium/medium',
      'low/low',
    ]);
    for (const f of ranked) {
      expect(AUDIT_SCALE).toContain(f.impact);
      expect(AUDIT_SCALE).toContain(f.effort);
    }
    for (let i = 1; i < ranked.length; i++) {
      const rank = (s: string) => AUDIT_SCALE.indexOf(s as never);
      const prev = ranked[i - 1];
      const cur = ranked[i];
      expect(rank(prev.impact) < rank(cur.impact) || (prev.impact === cur.impact && rank(prev.effort) >= rank(cur.effort))).toBe(true);
    }
  });

  it('numbers AF-001… in ranked order and leaves the input unchanged', () => {
    const before = JSON.stringify(mixed);
    const ranked = rankFindings(mixed);
    expect(ranked.map((f) => f.id)).toEqual(['AF-001', 'AF-002', 'AF-003', 'AF-004', 'AF-005', 'AF-006']);
    expect(ranked[0].rule).toBe('r-d');
    expect(ranked[1].rule).toBe('missing-title');
    expect(JSON.stringify(mixed)).toBe(before);
  });

  it('breaks ties by page path, then Section order (numeric), then rule', () => {
    const tie = { impact: 'medium' as const, effort: 'low' as const };
    const input = [
      finding({ id: 'X1', rule: 'b-rule', urlPath: '/b', sectionId: 's1', ...tie }),
      finding({ id: 'X2', rule: 'b-rule', urlPath: '/a', sectionId: 's10', ...tie }),
      finding({ id: 'X3', rule: 'z-rule', urlPath: '/a', sectionId: 's2', ...tie }),
      finding({ id: 'X4', rule: 'a-rule', urlPath: '/a', sectionId: 's2', ...tie }),
      finding({ id: 'X5', rule: 'missing-title', urlPath: '/a', sectionId: null, ...tie }),
    ];
    expect(rankFindings(input).map((f) => `${f.urlPath} ${f.sectionId} ${f.rule}`)).toEqual([
      '/a null missing-title',
      '/a s2 a-rule',
      '/a s2 z-rule',
      '/a s10 b-rule',
      '/b s1 b-rule',
    ]);
  });

  it('is deterministic: any input order gives the same order and the same ids', () => {
    const input = [
      ...mixed,
      finding({ id: 'AF-007', rule: 'missing-alt', urlPath: '/g', sectionId: 's1', target: '/b.png' }),
      finding({ id: 'AF-008', rule: 'missing-alt', urlPath: '/g', sectionId: 's1', target: '/a.png' }),
    ];
    const once = rankFindings(input);
    expect(rankFindings(input)).toEqual(once);
    expect(rankFindings([...input].reverse())).toEqual(once);
    expect(rankFindings([input[3], input[7], input[0], input[5], input[1], input[6], input[2], input[4]])).toEqual(once);
  });

  it('can continue numbering and reports how ids were renumbered', () => {
    const { findings, idMap } = rankFindingsWithIdMap(mixed, { start: 12 });
    expect(findings[0].id).toBe('AF-012');
    expect(idMap.get('AF-004')).toBe('AF-012');
    expect(idMap.size).toBe(mixed.length);
    expect(() => rankFindings(mixed, { start: 0 })).toThrow(RangeError);
  });

  it('rejects an impact or effort outside the scale', () => {
    const bad = finding({ id: 'AF-001', rule: 'x', impact: 'urgent' as never });
    expect(() => rankFindings([bad])).toThrow(TypeError);
  });

  it('returns an empty list for no findings', () => {
    expect(rankFindings([])).toEqual([]);
  });
});

describe('checkCitations (REQ-017 AC-2)', () => {
  const pages = [
    { urlPath: '/', sections: [{ id: 's1' }, { id: 's2' }] },
    { urlPath: '/about', sections: [{ id: 's1' }] },
  ];
  const cite = (over: Partial<AuditFinding> & { id: string; rule: string }) =>
    ({ urlPath: '/', sectionId: 's1', ...over }) as Pick<AuditFinding, 'id' | 'rule' | 'urlPath' | 'sectionId' | 'pages'>;

  it('accepts findings citing an audited page and one of its Sections, and whole-page findings with null', () => {
    const ok = [
      cite({ id: 'AF-001', rule: 'missing-alt', sectionId: 's2' }),
      cite({ id: 'AF-002', rule: 'missing-title', sectionId: null }),
      cite({ id: 'AF-003', rule: 'missing-description', urlPath: '/about', sectionId: null }),
      cite({ id: 'AF-004', rule: 'skipped-heading-level', sectionId: null }),
      cite({ id: 'AF-005', rule: 'duplicate-title', sectionId: null, pages: ['/', '/about'] }),
    ];
    expect(checkCitations(ok, pages)).toEqual([]);
  });

  it('flags an unknown page, an unknown Section, and a missing Section on a non-whole-page finding', () => {
    const problems = checkCitations(
      [
        cite({ id: 'AF-001', rule: 'missing-alt', urlPath: '/gone' }),
        cite({ id: 'AF-002', rule: 'broken-link', urlPath: '/about', sectionId: 's2' }),
        cite({ id: 'AF-003', rule: 'missing-alt', sectionId: null }),
        cite({ id: 'AF-004', rule: 'duplicate-title', sectionId: null, pages: ['/', '/nowhere'] }),
      ],
      pages,
    );
    expect(problems).toEqual([
      { findingId: 'AF-001', kind: 'unknown-page', urlPath: '/gone', sectionId: 's1' },
      { findingId: 'AF-002', kind: 'unknown-section', urlPath: '/about', sectionId: 's2' },
      { findingId: 'AF-003', kind: 'missing-section', urlPath: '/', sectionId: null },
      { findingId: 'AF-004', kind: 'unknown-page', urlPath: '/nowhere', sectionId: null },
    ]);
  });

  it('does not take a Section of another page as valid', () => {
    const problems = checkCitations([cite({ id: 'AF-001', rule: 'missing-alt', urlPath: '/about', sectionId: 's2' })], pages);
    expect(problems.map((p) => p.kind)).toEqual(['unknown-section']);
  });
});
