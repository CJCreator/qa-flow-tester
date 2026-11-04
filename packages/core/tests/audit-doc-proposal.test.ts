import { describe, it, expect } from 'vitest';
import type { CompanyDetails, EditOverlay } from '@qa/types';
import {
  buildEditedView,
  emptyOverlay,
  mergeEditsPatch,
  validateAuditEditsPatch,
} from '../src/audit/documents/edits.js';
import type { AuditDoc, DocBlock } from '../src/audit/documents/model.js';
import { fillProposal, PROPOSAL_PLACEHOLDERS } from '../src/audit/documents/proposal.js';
import { renderMarkdown } from '../src/audit/documents/render-markdown.js';
import { renderHtml } from '../src/audit/documents/render-html.js';
import { findClaimWords } from '../src/audit/documents/wording.js';
import { en } from '../src/audit/documents/labels/en.js';
import { ta } from '../src/audit/documents/labels/ta.js';
import { phaseLabel } from '../src/audit/documents/labels/index.js';
import {
  PROPOSAL_FILL_IN_EN,
  PROPOSAL_NOT_INCLUDED_EN,
  PROPOSAL_TEMPLATE_EN,
} from '../src/audit/documents/templates/proposal-en.js';
import {
  PROPOSAL_FILL_IN_TA,
  PROPOSAL_NOT_INCLUDED_TA,
  PROPOSAL_TEMPLATE_TA,
} from '../src/audit/documents/templates/proposal-ta.js';
import { auditDocContents, auditDocResult, FIXTURE_URL, PATHS } from './helpers/audit-doc-fixture.js';

const NOW = '2026-11-03T10:00:00.000Z';

const COMPANY: CompanyDetails = {
  name: 'Kavi Web Works',
  address: '12 Anna Salai, Chennai',
  phone: '044 9876 5432',
  email: 'hello@kavi.example',
  website: 'https://kavi.example',
  terms: 'Work starts after the first payment.',
};

function overlayOf(patch: unknown, base: EditOverlay = emptyOverlay()): EditOverlay {
  const checked = validateAuditEditsPatch(patch);
  if (!checked.ok) throw new Error(`patch refused: ${JSON.stringify(checked.errors)}`);
  return mergeEditsPatch(base, checked.value, NOW);
}

function viewOf(patch?: unknown) {
  return buildEditedView(auditDocResult(), auditDocContents(), patch ? overlayOf(patch) : emptyOverlay());
}

function blocksOf<T extends DocBlock['type']>(doc: AuditDoc, type: T): Array<Extract<DocBlock, { type: T }>> {
  return doc.blocks.filter((b): b is Extract<DocBlock, { type: T }> => b.type === type);
}

/** The table whose first column is the Page column of `labels`. */
function scopeTable(doc: AuditDoc, pageColumn = en.columns.page, workColumn = en.columns.work) {
  return blocksOf(doc, 'table').find((t) => t.columns[0] === pageColumn && t.columns[1] === workColumn);
}

/** Every piece of text in the document, one string. */
function allText(doc: AuditDoc): string {
  const parts: string[] = [doc.title];
  for (const b of doc.blocks) {
    if (b.type === 'heading' || b.type === 'paragraph' || b.type === 'note') parts.push(b.text);
    if (b.type === 'list') parts.push(...b.items);
    if (b.type === 'table') parts.push(...b.columns, ...b.rows.flat());
  }
  return parts.join('\n');
}

const EDITED_TEMPLATE = `# Offer for {{site.url}}

Dear owner, this is our own opening line.

## Our terms first

{{company.terms}}

## Money

Price: {{price}}
Terms: {{payment_terms}}

## Plan of work

{{timeline}}

## Pages

{{scope}}

## Left out

{{not_included}}

## Summary

{{findings_summary}}

> Sent by {{company.name}} ({{company.email}}, {{company.phone}}) on {{date}}.

1. Address: {{company.address}}
2. Web: {{company.website}}
`;

