import { describe, it, expect } from 'vitest';
import { AUDIT_SCALE, type AuditFinding, type AuditScale } from '@qa/types';
import { buildRoadmap, ROADMAP_PHASE } from '../src/audit/documents/roadmap.js';
import { buildRoadmapDocument, roadmapWording } from '../src/audit/documents/roadmap-document.js';
import { buildEditedView, emptyOverlay } from '../src/audit/documents/edits.js';
import type { AuditDoc } from '../src/audit/documents/model.js';
import { renderMarkdown } from '../src/audit/documents/render-markdown.js';
import { renderHtml } from '../src/audit/documents/render-html.js';
import { findClaimWords } from '../src/audit/documents/wording.js';
import { labelsFor, phaseLabel } from '../src/audit/documents/labels/index.js';
import { en } from '../src/audit/documents/labels/en.js';
import { ta } from '../src/audit/documents/labels/ta.js';
import { auditDocContents, auditDocResult, PATHS } from './helpers/audit-doc-fixture.js';

const RANK: Record<AuditScale, number> = { high: 0, medium: 1, low: 2 };

function f(id: string, rule: string, impact: AuditScale, effort: AuditScale, extra: Partial<AuditFinding> = {}): AuditFinding {
  return {
    id,
    rule,
    group: 'technical',
    area: 'search-ranking',
    title: `Finding ${id}`,
    detail: 'What was seen.',
    suggestion: 'How to repair it.',
    impact,
    effort,
    urlPath: `/p-${id.toLowerCase()}`,
    sectionId: null,
    source: 'rule',
    ...extra,
  };
}

/** Ranked like the pipeline ranks them: impact, then lower effort. */
function ranked(list: AuditFinding[]): AuditFinding[] {
  return [...list].sort((a, b) => RANK[a.impact] - RANK[b.impact] || RANK[b.effort] - RANK[a.effort]);
}

/** A mixed set: every impact and effort, several rules spanning several findings. */
function mixedFindings(): AuditFinding[] {
  return ranked([
    f('AF-001', 'broken-link', 'high', 'high'),
    f('AF-002', 'duplicate-title', 'high', 'low', { pages: ['/a', '/b'], urlPath: '/a' }),
    f('AF-003', 'missing-alt', 'medium', 'low'),
    f('AF-004', 'missing-alt', 'low', 'medium'),
    f('AF-005', 'thin-content', 'low', 'low'),
    f('AF-006', 'missing-description', 'medium', 'medium'),
    f('AF-007', 'duplicate-title', 'medium', 'low', { pages: ['/b', '/c'], urlPath: '/b' }),
    f('AF-008', 'slow-page', 'low', 'high'),
    f('AF-009', 'weak-cta', 'medium', 'high'),
  ]);
}

/** The fixture version with its roadmap built by `buildRoadmap`, as the audit pipeline stores it. */
function fixtureView() {
  const result = auditDocResult();
  result.roadmap = buildRoadmap(result.findings);
  return buildEditedView(result, auditDocContents(), emptyOverlay());
}

function emptyView() {
  const result = auditDocResult();
  result.findings = [];
  result.roadmap = buildRoadmap([]);
  return buildEditedView(result, auditDocContents(), emptyOverlay());
}

/** Every string in the document, title included. */
function allText(doc: AuditDoc): string {
  const parts: string[] = [doc.title];
  for (const b of doc.blocks) {
    if (b.type === 'heading' || b.type === 'paragraph' || b.type === 'note') parts.push(b.text);
    else if (b.type === 'list') parts.push(...b.items);
    else if (b.type === 'table') parts.push(...b.columns, ...b.rows.flat());
    else if (b.type === 'image') parts.push(b.alt, b.caption ?? '');
  }
  return parts.join('\n');
}

const PLAN_WORDS = [/\bplans?\b/i, /enhancement plan/i, /action plan/i, /backlog/i, /to-do list/i, /திட்டம்/];

