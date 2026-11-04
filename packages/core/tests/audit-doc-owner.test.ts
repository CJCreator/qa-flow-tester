import { describe, it, expect } from 'vitest';
import type { EditOverlay, ShortlistEntry } from '@qa/types';
import {
  buildEditedView,
  emptyOverlay,
  mergeEditsPatch,
  validateAuditEditsPatch,
  type EditedAuditView,
} from '../src/audit/documents/edits.js';
import { buildOwnerAudit, ownerWording, OWNER_SUMMARY_TOP_FINDINGS } from '../src/audit/documents/owner-audit.js';
import type { AuditDoc } from '../src/audit/documents/model.js';
import { renderMarkdown } from '../src/audit/documents/render-markdown.js';
import { renderHtml } from '../src/audit/documents/render-html.js';
import { findClaimWords } from '../src/audit/documents/wording.js';
import { labelsFor } from '../src/audit/documents/labels/index.js';
import { en } from '../src/audit/documents/labels/en.js';
import { ta } from '../src/audit/documents/labels/ta.js';
import { auditDocContents, auditDocResult, FIXTURE_AUDIT_ID, FIXTURE_URL } from './helpers/audit-doc-fixture.js';

const NOW = '2026-11-03T10:00:00.000Z';
const PRICE = '₹45,000 + GST';
const PAYMENT_TERMS = 'Half before work starts, half on handover';
const SHORTLIST: ShortlistEntry = {
  auditId: FIXTURE_AUDIT_ID,
  mark: 'pitch',
  notes: 'Owner Murugan, call after 5 pm',
  outcome: 'Meeting set',
  outcomeNote: 'Meeting on Friday at the shop',
  updatedAt: NOW,
};

function overlayOf(patch: unknown): EditOverlay {
  const checked = validateAuditEditsPatch(patch);
  if (!checked.ok) throw new Error(`patch refused: ${JSON.stringify(checked.errors)}`);
  return mergeEditsPatch(emptyOverlay(), checked.value, NOW);
}

/** The fixture version with a Proposal price and payment terms entered and a Shortlist entry beside it. */
function viewWithEverything(patch: Record<string, unknown> = {}): EditedAuditView {
  const result = auditDocResult();
  // A Shortlist entry stored with the audit must never reach the Owner Audit, even if it rides along.
  Object.assign(result, { shortlist: SHORTLIST });
  return buildEditedView(
    result,
    auditDocContents(),
    overlayOf({ ...patch, proposal: { price: PRICE, paymentTerms: PAYMENT_TERMS, notIncluded: ['Logo design work'] } })
  );
}

function outputs(doc: AuditDoc): Array<[format: string, text: string]> {
  return [
    ['md', renderMarkdown(doc)],
    ['html', renderHtml(doc)],
  ];
}

describe('Owner Audit: language (REQ-025 AC-1)', () => {
  it('English: English title, summary and parts, lang="en"', () => {
    const doc = buildOwnerAudit(viewWithEverything(), labelsFor('en'));
    expect(doc.kind).toBe('owner-audit');
    expect(doc.language).toBe('en');
    expect(doc.title).toBe(en.documentTitles['owner-audit']);
    expect(renderHtml(doc)).toMatch(/<html lang="en"/);
    const md = renderMarkdown(doc);
    expect(md).toContain(ownerWording('en').intro);
    expect(md).not.toContain(ta.headings.summary);
  });

  it('Tamil: Tamil title, summary and part titles, lang="ta"', () => {
    const doc = buildOwnerAudit(viewWithEverything(), labelsFor('ta'));
    expect(doc.language).toBe('ta');
    expect(doc.title).toBe(ta.documentTitles['owner-audit']);
    const html = renderHtml(doc);
    expect(html).toMatch(/<html lang="ta"/);
    for (const s of [
      ta.headings.summary,
      ta.headings.topIssues,
      ownerWording('ta').intro,
      ownerWording('ta').findingsPerGroup,
      ta.documentTitles.structure,
      ta.documentTitles.content,
      ta.documentTitles.findings,
      ta.documentTitles.roadmap,
    ]) {
      expect(html, s).toContain(s);
    }
    for (const s of [
      en.headings.summary,
      ownerWording('en').intro,
      ownerWording('en').findingsPerGroup,
      en.documentTitles.roadmap,
    ]) {
      expect(html, s).not.toContain(s);
    }
  });
});