describe('fillProposal: an edited template', () => {
  const view = viewOf({ proposal: { price: '₹45,000 + GST', paymentTerms: '50% advance, 50% on delivery' } });
  const { doc, unknownPlaceholders } = fillProposal(EDITED_TEMPLATE, view, view.proposal, COMPANY, en, { now: NOW });

  it('keeps the template text and order and reports nothing unknown', () => {
    expect(unknownPlaceholders).toEqual([]);
    expect(doc.kind).toBe('proposal');
    expect(doc.language).toBe('en');
    expect(doc.title).toBe(`Offer for ${FIXTURE_URL}`);
    const headings = blocksOf(doc, 'heading').map((h) => h.text);
    expect(headings).toEqual(['Our terms first', 'Money', 'Plan of work', 'Pages', 'Left out', 'Summary']);
    expect(doc.blocks[0]).toEqual({ type: 'paragraph', text: 'Dear owner, this is our own opening line.' });
    // Template order: the timeline comes before the scope, the summary last.
    const indexOf = (pred: (b: DocBlock) => boolean) => doc.blocks.findIndex(pred);
    const timelineAt = indexOf((b) => b.type === 'paragraph' && b.text === phaseLabel(en, 1));
    const scopeAt = indexOf((b) => b.type === 'table' && b.columns[1] === en.columns.work);
    const summaryAt = indexOf((b) => b.type === 'table' && b.columns[0] === en.columns.issue);
    expect(timelineAt).toBeGreaterThan(0);
    expect(scopeAt).toBeGreaterThan(timelineAt);
    expect(summaryAt).toBeGreaterThan(scopeAt);
  });

  it('fills price and payment terms as entered and the company details', () => {
    expect(doc.blocks).toContainEqual({
      type: 'paragraph',
      text: 'Price: ₹45,000 + GST\nTerms: 50% advance, 50% on delivery',
    });
    expect(doc.blocks).toContainEqual({ type: 'paragraph', text: COMPANY.terms });
    expect(doc.blocks).toContainEqual({
      type: 'note',
      text: `Sent by ${COMPANY.name} (${COMPANY.email}, ${COMPANY.phone}) on 2026-11-03.`,
    });
    expect(doc.blocks).toContainEqual({
      type: 'list',
      ordered: true,
      items: [`Address: ${COMPANY.address}`, `Web: ${COMPANY.website}`],
    });
  });

  it('fills the scope with redesign or repair per page, covered pages taking their Sample Page', () => {
    const table = scopeTable(doc)!;
    expect(table.columns).toEqual([en.columns.page, en.columns.work, en.columns.reason]);
    expect(table.rows).toEqual([
      [PATHS.home, 'Repair', 'The layout works; the call to action needs moving.'],
      [PATHS.about, 'Redesign', ''],
      [PATHS.team, 'Redesign', ''],
      [PATHS.services, 'Redesign', 'The page has no clear offer and no description.'],
      [PATHS.tamil, 'Repair', 'Only the text is thin.'],
    ]);
  });

  it('fills the timeline from the Improvement Roadmap by phase', () => {
    const i = doc.blocks.findIndex((b) => b.type === 'paragraph' && b.text === phaseLabel(en, 1));
    expect(doc.blocks.slice(i, i + 4)).toEqual([
      { type: 'paragraph', text: 'Phase 1: Quick fixes' },
      { type: 'list', items: ['Give every page its own title (/about, /services)', 'Add alt text to images (/about)'] },
      { type: 'paragraph', text: 'Phase 2: Main improvements' },
      {
        type: 'list',
        items: [
          'Write meta descriptions (/services, /about/team)',
          'Strengthen calls to action and thin pages (/, /ta)',
        ],
      },
    ]);
  });

  it('fills the findings summary and the default "not included" list', () => {
    expect(doc.blocks).toContainEqual({ type: 'list', items: ['Technical: 3', 'Marketing: 1', 'Content: 2'] });
    const summary = blocksOf(doc, 'table').find((t) => t.columns[0] === en.columns.issue)!;
    expect(summary.rows[0]).toEqual(['Two pages share one title', PATHS.about, 'High']);
    expect(summary.rows).toHaveLength(5);
    expect(doc.blocks).toContainEqual({ type: 'list', items: [...PROPOSAL_NOT_INCLUDED_EN] });
  });

  it('renders to Markdown and HTML with the filled text', () => {
    const md = renderMarkdown(doc);
    expect(md).toContain('Dear owner, this is our own opening line.');
    expect(md).toContain('Price: ₹45,000 + GST');
    expect(md.indexOf('## Our terms first')).toBeLessThan(md.indexOf('## Money'));
    expect(renderHtml(doc)).toContain('Kavi Web Works');
  });
});