describe('buildRoadmap', () => {
  it('gives every item a priority, a phase and an effort (REQ-026 AC-1)', () => {
    const items = buildRoadmap(mixedFindings());
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(AUDIT_SCALE).toContain(item.priority);
      expect(AUDIT_SCALE).toContain(item.effort);
      expect([1, 2, 3]).toContain(item.phase);
      expect(item.phase).toBe(ROADMAP_PHASE[item.priority]);
      expect(item.id).toMatch(/^RM-\d+$/);
      expect(item.title).not.toBe('');
    }
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('covers every finding id in exactly one item', () => {
    const findings = mixedFindings();
    const items = buildRoadmap(findings);
    const covered = items.flatMap((i) => i.findingIds);
    expect(covered.length).toBe(findings.length);
    expect(new Set(covered)).toEqual(new Set(findings.map((x) => x.id)));
  });

  it('counts a repeated finding id once', () => {
    const one = f('AF-001', 'missing-alt', 'medium', 'low');
    const items = buildRoadmap([one, { ...one }]);
    expect(items).toHaveLength(1);
    expect(items[0].findingIds).toEqual(['AF-001']);
  });

  it('makes one item per rule with every finding and page, priority and effort the highest of its findings', () => {
    const items = buildRoadmap(mixedFindings());
    const rules = new Set(mixedFindings().map((x) => x.rule));
    expect(items).toHaveLength(rules.size);

    const alt = items.find((i) => i.findingIds.includes('AF-003'))!;
    expect(alt.findingIds).toEqual(['AF-003', 'AF-004']);
    expect(alt.priority).toBe('medium');
    expect(alt.effort).toBe('medium');
    expect(alt.pages).toEqual(['/p-af-003', '/p-af-004']);

    const titles = items.find((i) => i.findingIds.includes('AF-002'))!;
    expect(titles.findingIds).toEqual(['AF-002', 'AF-007']);
    expect(titles.priority).toBe('high');
    expect(titles.effort).toBe('low');
    // Spanning findings list all their pages, each once.
    expect(titles.pages).toEqual(['/a', '/b', '/c']);
  });

  it('orders items by impact, then lower effort, and phases never decrease', () => {
    const items = buildRoadmap(mixedFindings());
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      const cur = items[i];
      expect(RANK[cur.priority]).toBeGreaterThanOrEqual(RANK[prev.priority]);
      if (cur.priority === prev.priority) expect(RANK[cur.effort]).toBeLessThanOrEqual(RANK[prev.effort]);
      expect(cur.phase).toBeGreaterThanOrEqual(prev.phase);
    }
    expect(items.map((i) => [i.priority, i.effort])).toEqual([
      ['high', 'low'],
      ['high', 'high'],
      ['medium', 'medium'],
      ['medium', 'medium'],
      ['medium', 'high'],
      ['low', 'low'],
      ['low', 'high'],
    ]);
    expect(items.map((i) => i.phase)).toEqual([1, 1, 2, 2, 2, 3, 3]);
    expect(items.map((i) => i.id)).toEqual(['RM-1', 'RM-2', 'RM-3', 'RM-4', 'RM-5', 'RM-6', 'RM-7']);
  });

  it('orders the fixture findings and keeps each item named after its highest ranked finding', () => {
    const items = buildRoadmap(auditDocResult().findings);
    expect(items.map((i) => i.findingIds)).toEqual([['AF-001'], ['AF-002'], ['AF-003', 'AF-006'], ['AF-004'], ['AF-005']]);
    expect(items[0]).toMatchObject({ title: 'Two pages share one title', priority: 'high', phase: 1, effort: 'low' });
    expect(items[2].pages).toEqual([PATHS.services, PATHS.team]);
    expect(items[4]).toMatchObject({ priority: 'low', phase: 3 });
  });

  it('gives an empty roadmap for no findings', () => {
    expect(buildRoadmap([])).toEqual([]);
  });

  it('does not change its input', () => {
    const findings = mixedFindings();
    const copy = structuredClone(findings);
    buildRoadmap(findings);
    expect(findings).toEqual(copy);
  });
});

