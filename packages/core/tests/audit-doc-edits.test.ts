import { describe, it, expect } from 'vitest';
import {
  sectionText,
  type AuditEditsPatch,
  type AuditResult,
  type EditOverlay,
  type HierarchyNode,
  type RoadmapItem,
} from '@qa/types';
import {
  buildEditedView,
  emptyOverlay,
  mergeEditsPatch,
  validateAuditEditsPatch,
  MAX_EDIT_TEXT_CHARS,
  MAX_EDIT_TITLE_CHARS,
  MAX_SECTION_EDIT_CHARS,
  type EditedAuditView,
} from '../src/audit/documents/edits.js';
import { buildRoadmap } from '../src/audit/documents/roadmap.js';
import { buildRoadmapDocument } from '../src/audit/documents/roadmap-document.js';
import { labelsFor } from '../src/audit/documents/labels/index.js';
import { auditDocContents, auditDocResult, fixtureSectionText, PATHS } from './helpers/audit-doc-fixture.js';

const NOW = '2026-11-03T10:00:00.000Z';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Validates and merges, failing the test when the patch is refused. */
function overlayOf(patch: unknown, base: EditOverlay = emptyOverlay()): EditOverlay {
  const checked = validateAuditEditsPatch(patch);
  if (!checked.ok) throw new Error(`patch refused: ${JSON.stringify(checked.errors)}`);
  return mergeEditsPatch(base, checked.value, NOW);
}

function nodePaths(node: HierarchyNode): string[] {
  return [node.urlPath, ...node.children.flatMap(nodePaths)];
}

/** The fixture version with its roadmap built by `buildRoadmap`, as the audit pipeline stores it. */
function pipelineResult(change?: (result: AuditResult) => void): AuditResult {
  const result = auditDocResult();
  change?.(result);
  result.roadmap = buildRoadmap(result.findings);
  return result;
}

/** Every roadmap item of the view equals, id aside, the item `buildRoadmap` makes from the view's findings. */
function expectRoadmapFollowsFindings(view: EditedAuditView): void {
  const withoutId = (item: RoadmapItem): RoadmapItem => ({ ...item, id: '' });
  const rebuilt = new Map(
    buildRoadmap(view.result.findings).map((item) => [item.findingIds.join(' '), withoutId(item)])
  );
  for (const item of view.result.roadmap)
    expect(withoutId(item), item.id).toEqual(rebuilt.get(item.findingIds.join(' ')));
  expect(view.result.roadmap).toHaveLength(rebuilt.size);
}

/** The item headings of the Improvement Roadmap document. */
function roadmapHeadings(view: EditedAuditView): string[] {
  return buildRoadmapDocument(view, labelsFor('en'), { showEffort: true })
    .blocks.filter((b) => b.type === 'heading' && b.level === 2)
    .map((b) => (b as { text: string }).text);
}

