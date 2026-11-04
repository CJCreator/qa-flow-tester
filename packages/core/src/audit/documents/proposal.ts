/**
 * The Proposal Audit Document (REQ-027, Q-19): the tool user's Markdown template filled with one edited
 * audit's data.
 *
 * Template syntax: `#` to `#####` headings (a `#` heading on the first line is the document title), `-`,
 * `*` or `+` list items, `1.` numbered items, `>` notes, and paragraphs separated by blank lines. Other
 * inline Markdown is shown as written. Placeholders are `{{name}}` (see `PROPOSAL_PLACEHOLDERS`); a block
 * placeholder alone on its line becomes a table or list, anywhere else it becomes one line of text.
 *
 * Safety: the template's structure is read before any value is put in, values are put in in one pass (a
 * value is never searched for placeholders again), and every value goes into a block as plain text that
 * the renderers escape. So audit text and the tool user's inputs can add neither placeholders nor
 * Markdown or HTML structure. Unknown placeholders stay visible as written and are reported.
 */

import type { AuditFindingGroup, CompanyDetails, DocumentLanguage, PageAction, ProposalInputs } from '@qa/types';
import type { EditedAuditView } from './edits.js';
import type { AuditDoc, DocBlock, HeadingLevel } from './model.js';
import { labelLanguages, labelsFor, phaseLabel, type DocumentLabels } from './labels/index.js';
import { PROPOSAL_FILL_IN_EN, PROPOSAL_NOT_INCLUDED_EN } from './templates/proposal-en.js';
import { PROPOSAL_FILL_IN_TA, PROPOSAL_NOT_INCLUDED_TA } from './templates/proposal-ta.js';

/** Every placeholder a Proposal template may use, with what it is filled with (for the settings screen). */
export const PROPOSAL_PLACEHOLDERS = [
  { name: 'findings_summary', description: 'How many findings per group, and the top findings with their page.' },
  { name: 'scope', description: 'Each page with redesign or repair, as edited.' },
  { name: 'not_included', description: 'The "not included" lines of this audit, or the default list.' },
  { name: 'price', description: 'The price in INR as written for this audit; a "to fill in" marker when empty.' },
  {
    name: 'payment_terms',
    description: 'The payment terms as written for this audit; a "to fill in" marker when empty.',
  },
  { name: 'timeline', description: 'The Improvement Roadmap phases and their items.' },
  { name: 'company.name', description: 'Your company name.' },
  { name: 'company.address', description: 'Your company address.' },
  { name: 'company.phone', description: 'Your company phone number.' },
  { name: 'company.email', description: 'Your company email address.' },
  { name: 'company.website', description: 'Your company website.' },
  { name: 'company.terms', description: 'Your terms and conditions.' },
  { name: 'site.url', description: 'The address of the audited website.' },
  { name: 'date', description: 'The date the Proposal is made (YYYY-MM-DD).' },
] as const;

export type ProposalPlaceholder = (typeof PROPOSAL_PLACEHOLDERS)[number]['name'];

/** Placeholders that become a table or list when alone on their line. */
const BLOCK_PLACEHOLDERS: ReadonlySet<string> = new Set(['findings_summary', 'scope', 'not_included', 'timeline']);

/** How many top findings the summary table lists. */
export const PROPOSAL_TOP_FINDINGS = 5;

const GROUP_ORDER: readonly AuditFindingGroup[] = ['technical', 'marketing', 'content'];

/** Per-language wording the label tables do not hold. Languages without an entry use English. */
const PROPOSAL_WORDING: Partial<Record<DocumentLanguage, { notIncluded: readonly string[]; fillIn: string }>> = {
  en: { notIncluded: PROPOSAL_NOT_INCLUDED_EN, fillIn: PROPOSAL_FILL_IN_EN },
  ta: { notIncluded: PROPOSAL_NOT_INCLUDED_TA, fillIn: PROPOSAL_FILL_IN_TA },
};

export interface FillProposalOptions {
  /** The document's language; by default the language of `labels`. */
  language?: DocumentLanguage;
  /** The date for `{{date}}`; now by default. */
  now?: Date | string;
}

export interface FilledProposal {
  doc: AuditDoc;
  /** Placeholders the template uses that are not in `PROPOSAL_PLACEHOLDERS`, as written, each once. */
  unknownPlaceholders: string[];
}

/** The `PROPOSAL_NOT_INCLUDED_*` list for `lang`, English when it has none. */
export function defaultNotIncluded(lang: DocumentLanguage): string[] {
  return [...(PROPOSAL_WORDING[lang] ?? PROPOSAL_WORDING.en!).notIncluded];
}

