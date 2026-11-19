import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AuditFinding, AuditResult, AuditVersion } from '@qa/types/src/browser.js';
import { countFindingRules, findingsAndRulesText } from '@qa/types/src/browser.js';
import { versionCounts } from '../src/screens/audit/saved/saved-api';
import { AuditSummary } from '../src/screens/audit/results/AuditSummary';

function finding(id: string, rule: string, urlPath: string, over: Partial<AuditFinding> = {}): AuditFinding {
  return {
    id,
    rule,
    group: 'technical',
    area: 'usability',
    title: `Finding ${rule}`,
    detail: 'Seen on the page.',
    suggestion: 'Fix it.',
    impact: 'high',
    effort: 'low',
    urlPath,
    sectionId: null,
    source: 'rule',
    ...over,
  };
}

// 5 findings: missing-alt on 3 pages, duplicate-title on 1, and one AI note that is not a rule.
const FINDINGS: AuditFinding[] = [
  finding('AF-001', 'missing-alt', '/'),
  finding('AF-002', 'missing-alt', '/about'),
  finding('AF-003', 'missing-alt', '/contact'),
  finding('AF-004', 'duplicate-title', '/about'),
  finding('AF-005', 'ai-copy-note', '/', { source: 'ai', advisory: true }),
];

describe('Website Audit counts say findings and rules (T-390)', () => {
  it('counts distinct rules, AI advice left out', () => {
    expect(countFindingRules(FINDINGS)).toBe(2);
    expect(countFindingRules([])).toBe(0);
  });

  it('labels both numbers, in the singular for one', () => {
    expect(findingsAndRulesText(312, 41)).toBe('312 findings · 41 rules');
    expect(findingsAndRulesText(1, 1)).toBe('1 finding · 1 rule');
  });

  it('Saved audits show findings and rules', () => {
    const version = {
      auditId: 'abcd1234',
      version: 1,
      status: 'done',
      pagesRecorded: 3,
      pagesSkipped: 0,
      findings: 5,
      rules: 2,
    } as AuditVersion;
    expect(versionCounts(version)).toBe('3 pages recorded · 0 pages skipped · 5 findings · 2 rules');
  });

  it('a version saved before rules were counted shows its findings alone', () => {
    const version = { auditId: 'abcd1234', version: 1, status: 'done', findings: 5 } as AuditVersion;
    expect(versionCounts(version)).toBe('5 findings');
  });

  it('the summary shows the same two numbers', () => {
    const result = {
      coverage: { found: 3, reached: 3, skipped: [] },
      findings: FINDINGS,
    } as unknown as AuditResult;
    const html = renderToStaticMarkup(createElement(AuditSummary, { result }));
    expect(html).toContain('5 findings · 2 rules');
  });
});