describe('validateAuditEditsPatch', () => {
  it('accepts a well-formed patch and keeps only its known keys', () => {
    const patch: AuditEditsPatch = {
      findings: [
        { findingId: 'AF-001', title: 'New title' },
        { findingId: 'AF-002', reset: true },
      ],
      sections: [
        { urlPath: '/ta', sectionId: 's2', text: 'புதிய உரை' },
        { urlPath: '/', sectionId: 's1', reset: true },
      ],
      removePages: ['/about'],
      restorePages: ['/services'],
      recommendations: [
        { urlPath: '/', action: 'redesign' },
        { urlPath: '/ta', reset: true },
      ],
      proposal: { price: '₹45,000 + GST', paymentTerms: '50% up front', notIncluded: ['Hosting'] },
    };
    const checked = validateAuditEditsPatch(patch);
    expect(checked).toEqual({ ok: true, value: patch });
  });

  it('allows a path with a query and an emptied Section', () => {
    const checked = validateAuditEditsPatch({
      sections: [{ urlPath: '/products?page=2', sectionId: 's3', text: '' }],
    });
    expect(checked.ok).toBe(true);
  });

  it('refuses a body that is not an object', () => {
    for (const body of [null, 'x', 3, [], undefined]) {
      const checked = validateAuditEditsPatch(body);
      expect(checked.ok).toBe(false);
      if (!checked.ok) expect(checked.errors.body).toBeTruthy();
    }
  });

  it('refuses unknown keys at every level with per-field errors', () => {
    const checked = validateAuditEditsPatch({
      findings: [{ findingId: 'AF-001', title: 'x', severity: 'Critical' }],
      sections: [{ urlPath: '/', sectionId: 's1', text: 'x', by: 'rewrite' }],
      recommendations: [{ urlPath: '/', action: 'repair', decidedBy: 'ai' }],
      proposal: { price: '1', currency: 'USD' },
      removedPages: ['/about'],
      __proto__x: 1,
    });
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(Object.keys(checked.errors).sort()).toEqual(
      [
        '__proto__x',
        'findings[0].severity',
        'proposal.currency',
        'recommendations[0].decidedBy',
        'removedPages',
        'sections[0].by',
      ].sort()
    );
  });

  it('refuses wrong types', () => {
    const checked = validateAuditEditsPatch({
      findings: [{ findingId: 7, title: 42 }],
      sections: 'nope',
      removePages: [12],
      restorePages: '/about',
      recommendations: [{ urlPath: '/', action: 'rebuild' }],
      proposal: { price: 45000, notIncluded: 'Hosting' },
    });
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.errors).toMatchObject({
      'findings[0].findingId': expect.any(String),
      'findings[0].title': expect.any(String),
      sections: expect.any(String),
      'removePages[0]': expect.any(String),
      restorePages: expect.any(String),
      'recommendations[0].action': expect.any(String),
      'proposal.price': expect.any(String),
      'proposal.notIncluded': expect.any(String),
    });
  });

  it('refuses text over the caps and accepts text at the caps', () => {
    const atCap = validateAuditEditsPatch({
      findings: [
        { findingId: 'AF-001', title: 't'.repeat(MAX_EDIT_TITLE_CHARS), detail: 'd'.repeat(MAX_EDIT_TEXT_CHARS) },
      ],
      sections: [{ urlPath: '/', sectionId: 's1', text: 'அ'.repeat(MAX_SECTION_EDIT_CHARS) }],
    });
    expect(atCap.ok).toBe(true);

    const over = validateAuditEditsPatch({
      findings: [
        {
          findingId: 'AF-001',
          title: 't'.repeat(MAX_EDIT_TITLE_CHARS + 1),
          suggestion: 's'.repeat(MAX_EDIT_TEXT_CHARS + 1),
        },
      ],
      sections: [{ urlPath: '/', sectionId: 's1', text: 'x'.repeat(MAX_SECTION_EDIT_CHARS + 1) }],
    });
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.errors['findings[0].title']).toMatch(/longer than/);
    expect(over.errors['findings[0].suggestion']).toMatch(/longer than/);
    expect(over.errors['sections[0].text']).toMatch(/longer than/);
  });

  it('refuses malformed page paths', () => {
    for (const urlPath of [
      'about',
      '//evil.example',
      'https://evil.example/',
      '/a b',
      '/a\\b',
      '/a#top',
      '',
      '/a\u0000',
    ]) {
      const checked = validateAuditEditsPatch({ removePages: [urlPath] });
      expect(checked.ok, urlPath).toBe(false);
      if (!checked.ok) expect(checked.errors['removePages[0]']).toBeTruthy();
    }
  });

  it('refuses a reset mixed with text, a reset that is not true, an empty edit and control characters', () => {
    const checked = validateAuditEditsPatch({
      findings: [
        { findingId: 'AF-001', reset: true, title: 'x' },
        { findingId: 'AF-002', reset: false },
        { findingId: 'AF-003' },
        { findingId: 'AF-004', title: '   ' },
        { findingId: 'AF-005', detail: 'bad\u0007bell' },
      ],
      removePages: ['/about'],
      restorePages: ['/about'],
    });
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(Object.keys(checked.errors).sort()).toEqual(
      [
        'findings[0].reset',
        'findings[1].reset',
        'findings[2]',
        'findings[3].title',
        'findings[4].detail',
        'restorePages',
      ].sort()
    );
  });

  it('merges nothing when a patch is refused', () => {
    const before = overlayOf({ findings: [{ findingId: 'AF-001', title: 'Kept' }] });
    const copy = structuredClone(before);
    const checked = validateAuditEditsPatch({
      findings: [{ findingId: 'AF-001', title: 'x'.repeat(MAX_EDIT_TITLE_CHARS + 1) }],
    });
    expect(checked.ok).toBe(false);
    expect(before).toEqual(copy);
  });
});

