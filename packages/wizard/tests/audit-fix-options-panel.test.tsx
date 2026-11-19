import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AuditFinding } from '@qa/types/src/browser.js';
import { FixOptionsView } from '../src/screens/audit/improved/FixOptionsPanel';

function finding(n: number, rule: string): AuditFinding {
  return {
    id: `AF-${String(n).padStart(3, '0')}`,
    rule,
    group: 'technical',
    area: 'search-ranking',
    title: `Finding ${n}`,
    detail: 'Seen.',
    suggestion: 'Fix.',
    impact: 'high',
    effort: 'low',
    urlPath: '/',
    sectionId: null,
    source: 'rule',
  };
}

describe('fix options on the Improved version screen', () => {
  it('shows 2 or 3 rule options under each of the top 10 findings, without an AI key', () => {
    const findings = Array.from({ length: 12 }, (_, i) => finding(i + 1, i % 2 ? 'broken-link' : 'not-a-known-rule'));
    const html = renderToStaticMarkup(createElement(FixOptionsView, { findings }));
    expect(html).toContain('AF-010: Finding 10');
    expect(html).not.toContain('AF-011');
    const options = html.match(/decided by rule, (small|medium|large) effort/g) ?? [];
    expect(options.length).toBeGreaterThanOrEqual(20);
  });

  it('says so when the version has no findings', () => {
    expect(renderToStaticMarkup(createElement(FixOptionsView, { findings: [] }))).toContain('no findings');
  });
});