describe('Owner Audit: summary on top, then the parts', () => {
  it('starts with the plain-language summary', () => {
    for (const lang of ['en', 'ta'] as const) {
      const lookup = labelsFor(lang);
      const doc = buildOwnerAudit(viewWithEverything(), lookup);
      expect(doc.blocks[0]).toEqual({ type: 'heading', level: 1, text: lookup.labels.headings.summary });
      expect(
        renderMarkdown(doc).startsWith(
          `# ${lookup.labels.documentTitles['owner-audit']}\n\n## ${lookup.labels.headings.summary}\n`
        )
      ).toBe(true);
    }
  });

  it('summarises what was checked, findings per group and the top items, with no score', () => {
    const doc = buildOwnerAudit(viewWithEverything(), labelsFor('en'));
    const firstBreak = doc.blocks.findIndex((b) => b.type === 'pagebreak');
    const summary = doc.blocks.slice(0, firstBreak);
    const text = summary
      .map((b) =>
        b.type === 'paragraph' || b.type === 'note' || b.type === 'heading'
          ? b.text
          : b.type === 'list'
            ? b.items.join('\n')
            : ''
      )
      .join('\n');
    expect(text).toContain(`Website: ${FIXTURE_URL}`);
    expect(text).toMatch(/Pages read: 5 of \d+ found\./);
    expect(text).toContain('Pages not read: 1 (Payment page).');
    expect(text).toContain('Areas graded by fixed checks: Marketing.');
    expect(text).toContain('Technical: 3\nMarketing: 1\nContent: 2');
    const top = summary.find((b) => b.type === 'list' && b.ordered);
    expect(top?.type === 'list' ? top.items : []).toEqual([
      'Two pages share one title (Page: /about, /services)',
      'An image has no alt text (Page: /about)',
      'No meta description (Page: /services)',
      'The call to action is easy to miss (Page: /)',
      'பக்கத்தில் குறைவான உள்ளடக்கம் (Page: /ta)',
    ]);
    expect(OWNER_SUMMARY_TOP_FINDINGS).toBe(5);
    // No score and no grade letter in the summary.
    expect(text).not.toMatch(/\bscore\b/i);
    expect(text).not.toMatch(/\bgrade\b:?\s*[A-F]\b/i);
    // The fixture grades Marketing C: the summary names the area, never its grade.
    expect(text).not.toMatch(/Marketing:?\s*\(?C\b/);
    expect(text).toContain(ownerWording('en').limits);
  });

  it('is deterministic', () => {
    const a = renderMarkdown(buildOwnerAudit(viewWithEverything(), labelsFor('en')));
    const b = renderMarkdown(buildOwnerAudit(viewWithEverything(), labelsFor('en')));
    expect(a).toBe(b);
  });

  it('then has Structure, Content, Findings and Improvement Roadmap in that order, and no Proposal', () => {
    const doc = buildOwnerAudit(viewWithEverything(), labelsFor('en'));
    const parts = doc.blocks.flatMap((b, i) =>
      b.type === 'heading' && b.level === 1 && doc.blocks[i - 1]?.type === 'pagebreak' ? [b.text] : []
    );
    expect(parts).toEqual([
      en.documentTitles.structure,
      en.documentTitles.content,
      en.documentTitles.findings,
      en.documentTitles.roadmap,
    ]);
    // Each part's own headings sit one level under its title.
    const firstPart = doc.blocks.findIndex((b) => b.type === 'pagebreak');
    for (const b of doc.blocks.slice(firstPart)) {
      if (b.type === 'heading' && !parts.includes(b.text)) expect(b.level).toBeGreaterThanOrEqual(2);
    }
    const md = renderMarkdown(doc);
    expect(md).not.toContain(en.documentTitles.proposal);
    expect(md).toContain('Two pages share one title');
    expect(md).toContain(en.columns.suggestedFix);
  });

  it('carries the edits (REQ-020)', () => {
    const md = renderMarkdown(
      buildOwnerAudit(
        viewWithEverything({ findings: [{ findingId: 'AF-001', title: 'Edited for the owner' }] }),
        labelsFor('en')
      )
    );
    expect(md).toContain('Edited for the owner');
    expect(md).not.toContain('Two pages share one title');
  });
});

describe('Owner Audit: what it leaves out (REQ-025 AC-2, Q-17)', () => {
  for (const lang of ['en', 'ta'] as const) {
    it(`${lang}: no Shortlist mark, notes or outcome, no effort, no price or payment terms`, () => {
      const lookup = labelsFor(lang);
      const doc = buildOwnerAudit(viewWithEverything(), lookup);
      for (const [format, text] of outputs(doc)) {
        for (const s of [
          SHORTLIST.notes,
          SHORTLIST.outcomeNote,
          SHORTLIST.outcome!,
          PRICE,
          '45,000',
          PAYMENT_TERMS,
          'Logo design work',
          lookup.labels.headings.price,
          lookup.labels.headings.paymentTerms,
          lookup.labels.headings.notIncluded,
          lookup.labels.columns.effort,
          lookup.labels.documentTitles.proposal,
        ]) {
          expect(text, `${format}: ${s}`).not.toContain(s);
        }
        expect(text, format).not.toMatch(/\bpitch\b/i);
        expect(text, format).not.toMatch(/\bskip\b/i);
        expect(text, format).not.toMatch(/lower effort/i);
      }
    });
  }

  it('never reads the Proposal inputs or the overlay (where price and terms live)', () => {
    const view = viewWithEverything();
    const guarded = {
      result: view.result,
      contents: view.contents,
      removedPages: view.removedPages,
    } as EditedAuditView;
    for (const key of ['proposal', 'overlay'] as const) {
      Object.defineProperty(guarded, key, {
        get() {
          throw new Error(`the Owner Audit read view.${key}`);
        },
      });
    }
    expect(() => buildOwnerAudit(guarded, labelsFor('en'))).not.toThrow();
  });

  it('leaves the effort column out of the Improvement Roadmap and the effort line out of every finding', () => {
    const doc = buildOwnerAudit(viewWithEverything(), labelsFor('en'));
    for (const b of doc.blocks) {
      if (b.type === 'table') expect(b.columns).not.toContain(en.columns.effort);
      if (b.type === 'list') for (const item of b.items) expect(item.startsWith(`${en.columns.effort}:`)).toBe(false);
    }
  });
});

describe('Owner Audit: claim wording (ADR 0018, ADR 0029)', () => {
  for (const lang of ['en', 'ta'] as const) {
    it(`${lang}: no ADR 0018 word, no "Ready to release", no verdict`, () => {
      for (const [format, text] of outputs(buildOwnerAudit(viewWithEverything(), labelsFor(lang)))) {
        expect(findClaimWords(text), format).toEqual([]);
        expect(text).not.toContain('Ready to release');
        expect(text).not.toMatch(/verdict/i);
      }
    });
  }

  it('the fixed summary wording makes no claim in either language', () => {
    for (const lang of ['en', 'ta'] as const) {
      for (const value of Object.values(ownerWording(lang))) expect(findClaimWords(value), value).toEqual([]);
    }
  });
});