describe('mergeEditsPatch', () => {
  it('adds, merges field by field and stamps the edit and the overlay', () => {
    const one = overlayOf({ findings: [{ findingId: 'AF-001', title: 'First' }] });
    const two = overlayOf({ findings: [{ findingId: 'AF-001', detail: 'Second' }] }, one);
    expect(two.findings).toEqual([{ findingId: 'AF-001', title: 'First', detail: 'Second', editedAt: NOW }]);
    expect(two.updatedAt).toBe(NOW);
    expect(emptyOverlay().updatedAt).toBeNull();
  });

  it('replaces a Section and a recommendation edit', () => {
    const one = overlayOf({
      sections: [{ urlPath: '/', sectionId: 's2', text: 'A' }],
      recommendations: [{ urlPath: '/', action: 'redesign' }],
    });
    const two = overlayOf(
      {
        sections: [{ urlPath: '/', sectionId: 's2', text: 'B' }],
        recommendations: [{ urlPath: '/', action: 'repair' }],
      },
      one
    );
    expect(two.sections).toEqual([{ urlPath: '/', sectionId: 's2', text: 'B', by: 'person', editedAt: NOW }]);
    expect(two.recommendations).toEqual([{ urlPath: '/', action: 'repair', editedAt: NOW }]);
  });

  it('reset removes finding, Section and recommendation edits; restorePages brings a page back', () => {
    const edited = overlayOf({
      findings: [{ findingId: 'AF-001', title: 'Edited' }],
      sections: [{ urlPath: '/', sectionId: 's2', text: 'Edited' }],
      recommendations: [{ urlPath: '/', action: 'redesign' }],
      removePages: ['/about', '/services'],
    });
    const reset = overlayOf(
      {
        findings: [{ findingId: 'AF-001', reset: true }],
        sections: [{ urlPath: '/', sectionId: 's2', reset: true }],
        recommendations: [{ urlPath: '/', reset: true }],
        restorePages: ['/about'],
      },
      edited
    );
    expect(reset.findings).toEqual([]);
    expect(reset.sections).toEqual([]);
    expect(reset.recommendations).toEqual([]);
    expect(reset.removedPages).toEqual(['/services']);

    const view = buildEditedView(auditDocResult(), auditDocContents(), reset);
    const original = auditDocResult();
    const { title, detail, suggestion } = original.findings.find((f) => f.id === 'AF-001')!;
    expect(view.result.findings.find((f) => f.id === 'AF-001')).toMatchObject({ title, detail, suggestion });
    expect(view.result.pages.find((p) => p.urlPath === '/')!.recommendation!.action).toBe('repair');
    expect(
      sectionText(
        view.contents.find((c) => c.urlPath === '/')!,
        { start: 0, end: Infinity }
      )
    ).toBe(auditDocContents().find((c) => c.urlPath === '/')!.text);
    expect(view.result.pages.map((p) => p.urlPath)).toContain('/about');
  });

  it('sets, clears and replaces Proposal inputs', () => {
    const one = overlayOf({ proposal: { price: '₹45,000 + GST', paymentTerms: 'Half now', notIncluded: ['Hosting'] } });
    const two = overlayOf({ proposal: { price: '', notIncluded: ['Hosting', 'Ads'] } }, one);
    expect(two.proposal).toEqual({ paymentTerms: 'Half now', notIncluded: ['Hosting', 'Ads'] });
  });

  it('never changes the overlay it is given', () => {
    const base = deepFreeze(overlayOf({ findings: [{ findingId: 'AF-001', title: 'x' }], removePages: ['/about'] }));
    const copy = structuredClone(base);
    const next = overlayOf(
      { findings: [{ findingId: 'AF-001', reset: true }], restorePages: ['/about'], proposal: { price: '1' } },
      base
    );
    expect(base).toEqual(copy);
    expect(next).not.toEqual(base);
  });
});