describe('fillProposal: edits', () => {
  it('leaves a removed page out of the scope and the timeline', () => {
    const view = viewOf({ removePages: [PATHS.services] });
    const { doc } = fillProposal(PROPOSAL_TEMPLATE_EN, view, view.proposal, COMPANY, en, { now: NOW });
    const table = scopeTable(doc)!;
    expect(table.rows.map((r) => r[0])).not.toContain(PATHS.services);
    const lists = blocksOf(doc, 'list').flatMap((l) => l.items);
    expect(lists.some((item) => item.includes(PATHS.services))).toBe(false);
    expect(lists).toContain('Give every page its own title (/about)');
  });

  it('uses the edited redesign-or-repair choice and drops the original reason', () => {
    const view = viewOf({ recommendations: [{ urlPath: PATHS.home, action: 'redesign' }] });
    const { doc } = fillProposal(PROPOSAL_TEMPLATE_EN, view, view.proposal, COMPANY, en, { now: NOW });
    expect(scopeTable(doc)!.rows[0]).toEqual([PATHS.home, 'Redesign', '']);
  });

  it('lists the tool user\'s own "not included" lines', () => {
    const view = viewOf({ proposal: { notIncluded: ['Logo design', 'Photography'] } });
    const { doc } = fillProposal('{{not_included}}', view, view.proposal, COMPANY, en, { now: NOW });
    expect(doc.blocks).toEqual([{ type: 'list', items: ['Logo design', 'Photography'] }]);
  });

  it('shows a visible "to fill in" marker for an empty price or payment terms', () => {
    const view = viewOf({ proposal: { price: '  ' } });
    const filled = fillProposal('{{price}} / {{payment_terms}}', view, view.proposal, COMPANY, en, { now: NOW });
    expect(filled.doc.blocks).toEqual([{ type: 'paragraph', text: `${PROPOSAL_FILL_IN_EN} / ${PROPOSAL_FILL_IN_EN}` }]);
    const tamil = fillProposal('{{price}}', view, {}, COMPANY, ta, { now: NOW });
    expect(tamil.doc.blocks).toEqual([{ type: 'paragraph', text: PROPOSAL_FILL_IN_TA }]);
    expect(tamil.doc.language).toBe('ta');
  });

  it('carries the requested language on a fallback document and keeps the English wording (DEC-005)', () => {
    const view = viewOf();
    const filled = fillProposal('{{price}}\n\n{{not_included}}', view, {}, COMPANY, en, { now: NOW, language: 'hi' });
    expect(filled.doc.language).toBe('hi');
    expect(filled.doc.blocks).toEqual([
      { type: 'paragraph', text: PROPOSAL_FILL_IN_EN },
      { type: 'list', items: [...PROPOSAL_NOT_INCLUDED_EN] },
    ]);
  });
});

