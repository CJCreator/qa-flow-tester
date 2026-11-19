/**
 * T-417: fix options per finding. Rule options need no key; AI options come from the real stage AI on a fake
 * provider (the T-398 counter is the real one).
 */
import { describe, it, expect } from 'vitest';
import type { AIMessage, AuditFinding } from '@qa/types';
import { auditAiRequestBudget, findClaimWords, resolveAuditAi, type AIProvider } from '@qa/core';
import {
  FIX_RULES,
  fixOptionsFor,
  parseFixOptions,
  ruleFixOptions,
  ruleOptionsFor,
} from '../src/audit/improve/fix-options.js';
import { buildFindingsDocument } from '../src/audit/documents/findings.js';
import { buildRoadmap, roadmapFixOptions } from '../src/audit/documents/roadmap.js';
import { renderMarkdown } from '../src/audit/documents/render-markdown.js';
import { buildEditedView, emptyOverlay } from '../src/audit/documents/edits.js';
import { auditDocContents, auditDocResult } from './helpers/audit-doc-fixture.js';

function finding(n: number, rule: string, extra: Partial<AuditFinding> = {}): AuditFinding {
  const id = `AF-${String(n).padStart(3, '0')}`;
  return {
    id,
    rule,
    group: 'technical',
    area: 'search-ranking',
    title: `Finding ${n}`,
    detail: 'Seen on the page.',
    suggestion: 'Fix it.',
    impact: 'high',
    effort: 'low',
    urlPath: '/',
    sectionId: null,
    source: 'rule',
    ...extra,
  };
}

const RULES = ['missing-title', 'broken-link', 'missing-alt', 'ctas', 'some-checker-key', 'trust-signals'];
const FINDINGS = Array.from({ length: 12 }, (_, i) => finding(i + 1, RULES[i % RULES.length]));

describe('rule options', () => {
  it('without a key, each of the top 10 findings has 2 or 3 options by rule, with effort and trade-off', async () => {
    const options = await fixOptionsFor({ findings: FINDINGS, language: 'en' });
    expect([...options.keys()]).toEqual(FINDINGS.slice(0, 10).map((f) => f.id));
    for (const list of options.values()) {
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list.length).toBeLessThanOrEqual(3);
      for (const opt of list) {
        expect(opt.source).toBe('rule');
        expect(['S', 'M', 'L']).toContain(opt.effort);
        expect(opt.tradeOff.length).toBeGreaterThan(0);
      }
    }
  });

  it('an unknown rule falls back by area, then by group', () => {
    expect(ruleOptionsFor(finding(1, 'axe-color-contrast', { area: 'accessibility' }))).toHaveLength(2);
    expect(ruleOptionsFor(finding(2, 'unknown', { area: 'usability', group: 'content' }))[0].title).toBe(
      'Rewrite this Section'
    );
  });

  it('option ids are stable and cite the finding', () => {
    const [a, b] = ruleOptionsFor(finding(7, 'broken-link'));
    expect([a.id, b.id]).toEqual(['AF-007-A', 'AF-007-B']);
    expect(a.findingId).toBe('AF-007');
  });

  it('no rule text uses a claim word or a score', () => {
    for (const texts of Object.values(FIX_RULES)) {
      for (const t of texts) {
        expect(findClaimWords(`${t.title} ${t.tradeOff}`)).toEqual([]);
        expect(`${t.title} ${t.tradeOff}`).not.toMatch(/score|\d+\s*%/i);
      }
    }
  });
});

describe('AI options', () => {
  it('one request per batch of 5 findings; every option cites its finding; strays are dropped', async () => {
    const seen: AIMessage[][] = [];
    const provider: AIProvider = {
      providerType: 'openrouter',
      async generateText(messages) {
        seen.push(messages);
        const ids = (JSON.parse(messages[1].content as string) as Array<{ id: string }>).map((f) => f.id);
        return JSON.stringify({
          options: [
            ...ids.map((id) => ({
              findingId: id,
              title: `Site-specific fix for ${id}`,
              effort: 'M',
              tradeOff: 'Takes a day.',
            })),
            { findingId: 'AF-999', title: 'Not in this batch', effort: 'S', tradeOff: 'x' },
            { findingId: ids[0], title: 'Makes the site fully compliant', effort: 'S', tradeOff: 'x' },
            { findingId: ids[0], title: 'Raise the score', effort: 'S', tradeOff: 'to 90/100' },
          ],
        });
      },
    };
    const budget = auditAiRequestBudget();
    const resolved = await resolveAuditAi({
      setup: { provider: 'openrouter' },
      keys: { resolveKey: async () => ({ provider: 'openrouter', apiKey: 'test-only', source: 'keychain' }) },
      budget,
      createProvider: () => provider,
    });
    if (!resolved.ok) throw new Error('no ai');
    const options = await fixOptionsFor({ findings: FINDINGS, language: 'en', ai: resolved.ai });
    expect(seen).toHaveLength(2);
    expect(budget.used).toBe(2);
    for (const [id, list] of options) {
      expect(list.every((o) => o.findingId === id && o.id.startsWith(`${id}-`))).toBe(true);
      expect(list.length).toBeLessThanOrEqual(3);
      expect(list.some((o) => o.source === 'ai')).toBe(true);
      expect(list.filter((o) => o.source === 'rule').length).toBeGreaterThanOrEqual(2);
      expect(list.some((o) => /compliant|score/i.test(o.title))).toBe(false);
    }
  });

  it('parseFixOptions keeps only options that cite a finding of the batch', () => {
    const got = parseFixOptions(
      JSON.stringify({
        options: [
          { findingId: 'AF-001', title: 'A', effort: 'S', tradeOff: 'b' },
          { title: 'no id', effort: 'S', tradeOff: 'b' },
        ],
      }),
      new Set(['AF-001'])
    );
    expect(got).toEqual([{ findingId: 'AF-001', title: 'A', effort: 'S', tradeOff: 'b', source: 'ai' }]);
  });
});

describe('Findings document and Roadmap', () => {
  it('the Findings document shows the options under each top finding, labelled by rule', () => {
    const view = buildEditedView(auditDocResult(), auditDocContents(), emptyOverlay());
    const md = renderMarkdown(buildFindingsDocument(view));
    const top = view.result.findings.slice(0, 10);
    expect(top.length).toBeGreaterThan(0);
    for (const f of top) expect(md).toContain(`${ruleOptionsFor(f)[0].title} (decided by rule, effort`);
  });

  it('the Owner Audit (no effort) leaves the option effort out', () => {
    const view = buildEditedView(auditDocResult(), auditDocContents(), emptyOverlay());
    const md = renderMarkdown(buildFindingsDocument(view, { showEffort: false }));
    expect(md).toContain('(decided by rule):');
    expect(md).not.toContain('decided by rule, effort');
  });

  it('each Roadmap item links to the chosen option of its first finding', () => {
    const findings = FINDINGS.slice(0, 10);
    const links = roadmapFixOptions(buildRoadmap(findings), ruleFixOptions(findings));
    for (const item of buildRoadmap(findings)) {
      expect(links.get(item.id)?.findingId).toBe(item.findingIds[0]);
      expect(links.get(item.id)?.id).toBe(`${item.findingIds[0]}-A`);
    }
  });
});