describe('buildEditedView', () => {
  it('REQ-020 AC-1: a finding edit shows in the view and the original result is unchanged', () => {
    const result = auditDocResult();
    const contents = auditDocContents();
    const before = structuredClone(result);
    const contentsBefore = structuredClone(contents);
    const overlay = overlayOf({
      findings: [
        { findingId: 'AF-003', title: 'Add a description', detail: 'Edited detail.', suggestion: 'Edited suggestion.' },
        { findingId: 'AF-005', title: 'திருத்திய தலைப்பு' },
      ],
    });
    const overlayBefore = structuredClone(overlay);
    deepFreeze(result);
    deepFreeze(contents);
    deepFreeze(overlay);

    const view = buildEditedView(result, contents, overlay);

    const af3 = view.result.findings.find((f) => f.id === 'AF-003')!;
    expect(af3).toMatchObject({
      title: 'Add a description',
      detail: 'Edited detail.',
      suggestion: 'Edited suggestion.',
    });
    const af5 = view.result.findings.find((f) => f.id === 'AF-005')!;
    expect(af5.title).toBe('திருத்திய தலைப்பு');
    expect(af5.detail).toBe(before.findings.find((f) => f.id === 'AF-005')!.detail);
    expect(result).toEqual(before);
    expect(contents).toEqual(contentsBefore);
    expect(overlay).toEqual(overlayBefore);
    expect(view.result).not.toBe(result);
    expect(view.result.findings.map((f) => f.id)).toEqual(before.findings.map((f) => f.id));
  });

  it('with no edits the view equals the original', () => {
    const view = buildEditedView(auditDocResult(), auditDocContents(), emptyOverlay());
    expect(view.result).toEqual(auditDocResult());
    expect(view.contents).toEqual(auditDocContents());
    expect(view.removedPages).toEqual([]);
  });

  it('REQ-020 AC-2: a removed page appears nowhere in the view and its children are re-parented', () => {
    const result = deepFreeze(auditDocResult());
    const before = structuredClone(result);
    const view = buildEditedView(result, deepFreeze(auditDocContents()), overlayOf({ removePages: [PATHS.about] }));
    const r = view.result;
    const gone = PATHS.about;

    expect(view.removedPages).toEqual([gone]);
    expect(r.pages.map((p) => p.urlPath)).not.toContain(gone);
    expect(nodePaths(r.hierarchy.root)).not.toContain(gone);
    expect(r.hierarchy.root.children.map((c) => c.urlPath)).toEqual([PATHS.team, PATHS.services, PATHS.tamil]);
    expect(nodePaths(r.hierarchy.root).sort()).toEqual(r.pages.map((p) => p.urlPath).sort());
    for (const link of r.hierarchy.links) {
      expect(link.from).not.toBe(gone);
      expect(link.to).not.toBe(gone);
    }
    expect(r.hierarchy.links.length).toBe(3);
    for (const entry of r.leavingSite) expect(entry.from).not.toContain(gone);
    expect(r.leavingSite.map((e) => e.to)).toEqual(['https://instagram.com/shopexample']);
    expect(Object.keys(r.internalLinking.inboundCounts)).not.toContain(gone);
    expect(r.internalLinking.unlinkedPages).not.toContain(gone);
    for (const f of r.findings) {
      expect(f.urlPath).not.toBe(gone);
      expect(f.pages ?? []).not.toContain(gone);
    }
    for (const item of r.roadmap) expect(item.pages).not.toContain(gone);
    for (const s of r.marketing.signals) {
      expect(s.pages).not.toContain(gone);
      expect((s.nap ?? []).map((n) => n.urlPath)).not.toContain(gone);
    }
    expect(r.marketing.readPages).not.toContain(gone);
    expect(view.contents.map((c) => c.urlPath)).not.toContain(gone);

    // A finding only on the removed page is dropped; one spanning pages keeps the other page.
    expect(r.findings.map((f) => f.id)).toEqual(['AF-001', 'AF-003', 'AF-004', 'AF-005', 'AF-006']);
    expect(r.findings[0]).toMatchObject({ urlPath: PATHS.services, pages: [PATHS.services], sectionId: null });
    // A roadmap item left without findings is dropped.
    expect(r.roadmap.map((i) => i.id)).toEqual(['RM-1', 'RM-3', 'RM-4']);
    expect(r.roadmap[0].pages).toEqual([PATHS.services]);

    expect(result).toEqual(before);
  });

  it('drops a removed Sample Page from covered pages and keeps nested removals consistent', () => {
    const view = buildEditedView(
      auditDocResult(),
      auditDocContents(),
      overlayOf({ removePages: [PATHS.about, PATHS.team, PATHS.services] })
    );
    const r = view.result;
    expect(r.pages.map((p) => p.urlPath)).toEqual([PATHS.home, PATHS.tamil]);
    expect(nodePaths(r.hierarchy.root)).toEqual([PATHS.home, PATHS.tamil]);
    expect(r.findings.map((f) => f.id)).toEqual(['AF-004', 'AF-005']);
    expect(r.roadmap.map((i) => i.id)).toEqual(['RM-4']);
    expect(JSON.stringify(r.pages)).not.toContain(PATHS.services);
  });

  it('never removes the start page, and ignores paths not in the version', () => {
    const view = buildEditedView(auditDocResult(), auditDocContents(), overlayOf({ removePages: ['/', '/nowhere'] }));
    expect(view.removedPages).toEqual([]);
    expect(view.result.hierarchy.root.urlPath).toBe('/');
    expect(view.result.pages.length).toBe(5);
  });

  it('REQ-020 AC-3: a Section edit replaces that Section only; every other Section is unchanged (Tamil included)', () => {
    const contents = deepFreeze(auditDocContents());
    const before = structuredClone(contents);
    const edited = 'புதிய மளிகை — இன்றே ஆர்டர் செய்யுங்கள்!\n';
    const view = buildEditedView(
      auditDocResult(),
      contents,
      overlayOf({ sections: [{ urlPath: PATHS.tamil, sectionId: 's2', text: edited }] })
    );

    for (const original of before) {
      const page = view.contents.find((c) => c.urlPath === original.urlPath)!;
      expect(page.sections.map((s) => s.id)).toEqual(original.sections.map((s) => s.id));
      for (const s of page.sections) {
        const text = sectionText(page, s);
        if (page.urlPath === PATHS.tamil && s.id === 's2') expect(text).toBe(edited);
        else expect(text).toBe(fixtureSectionText(page.urlPath, s.id));
      }
      if (page.urlPath !== PATHS.tamil) expect(page).toEqual(original);
    }
    const tamil = view.contents.find((c) => c.urlPath === PATHS.tamil)!;
    expect(tamil.text).toBe(fixtureSectionText(PATHS.tamil, 's1') + edited + fixtureSectionText(PATHS.tamil, 's3'));
    expect(contents).toEqual(before);
  });

  it('an emptied Section and edits on two Sections of one page keep the rest intact', () => {
    const view = buildEditedView(
      auditDocResult(),
      auditDocContents(),
      overlayOf({
        sections: [
          { urlPath: PATHS.home, sectionId: 's1', text: '' },
          { urlPath: PATHS.home, sectionId: 's3', text: 'Call us any time.' },
        ],
      })
    );
    const home = view.contents.find((c) => c.urlPath === PATHS.home)!;
    expect(home.sections.map((s) => sectionText(home, s))).toEqual([
      '',
      fixtureSectionText(PATHS.home, 's2'),
      'Call us any time.',
    ]);
  });

  it('a recommendation edit replaces the action and keeps the reason', () => {
    const view = buildEditedView(
      auditDocResult(),
      auditDocContents(),
      overlayOf({ recommendations: [{ urlPath: PATHS.services, action: 'repair' }] })
    );
    const rec = view.result.pages.find((p) => p.urlPath === PATHS.services)!.recommendation!;
    expect(rec.action).toBe('repair');
    expect(rec.reason).toBe(auditDocResult().pages.find((p) => p.urlPath === PATHS.services)!.recommendation!.reason);
  });

  it('carries the Proposal inputs', () => {
    const view = buildEditedView(
      auditDocResult(),
      auditDocContents(),
      overlayOf({ proposal: { price: '₹45,000 + GST' } })
    );
    expect(view.proposal).toEqual({ price: '₹45,000 + GST' });
  });
});