// ---------------------------------------------------------------------------------------------------
// Reading the template
// ---------------------------------------------------------------------------------------------------

type RawBlock =
  | { type: 'heading'; depth: number; text: string }
  | { type: 'paragraph'; lines: string[] }
  | { type: 'note'; lines: string[] }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'placeholder'; name: string };

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,9}[.)]\s+(.*)$/;
const NOTE = /^\s*>\s?(.*)$/;
const ALONE = /^\s*\{\{\s*([A-Za-z0-9_.]+)\s*\}\}\s*$/;
/** One placeholder: `{{name}}`, spaces inside the braces allowed. */
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

function readTemplate(template: string): RawBlock[] {
  const out: RawBlock[] = [];
  let open: RawBlock | null = null;
  const close = () => {
    if (open) out.push(open);
    open = null;
  };
  for (const line of template.split(/\r?\n/)) {
    if (line.trim() === '') {
      close();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      close();
      out.push({ type: 'heading', depth: heading[1].length, text: heading[2] });
      continue;
    }
    const alone = ALONE.exec(line);
    if (alone && BLOCK_PLACEHOLDERS.has(alone[1])) {
      close();
      out.push({ type: 'placeholder', name: alone[1] });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = numbered !== null;
      const item = (bullet ?? numbered)![1];
      const current = open as RawBlock | null;
      if (current?.type === 'list' && current.ordered === ordered) current.items.push(item);
      else {
        close();
        open = { type: 'list', ordered, items: [item] };
      }
      continue;
    }
    const note = NOTE.exec(line);
    const type = note ? 'note' : 'paragraph';
    const text = note ? note[1] : line.trim();
    const current = open as RawBlock | null;
    if (current?.type === type) current.lines.push(text);
    else {
      close();
      open = { type, lines: [text] };
    }
  }
  close();
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The values
// ---------------------------------------------------------------------------------------------------

interface PlaceholderValue {
  /** Used inside a line of text. */
  inline: string;
  /** Used when a block placeholder stands alone on its line. */
  blocks?: DocBlock[];
}

function findingsSummary(view: EditedAuditView, labels: DocumentLabels): PlaceholderValue {
  const findings = view.result.findings;
  if (findings.length === 0) {
    return { inline: labels.status.noneFound, blocks: [{ type: 'paragraph', text: labels.status.noneFound }] };
  }
  const counts = GROUP_ORDER.map((g) => [g, findings.filter((f) => f.group === g).length] as const)
    .filter(([, n]) => n > 0)
    .map(([g, n]) => `${labels.groups[g]}: ${n}`);
  return {
    inline: counts.join(', '),
    blocks: [
      { type: 'list', items: counts },
      {
        type: 'table',
        columns: [labels.columns.issue, labels.columns.page, labels.columns.impact],
        rows: findings.slice(0, PROPOSAL_TOP_FINDINGS).map((f) => [f.title, f.urlPath, labels.scale[f.impact]]),
      },
    ],
  };
}

/**
 * Redesign or repair per page kept, in page order. A page's own edit wins; a covered page otherwise takes
 * its Sample Page's (edited) recommendation. The reason is shown only for a Sample Page whose action was
 * not edited, since an edited action may no longer match the reason written for the original.
 */
function scope(view: EditedAuditView, labels: DocumentLabels): PlaceholderValue {
  const edits = new Map<string, PageAction>(view.overlay.recommendations.map((e) => [e.urlPath, e.action]));
  const byPath = new Map(view.result.pages.map((p) => [p.urlPath, p]));
  const rows: string[][] = [];
  for (const page of view.result.pages) {
    const own = page.recommendation;
    const sample = page.sampleUrlPath !== undefined ? byPath.get(page.sampleUrlPath)?.recommendation : undefined;
    const action = edits.get(page.urlPath) ?? own?.action ?? sample?.action;
    if (!action) continue;
    const reason = own && !edits.has(page.urlPath) ? own.reason : '';
    rows.push([page.urlPath, labels.actions[action], reason]);
  }
  if (rows.length === 0) {
    return { inline: labels.status.noneFound, blocks: [{ type: 'paragraph', text: labels.status.noneFound }] };
  }
  return {
    inline: rows.map(([page, action]) => `${page}: ${action}`).join('; '),
    blocks: [{ type: 'table', columns: [labels.columns.page, labels.columns.work, labels.columns.reason], rows }],
  };
}

function notIncluded(inputs: ProposalInputs, language: DocumentLanguage): PlaceholderValue {
  const lines = inputs.notIncluded ?? defaultNotIncluded(language);
  return { inline: lines.join(', '), blocks: lines.length > 0 ? [{ type: 'list', items: [...lines] }] : [] };
}

/** The Improvement Roadmap by phase, first phase first; items keep their roadmap order. */
function timeline(view: EditedAuditView, labels: DocumentLabels): PlaceholderValue {
  const phases = [...new Set(view.result.roadmap.map((item) => item.phase))].sort((a, b) => a - b);
  if (phases.length === 0) {
    return { inline: labels.status.noneFound, blocks: [{ type: 'paragraph', text: labels.status.noneFound }] };
  }
  const blocks: DocBlock[] = [];
  const inline: string[] = [];
  for (const phase of phases) {
    const items = view.result.roadmap
      .filter((item) => item.phase === phase)
      .map((item) => (item.pages.length > 0 ? `${item.title} (${item.pages.join(', ')})` : item.title));
    const label = phaseLabel(labels, phase);
    blocks.push({ type: 'paragraph', text: label }, { type: 'list', items });
    inline.push(`${label}: ${items.join(', ')}`);
  }
  return { inline: inline.join('; '), blocks };
}

function dateOf(now: Date | string | undefined): string {
  const date = now === undefined ? new Date() : new Date(now);
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

/** The language of a label table: the first language whose table it is, else English. */
function languageOf(labels: DocumentLabels): DocumentLanguage {
  return labelLanguages().find((lang) => labelsFor(lang).labels === labels) ?? 'en';
}

// ---------------------------------------------------------------------------------------------------
// Filling
// ---------------------------------------------------------------------------------------------------

/**
 * Fills a Proposal template with one edited audit (REQ-027 AC-2) and returns the Proposal Audit Document.
 * The template's own text and order are kept. Pages removed in the edits are already gone from `view`,
 * so neither the scope nor the timeline lists them. An empty price or payment terms shows the "to fill in"
 * marker. Unknown placeholders stay as written and are listed in `unknownPlaceholders`.
 */
export function fillProposal(
  template: string,
  view: EditedAuditView,
  inputs: ProposalInputs,
  company: CompanyDetails,
  labels: DocumentLabels,
  options: FillProposalOptions = {}
): FilledProposal {
  const language = options.language ?? languageOf(labels);
  const fillIn = (PROPOSAL_WORDING[language] ?? PROPOSAL_WORDING.en!).fillIn;
  const filled = (value: string | undefined) => (value === undefined || value.trim() === '' ? fillIn : value);

  const values = new Map<string, PlaceholderValue>([
    ['findings_summary', findingsSummary(view, labels)],
    ['scope', scope(view, labels)],
    ['not_included', notIncluded(inputs, language)],
    ['price', { inline: filled(inputs.price) }],
    ['payment_terms', { inline: filled(inputs.paymentTerms) }],
    ['timeline', timeline(view, labels)],
    ['company.name', { inline: company.name ?? '' }],
    ['company.address', { inline: company.address ?? '' }],
    ['company.phone', { inline: company.phone ?? '' }],
    ['company.email', { inline: company.email ?? '' }],
    ['company.website', { inline: company.website ?? '' }],
    ['company.terms', { inline: company.terms ?? '' }],
    ['site.url', { inline: view.result.url }],
    ['date', { inline: dateOf(options.now) }],
  ]);

  const unknown: string[] = [];
  // One pass over the template's own text: the replacement is never searched again.
  const fill = (text: string): string =>
    text.replace(PLACEHOLDER, (whole: string, name: string) => {
      const value = values.get(name);
      if (value) return value.inline;
      if (!unknown.includes(whole)) unknown.push(whole);
      return whole;
    });

  const raw = readTemplate(template);
  let title = labels.documentTitles.proposal;
  if (raw[0]?.type === 'heading' && raw[0].depth === 1) {
    title = fill(raw[0].text);
    raw.shift();
  }

  const blocks: DocBlock[] = [];
  for (const block of raw) {
    switch (block.type) {
      case 'heading':
        blocks.push({
          type: 'heading',
          level: Math.max(1, Math.min(4, block.depth - 1)) as HeadingLevel,
          text: fill(block.text),
        });
        break;
      case 'paragraph':
        blocks.push({ type: 'paragraph', text: fill(block.lines.join('\n')) });
        break;
      case 'note':
        blocks.push({ type: 'note', text: fill(block.lines.join('\n')) });
        break;
      case 'list':
        blocks.push({ type: 'list', ...(block.ordered ? { ordered: true } : {}), items: block.items.map(fill) });
        break;
      case 'placeholder':
        blocks.push(...structuredClone(values.get(block.name)!.blocks ?? []));
        break;
    }
  }

  return { doc: { kind: 'proposal', title, language, blocks }, unknownPlaceholders: unknown };
}