describe('buildRoadmapDocument', () => {
  it('lists phases in order, each item with priority, phase, effort, findings and pages', () => {
    const view = fixtureView();
    const doc = buildRoadmapDocument(view, labelsFor('en'), { showEffort: true });
    expect(doc.kind).toBe('roadmap');
    expect(doc.title).toBe(en.documentTitles.roadmap);
    expect(doc.language).toBe('en');

    const phaseHeadings = doc.blocks.filter((b) => b.type === 'heading' && b.level === 1).map((b) => (b as { text: string }).text);
    expect(phaseHeadings).toEqual([phaseLabel(en, 1), phaseLabel(en, 2), phaseLabel(en, 3)]);

    const itemHeadings = doc.blocks.filter((b) => b.type === 'heading' && b.level === 2).map((b) => (b as { text: string }).text);
    expect(itemHeadings).toEqual(view.result.roadmap.map((i) => i.title));

    const lists = doc.blocks.filter((b) => b.type === 'list');
    expect(lists[0]).toEqual({
      type: 'list',
      items: [`${en.columns.priority}: ${en.scale.high}`, `${en.columns.phase}: ${phaseLabel(en, 1)}`, `${en.columns.effort}: ${en.scale.low}`],
    });

    const tables = doc.blocks.filter((b) => b.type === 'table') as Array<Extract<AuditDoc['blocks'][number], { type: 'table' }>>;
    expect(tables[0].columns).toEqual([en.columns.issue, en.columns.page, en.columns.impact, en.columns.effort]);
    expect(tables[0].rows).toEqual([['Two pages share one title', `${PATHS.about}, ${PATHS.services}`, en.scale.high, en.scale.low]]);
    // Every finding in the roadmap shows once.
    expect(tables.flatMap((t) => t.rows).length).toBe(view.result.findings.length);

    const md = renderMarkdown(doc);
    expect(md).toContain(`${roadmapWording('en').pagesCovered}: ${PATHS.services}, ${PATHS.team}`);
  });

  it('shows the tool user\'s edited finding titles and leaves out removed pages', () => {
    const result = auditDocResult();
    result.roadmap = buildRoadmap(result.findings);
    const overlay = { ...emptyOverlay(), removedPages: [PATHS.team], findings: [{ findingId: 'AF-003', title: 'Edited title', editedAt: '2026-11-03T10:00:00.000Z' }],
    };
    const view = buildEditedView(result, auditDocContents(), overlay);
    const text = allText(buildRoadmapDocument(view, labelsFor('en'), { showEffort: true }));
    expect(text).toContain('Edited title');
    expect(text).not.toContain(PATHS.team);
  });

  it('says there is nothing to order when there are no findings, without claiming the site is fine (ADR 0018)', () => {
    for (const lang of ['en', 'ta'] as const) {
      const doc = buildRoadmapDocument(emptyView(), labelsFor(lang), { showEffort: true });
      expect(doc.blocks).toEqual([{ type: 'paragraph', text: roadmapWording(lang).nothingToOrder }]);
      const out = renderMarkdown(doc) + renderHtml(doc);
      expect(findClaimWords(out)).toEqual([]);
      expect(out).not.toMatch(/\b(fine|no issues found|all good|healthy|perfect)\b/i);
    }
    expect(roadmapWording('en').nothingToOrder).toMatch(/nothing to order/);
  });

  it('shows no effort value or effort heading with showEffort: false (Owner Audit)', () => {
    for (const lang of ['en', 'ta'] as const) {
      const { labels } = labelsFor(lang);
      const doc = buildRoadmapDocument(fixtureView(), labelsFor(lang), { showEffort: false });
      const text = allText(doc);
      expect(text).not.toContain(labels.columns.effort);
      for (const b of doc.blocks) {
        if (b.type === 'table') {
          expect(b.columns).toEqual([labels.columns.issue, labels.columns.page, labels.columns.impact]);
          for (const row of b.rows) expect(row).toHaveLength(3);
        }
        if (b.type === 'list') {
          expect(b.items).toHaveLength(2);
          expect(b.items.some((i) => i.startsWith(`${labels.columns.effort}:`))).toBe(false);
        }
      }
      const out = renderMarkdown(doc) + renderHtml(doc);
      expect(out).not.toContain(labels.columns.effort);
      if (lang === 'en') expect(out.toLowerCase()).not.toContain('effort');
    }
  });

  it('takes its fixed wording from the language\'s labels, with no Plan or ADR 0018 word (EN and TA)', () => {
    for (const [lang, labels] of [
      ['en', en],
      ['ta', ta],
    ] as const) {
      const doc = buildRoadmapDocument(fixtureView(), labelsFor(lang), { showEffort: true });
      expect(doc.language).toBe(lang);
      expect(doc.title).toBe(labels.documentTitles.roadmap);
      const text = allText(doc);
      expect(text).toContain(phaseLabel(labels, 1));
      expect(text).toContain(`${labels.columns.priority}: ${labels.scale.high}`);
      expect(text).toContain(`${labels.columns.effort}: ${labels.scale.low}`);
      expect(text).toContain(roadmapWording(lang).intro);
      expect(text).toContain(roadmapWording(lang).pagesCovered);
      if (lang === 'ta') {
        expect(text).not.toContain(en.columns.priority);
        expect(text).not.toContain(en.phases.first);
        expect(text).not.toContain(roadmapWording('en').pagesCovered);
      }

      for (const showEffort of [true, false]) {
        const out = renderMarkdown(buildRoadmapDocument(fixtureView(), labelsFor(lang), { showEffort }));
        expect(findClaimWords(out)).toEqual([]);
        for (const re of PLAN_WORDS) expect(out).not.toMatch(re);
      }
      for (const value of Object.values(roadmapWording(lang))) {
        expect(findClaimWords(value)).toEqual([]);
        for (const re of PLAN_WORDS) expect(value).not.toMatch(re);
      }
    }
  });

  it('falls back to English wording for a language without a table, keeping the requested document language', () => {
    const lookup = labelsFor('te');
    const doc = buildRoadmapDocument(fixtureView(), lookup, { showEffort: true });
    expect(lookup.fallback).toBe(true);
    expect(doc.language).toBe('te');
    expect(allText(doc)).toContain(roadmapWording('en').intro);
  });
});