describe('buildEditedView: the Improvement Roadmap follows the edited findings (REQ-020, F-060)', () => {
  const EDITED = 'Pages need their own titles';
  const duplicateTitle = (view: EditedAuditView): RoadmapItem =>
    view.result.roadmap.find((i) => i.findingIds.includes('AF-001'))!;

  it('editing the title of an item’s first finding renames the item, and the Roadmap document shows it', () => {
    const result = deepFreeze(pipelineResult());
    expect(duplicateTitle(buildEditedView(result, auditDocContents(), emptyOverlay())).title).toBe(
      'Two pages share one title'
    );

    const view = buildEditedView(
      result,
      auditDocContents(),
      overlayOf({ findings: [{ findingId: 'AF-001', title: EDITED }] })
    );

    expect(duplicateTitle(view).title).toBe(EDITED);
    expectRoadmapFollowsFindings(view);
    expect(roadmapHeadings(view)).toContain(EDITED);
    expect(roadmapHeadings(view)).not.toContain('Two pages share one title');
    expect(result.roadmap.find((i) => i.findingIds.includes('AF-001'))!.title).toBe('Two pages share one title');
  });

  it('only the first kept finding names an item; untouched items stay as recorded and a reset brings the name back', () => {
    const original = auditDocResult().roadmap;
    const byId = (view: EditedAuditView, id: string): RoadmapItem => view.result.roadmap.find((i) => i.id === id)!;
    const edited = overlayOf({
      findings: [
        { findingId: 'AF-003', title: 'Describe every page' },
        // AF-005 is the second finding of RM-4: RM-4 keeps its name.
        { findingId: 'AF-005', title: 'திருத்திய தலைப்பு' },
      ],
    });
    const view = buildEditedView(auditDocResult(), auditDocContents(), edited);

    expect(byId(view, 'RM-3')).toEqual({ ...original[2], title: 'Describe every page' });
    expect(byId(view, 'RM-4')).toEqual(original[3]);
    expect(byId(view, 'RM-1')).toEqual(original[0]);
    expect(byId(view, 'RM-2')).toEqual(original[1]);

    const reset = overlayOf({ findings: [{ findingId: 'AF-003', reset: true }] }, edited);
    expect(byId(buildEditedView(auditDocResult(), auditDocContents(), reset), 'RM-3')).toEqual(original[2]);
  });

  it('when an item’s first finding is dropped, the next kept finding names it and priority, effort and phase follow the kept findings', () => {
    // AF-003 (only on /services) leads the missing-description item ahead of AF-006 (only on /about/team).
    const result = deepFreeze(
      pipelineResult((r) => {
        Object.assign(
          r.findings.find((f) => f.id === 'AF-003')!,
          {
            title: 'The services page has no description',
            impact: 'high',
            effort: 'medium',
          }
        );
      })
    );
    const recorded = result.roadmap.find((i) => i.findingIds.includes('AF-003'))!;
    expect(recorded).toMatchObject({
      title: 'The services page has no description',
      priority: 'high',
      effort: 'medium',
      phase: 1,
      findingIds: ['AF-003', 'AF-006'],
    });

    const removed = buildEditedView(result, auditDocContents(), overlayOf({ removePages: [PATHS.services] }));
    const item = removed.result.roadmap.find((i) => i.findingIds.includes('AF-006'))!;
    expect(item).toEqual({
      id: recorded.id,
      title: 'No meta description',
      priority: 'low',
      effort: 'low',
      phase: 3,
      findingIds: ['AF-006'],
      pages: [PATHS.team],
    });
    expectRoadmapFollowsFindings(removed);
    expect(roadmapHeadings(removed)).not.toContain('The services page has no description');

    // The next finding's own edited title names the item.
    const both = buildEditedView(
      result,
      auditDocContents(),
      overlayOf({
        removePages: [PATHS.services],
        findings: [{ findingId: 'AF-006', title: 'The team page has no description' }],
      })
    );
    expect(both.result.roadmap.find((i) => i.id === recorded.id)).toMatchObject({
      title: 'The team page has no description',
      priority: 'low',
      effort: 'low',
      phase: 3,
    });
    expectRoadmapFollowsFindings(both);
  });

  it('a dropped later finding lowers priority and effort to what the kept findings need, keeping the name', () => {
    const result = deepFreeze(
      pipelineResult((r) => {
        Object.assign(
          r.findings.find((f) => f.id === 'AF-006')!,
          { impact: 'high', effort: 'high' }
        );
      })
    );
    const recorded = result.roadmap.find((i) => i.findingIds.includes('AF-006'))!;
    expect(recorded).toMatchObject({ title: 'No meta description', priority: 'high', effort: 'high', phase: 1 });

    const view = buildEditedView(result, auditDocContents(), overlayOf({ removePages: [PATHS.team] }));
    expect(view.result.roadmap.find((i) => i.id === recorded.id)).toEqual({
      ...recorded,
      priority: 'medium',
      effort: 'low',
      phase: 2,
      findingIds: ['AF-003'],
      pages: [PATHS.services],
    });
    expectRoadmapFollowsFindings(view);
  });
});