describe('fillProposal: placeholders and escaping', () => {
  it('leaves an unknown placeholder visible and reports it once', () => {
    const view = viewOf();
    const { doc, unknownPlaceholders } = fillProposal(
      'Hello {{client_name}}, {{ client_name }} and {{client_name}}.\n\n## {{nope}}',
      view,
      {},
      COMPANY,
      en,
      { now: NOW }
    );
    expect(unknownPlaceholders).toEqual(['{{client_name}}', '{{ client_name }}', '{{nope}}']);
    expect(doc.blocks[0]).toEqual({
      type: 'paragraph',
      text: 'Hello {{client_name}}, {{ client_name }} and {{client_name}}.',
    });
    expect(doc.blocks[1]).toEqual({ type: 'heading', level: 1, text: '{{nope}}' });
    expect(doc.title).toBe(en.documentTitles.proposal);
  });

  it("never expands placeholders found in audit text or the tool user's inputs", () => {
    const view = viewOf({
      findings: [{ findingId: 'AF-001', title: 'Fix {{price}} and {{unknown_x}}' }],
      proposal: { price: 'See {{company.terms}}', paymentTerms: '{{date}}' },
    });
    const { doc, unknownPlaceholders } = fillProposal(
      '{{price}} | {{payment_terms}} | {{findings_summary}}\n\n{{findings_summary}}',
      view,
      view.proposal,
      COMPANY,
      en,
      { now: NOW }
    );
    expect(unknownPlaceholders).toEqual([]);
    expect(doc.blocks[0]).toEqual({
      type: 'paragraph',
      text: 'See {{company.terms}} | {{date}} | Technical: 3, Marketing: 1, Content: 2',
    });
    const summary = blocksOf(doc, 'table')[0];
    expect(summary.rows[0][0]).toBe('Fix {{price}} and {{unknown_x}}');
    expect(allText(doc)).not.toContain(COMPANY.terms);
  });

  it('keeps Markdown in values as text: no new headings, lists or HTML', () => {
    const view = viewOf({ proposal: { price: '# Free\n- <script>x</script>' } });
    const { doc } = fillProposal('{{price}}', view, view.proposal, COMPANY, en, { now: NOW });
    expect(doc.blocks).toEqual([{ type: 'paragraph', text: '# Free\n- <script>x</script>' }]);
    const md = renderMarkdown(doc);
    expect(md).not.toMatch(/^#+ Free/m);
    expect(md).not.toContain('<script>');
    expect(md).toContain('\\# Free');
  });

  it('uses the inline form of a block placeholder inside a line', () => {
    const view = viewOf();
    const { doc } = fillProposal('Pages: {{scope}}\n\nWork: {{timeline}}', view, {}, COMPANY, en, { now: NOW });
    expect(doc.blocks[0]).toEqual({
      type: 'paragraph',
      text: 'Pages: /: Repair; /about: Redesign; /about/team: Redesign; /services: Redesign; /ta: Repair',
    });
    expect((doc.blocks[1] as { text: string }).text.startsWith('Work: Phase 1: Quick fixes: Give every page')).toBe(
      true
    );
  });
});

describe('default Proposal templates', () => {
  const cases = [
    { name: 'English', template: PROPOSAL_TEMPLATE_EN, labels: en, notIncluded: PROPOSAL_NOT_INCLUDED_EN },
    { name: 'Tamil', template: PROPOSAL_TEMPLATE_TA, labels: ta, notIncluded: PROPOSAL_NOT_INCLUDED_TA },
  ];

  for (const c of cases) {
    it(`${c.name}: uses every documented placeholder and only those`, () => {
      for (const p of PROPOSAL_PLACEHOLDERS) expect(c.template).toContain(`{{${p.name}}}`);
      const view = viewOf({ proposal: { price: '₹45,000', paymentTerms: 'Advance' } });
      const { doc, unknownPlaceholders } = fillProposal(c.template, view, view.proposal, COMPANY, c.labels, {
        now: NOW,
      });
      expect(unknownPlaceholders).toEqual([]);
      expect(allText(doc)).not.toMatch(/\{\{/);
      expect(doc.title).toContain(FIXTURE_URL);
      expect(scopeTable(doc, c.labels.columns.page, c.labels.columns.work)).toBeDefined();
      expect(doc.blocks).toContainEqual({ type: 'list', items: [...c.notIncluded] });
    });

    it(`${c.name}: fixed text uses no ADR 0018 word`, () => {
      expect(c.template.trim().length).toBeGreaterThan(0);
      expect(findClaimWords(c.template)).toEqual([]);
      expect(findClaimWords(c.notIncluded.join('\n'))).toEqual([]);
    });
  }
});
