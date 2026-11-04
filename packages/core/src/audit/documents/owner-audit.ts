/**
 * The Owner Audit (REQ-025, Q-17): one document for the site owner, made when the owner asks for it. A
 * plain-language summary on top (what was checked, how many findings per group, the top items; no score),
 * then Structure, Content, Findings and the Improvement Roadmap, with every effort value left out.
 *
 * It leaves out the Proposal, the price and the payment terms, and never reads the Shortlist mark, notes
 * or outcome: it reads only `view.result` and `view.contents`, never `view.proposal` or `view.overlay`.
 * Built from the edited view (REQ-020). No release verdict and no claim that a site is fine (ADR 0018).
 */

import type { DocumentLanguage } from '@qa/types';
import { buildContentDocument, contentWording } from './content.js';
import type { EditedAuditView } from './edits.js';
import { buildFindingsDocument, FINDING_GROUP_ORDER } from './findings.js';
import { formatLabel, type LabelLookup } from './labels/index.js';
import type { AuditDoc, DocBlock, HeadingLevel } from './model.js';
import { buildRoadmapDocument } from './roadmap-document.js';
import { buildStructureDocument } from './structure.js';

/** How many findings the summary lists. */
export const OWNER_SUMMARY_TOP_FINDINGS = 5;

/** Fixed wording only the Owner Audit summary uses. `{n}`, `{found}`, `{list}` are filled by `formatLabel`. */
interface OwnerWording {
  intro: string;
  pagesRead: string;
  pagesNotRead: string;
  areasGraded: string;
  areasNotGraded: string;
  findingsPerGroup: string;
  groupCount: string;
  noFindings: string;
  limits: string;
}

const EN: OwnerWording = {
  intro: 'This audit looked at the public pages of the website. Below is a short summary; the details follow.',
  pagesRead: 'Pages read: {n} of {found} found.',
  pagesNotRead: 'Pages not read: {n} ({list}).',
  areasGraded: 'Areas graded by fixed checks: {list}.',
  areasNotGraded: 'Areas not graded: {list}.',
  findingsPerGroup: 'Findings per group',
  groupCount: '{group}: {n}',
  noFindings: 'No issues were recorded on the pages read.',
  limits:
    'This audit covers only what was checked on the pages read; it does not mean the rest of the website has no issues.',
};

// Not yet reviewed by a native speaker.
const TA: OwnerWording = {
  intro:
    'இந்தத் தணிக்கை இணையதளத்தின் பொதுப் பக்கங்களைப் பார்த்தது. கீழே ஒரு சிறு சுருக்கம் உள்ளது; விவரங்கள் அதன் பின் வருகின்றன.',
  pagesRead: 'படித்த பக்கங்கள்: கண்டறிந்த {found} இல் {n}.',
  pagesNotRead: 'படிக்கப்படாத பக்கங்கள்: {n} ({list}).',
  areasGraded: 'நிலையான சோதனைகளால் தரம் பெற்ற துறைகள்: {list}.',
  areasNotGraded: 'தரம் அளிக்கப்படாத துறைகள்: {list}.',
  findingsPerGroup: 'குழுவாரியான கண்டறிதல்கள்',
  groupCount: '{group}: {n}',
  noFindings: 'படித்த பக்கங்களில் சிக்கல்கள் எதுவும் பதிவு செய்யப்படவில்லை.',
  limits:
    'இந்தத் தணிக்கை படித்த பக்கங்களில் சரிபார்க்கப்பட்டவற்றை மட்டுமே உள்ளடக்குகிறது; இணையதளத்தின் மற்ற பகுதிகளில் சிக்கல்கள் இல்லை என்று இது பொருள்படாது.',
};

const WORDING: Partial<Record<DocumentLanguage, OwnerWording>> = { en: EN, ta: TA };

/** The Owner Audit's own wording for `language` (English when the language has no table yet). */
export function ownerWording(language: DocumentLanguage): OwnerWording {
  return WORDING[language] ?? EN;
}

/** The plain-language summary: deterministic, from the edited result only, no score or grade letter. */
function summaryBlocks(view: EditedAuditView, lookup: LabelLookup): DocBlock[] {
  const { labels, language } = lookup;
  const words = ownerWording(language);
  const { result } = view;
  const read = result.pages.length;
  const found = Math.max(result.coverage.found, read);
  const skipped = result.coverage.skipped;
  const reasons = [...new Set(skipped.map((s) => labels.skipReasons[s.why] ?? s.why))];
  const graded = result.siteAreas.filter((a) => a.grade !== null).map((a) => labels.areas[a.area] ?? a.area);
  const notGraded = result.siteAreas.filter((a) => a.grade === null).map((a) => labels.areas[a.area] ?? a.area);

  const checked = [formatLabel(words.pagesRead, { n: read, found })];
  if (skipped.length > 0)
    checked.push(formatLabel(words.pagesNotRead, { n: skipped.length, list: reasons.join(', ') }));
  if (graded.length > 0) checked.push(formatLabel(words.areasGraded, { list: graded.join(', ') }));
  if (notGraded.length > 0) checked.push(formatLabel(words.areasNotGraded, { list: notGraded.join(', ') }));

  const blocks: DocBlock[] = [
    { type: 'heading', level: 1, text: labels.headings.summary },
    { type: 'paragraph', text: `${contentWording(language).website}: ${result.url}` },
    { type: 'paragraph', text: words.intro },
    { type: 'list', items: checked },
    { type: 'heading', level: 2, text: words.findingsPerGroup },
    {
      type: 'list',
      items: FINDING_GROUP_ORDER.map((group) =>
        formatLabel(words.groupCount, {
          group: labels.groups[group],
          n: result.findings.filter((f) => f.group === group).length,
        })
      ),
    },
    { type: 'heading', level: 2, text: labels.headings.topIssues },
  ];

  // The version stores findings ranked: the first ones are the top items (REQ-017).
  const top = result.findings.slice(0, OWNER_SUMMARY_TOP_FINDINGS);
  if (top.length === 0) blocks.push({ type: 'paragraph', text: words.noFindings });
  else {
    blocks.push({
      type: 'list',
      ordered: true,
      items: top.map((f) => {
        const pages = f.pages && f.pages.length > 0 ? f.pages : [f.urlPath];
        return `${f.title} (${labels.columns.page}: ${pages.join(', ')})`;
      }),
    });
  }
  blocks.push({ type: 'note', text: words.limits });
  return blocks;
}

/** One part of the Owner Audit: a page break, the part's title, then its blocks one heading level lower. */
function partBlocks(doc: AuditDoc): DocBlock[] {
  const nested = doc.blocks.map((block): DocBlock =>
    block.type === 'heading' ? { ...block, level: Math.min(4, block.level + 1) as HeadingLevel } : block
  );
  return [{ type: 'pagebreak' }, { type: 'heading', level: 1, text: doc.title }, ...nested];
}

/**
 * The Owner Audit for one edited version, in `lookup`'s language (`labelsFor(lang)`): the summary, then
 * Structure, Content, Findings and Improvement Roadmap with effort left out (REQ-025).
 */
export function buildOwnerAudit(view: EditedAuditView, lookup: LabelLookup): AuditDoc {
  const { labels, language } = lookup;
  const parts = [
    buildStructureDocument(view, { language }),
    buildContentDocument(view, { language }),
    buildFindingsDocument(view, { language, showEffort: false }),
    buildRoadmapDocument(view, lookup, { showEffort: false }),
  ];
  return {
    kind: 'owner-audit',
    title: labels.documentTitles['owner-audit'],
    language: lookup.requested ?? lookup.language,
    blocks: [...summaryBlocks(view, lookup), ...parts.flatMap(partBlocks)],
  };
}
