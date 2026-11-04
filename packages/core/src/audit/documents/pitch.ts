/**
 * The Pitch Glimpse (REQ-019, Q-09): one A4 page for the site owner with the site address, the top 3
 * findings in ranking order (edited text, page cited, one screenshot each), what was checked and what was
 * not, and the opt-out text. English or Tamil; any other language uses English.
 *
 * Built from the edited view only (REQ-020). Rendered through `renderHtml`, so all text is escaped and the
 * file is self-contained (ADR 0021); extra print CSS lays it out on one A4 page and the text is clamped
 * so it fits in both languages. It carries no send action: no form, no mailto: or tel: link, no script.
 * No release verdict and no claim that a site is fine (ADR 0018). Effort is not shown.
 */

import type { AuditFinding, DocumentLanguage } from '@qa/types';
import { contentWording } from './content.js';
import type { EditedAuditView } from './edits.js';
import { formatLabel, labelsFor, type DocumentLabels } from './labels/index.js';
import { isEmbeddableImage, type AuditDoc, type DocBlock } from './model.js';
import { renderHtml } from './render-html.js';
import { defaultOptOutText } from './templates/opt-out.js';

/** How many findings the Pitch Glimpse shows (Q-09). */
export const PITCH_TOP_FINDINGS = 3;

/** Fixed wording only the Pitch Glimpse uses. `{n}`, `{found}`, `{list}` are filled by `formatLabel`. */
interface PitchWording {
  noScreenshot: string;
  whatWasChecked: string;
  pagesRead: string;
  areasGraded: string;
  pagesNotRead: string;
  areasNotGraded: string;
  limits: string;
  noFindings: string;
  moreFindings: string;
}

const EN: PitchWording = {
  noScreenshot: 'No screenshot for this issue.',
  whatWasChecked: 'What was checked',
  pagesRead: 'Pages read: {n} of {found} found.',
  areasGraded: 'Areas graded by fixed checks: {list}.',
  pagesNotRead: 'Pages not read: {n} ({list}).',
  areasNotGraded: 'Areas not graded: {list}.',
  limits: 'This page shows only what automatic checks found on the pages read; other issues may exist.',
  noFindings: 'No issues were recorded on the pages read. This covers only what was checked.',
  moreFindings: '{n} more issues are listed in the full audit.',
};

// Not yet reviewed by a native speaker.
const TA: PitchWording = {
  noScreenshot: 'இந்தச் சிக்கலுக்குத் திரைப்பிடிப்பு இல்லை.',
  whatWasChecked: 'சரிபார்க்கப்பட்டவை',
  pagesRead: 'படித்த பக்கங்கள்: கண்டறிந்த {found} இல் {n}.',
  areasGraded: 'நிலையான சோதனைகளால் தரம் பெற்ற துறைகள்: {list}.',
  pagesNotRead: 'படிக்கப்படாத பக்கங்கள்: {n} ({list}).',
  areasNotGraded: 'தரம் அளிக்கப்படாத துறைகள்: {list}.',
  limits: 'படித்த பக்கங்களில் தானியங்கிச் சோதனைகள் கண்டறிந்தவை மட்டுமே இங்கு உள்ளன; வேறு சிக்கல்களும் இருக்கலாம்.',
  noFindings: 'படித்த பக்கங்களில் சிக்கல்கள் எதுவும் பதிவு செய்யப்படவில்லை. இது சரிபார்க்கப்பட்டவற்றை மட்டுமே குறிக்கிறது.',
  moreFindings: 'மேலும் {n} சிக்கல்கள் முழுத் தணிக்கையில் உள்ளன.',
};

const WORDING: Partial<Record<DocumentLanguage, PitchWording>> = { en: EN, ta: TA };

/** The Pitch Glimpse's own wording for `language` (English when the language has no table yet). */
export function pitchWording(language: DocumentLanguage): PitchWording {
  return WORDING[language] ?? EN;
}

/** Longest text per field, in characters. Tamil script runs wider per character, so its limits are lower. */
interface ClampLimits {
  url: number;
  title: number;
  pages: number;
  detail: number;
  suggestion: number;
}

const LIMITS_EN: ClampLimits = { url: 100, title: 90, pages: 90, detail: 220, suggestion: 160 };
const LIMITS_TA: ClampLimits = { url: 100, title: 70, pages: 90, detail: 160, suggestion: 120 };

/** The clamp limits used for `language`. */
export function pitchLimits(language: DocumentLanguage): ClampLimits {
  return language === 'ta' ? LIMITS_TA : LIMITS_EN;
}

/**
 * `text` on one line, cut to at most `max` characters (code points) at a word boundary when one is near,
 * ending with an ellipsis when cut.
 */
export function clampText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  const cut = chars.slice(0, Math.max(1, max - 1)).join('');
  const space = cut.lastIndexOf(' ');
  const head = space >= cut.length * 0.6 ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s,;:.\-–—]+$/u, '')}…`;
}

// Print layout for one A4 page: smaller type and spacing than an Audit Document, and each screenshot
// floated beside its finding's text at a fixed maximum height. Inline only, like the base CSS.
const PITCH_CSS = `
  @page { size: A4; margin: 12mm 14mm; }
  body { font-size: 10pt; line-height: 1.4; }
  main { padding: 1rem 1.25rem; }
  h1 { font-size: 16pt; margin: 0 0 2mm; }
  h2 { font-size: 12.5pt; margin: 4mm 0 2mm; clear: both; }
  h3 { font-size: 11pt; margin: 3mm 0 1mm; clear: both; }
  p { margin: 0 0 1mm; }
  figure { float: right; float: inline-end; width: 62mm; margin: 0 0 2mm 4mm; margin-inline: 4mm 0; }
  figure img { display: block; max-width: 100%; max-height: 40mm; width: auto; object-fit: contain; }
  .note { padding: 1mm 3mm; margin: 0 0 2mm; clear: both; }
  @media print {
    main { padding: 0; }
    h1 { font-size: 15pt; }
  }
`;

export interface PitchGlimpseOptions {
  /** The language of the page; defaults to the version's language. */
  language?: DocumentLanguage;
  /** The tool user's saved opt-out text per language; a missing or blank one uses the default (BE-504). */
  optOutText?: Partial<Record<DocumentLanguage, string>>;
  /** Screenshots as base64 `data:image/...` URIs, keyed by the finding's `screenshotPath`. */
  screenshots?: Readonly<Record<string, string>>;
}

function screenshotFor(finding: AuditFinding, screenshots: Readonly<Record<string, string>>): string | undefined {
  const path = finding.screenshotPath;
  if (!path || !Object.prototype.hasOwnProperty.call(screenshots, path)) return undefined;
  const src = screenshots[path];
  return typeof src === 'string' && isEmbeddableImage(src) ? src : undefined;
}

function findingBlocks(
  finding: AuditFinding,
  rank: number,
  screenshot: string | undefined,
  labels: DocumentLabels,
  words: PitchWording,
  limits: ClampLimits,
): DocBlock[] {
  const title = clampText(finding.title, limits.title);
  const pages = finding.pages && finding.pages.length > 0 ? finding.pages : [finding.urlPath];
  const blocks: DocBlock[] = [{ type: 'heading', level: 2, text: `${rank}. ${title}` }];
  if (screenshot) blocks.push({ type: 'image', src: screenshot, alt: title });
  const advisory = finding.advisory === true || finding.source === 'ai';
  const pageLine = `${labels.columns.page}: ${clampText(pages.join(', '), limits.pages)}`;
  blocks.push({ type: 'paragraph', text: advisory ? `${pageLine} · ${labels.status.aiNote}` : pageLine });
  blocks.push({ type: 'paragraph', text: `${labels.columns.found}: ${clampText(finding.detail, limits.detail)}` });
  blocks.push({
    type: 'paragraph',
    text: `${labels.columns.suggestedFix}: ${clampText(finding.suggestion, limits.suggestion)}`,
  });
  if (!screenshot) blocks.push({ type: 'note', text: words.noScreenshot });
  return blocks;
}

/** What was checked and what was not: pages read, Skipped Pages by reason, areas with and without a grade. */
function coverageBlocks(view: EditedAuditView, labels: DocumentLabels, words: PitchWording): DocBlock[] {
  const { result } = view;
  const read = result.pages.length;
  const found = Math.max(result.coverage.found, read);
  const graded = result.siteAreas.filter((a) => a.grade !== null).map((a) => labels.areas[a.area] ?? a.area);
  const notGraded = result.siteAreas.filter((a) => a.grade === null).map((a) => labels.areas[a.area] ?? a.area);
  const skipped = result.coverage.skipped;
  const reasons = [...new Set(skipped.map((s) => labels.skipReasons[s.why] ?? s.why))];

  const checked = [formatLabel(words.pagesRead, { n: read, found })];
  if (graded.length > 0) checked.push(formatLabel(words.areasGraded, { list: graded.join(', ') }));
  const notChecked: string[] = [];
  if (skipped.length > 0) notChecked.push(formatLabel(words.pagesNotRead, { n: skipped.length, list: reasons.join(', ') }));
  if (notGraded.length > 0) notChecked.push(formatLabel(words.areasNotGraded, { list: notGraded.join(', ') }));
  notChecked.push(words.limits);

  return [
    { type: 'heading', level: 1, text: words.whatWasChecked },
    { type: 'paragraph', text: checked.join(' ') },
    { type: 'heading', level: 1, text: labels.headings.whatThisDidNotCheck },
    { type: 'paragraph', text: notChecked.join(' ') },
  ];
}

/** The opt-out text for the page: the tool user's saved text for `requested`, else the default. */
function optOutFor(
  requested: DocumentLanguage,
  language: DocumentLanguage,
  saved: Partial<Record<DocumentLanguage, string>> | undefined,
): string {
  const own = saved && Object.prototype.hasOwnProperty.call(saved, requested) ? saved[requested] : undefined;
  return typeof own === 'string' && own.trim() !== '' ? own.trim() : defaultOptOutText(language);
}

/** The Pitch Glimpse as an `AuditDoc`, before rendering. */
export function pitchGlimpseDoc(view: EditedAuditView, options: PitchGlimpseOptions = {}): AuditDoc {
  const lookup = labelsFor(options.language ?? view.result.language);
  const { labels, language } = lookup;
  const words = pitchWording(language);
  const limits = pitchLimits(language);
  const screenshots = options.screenshots ?? {};
  const { result } = view;

  const blocks: DocBlock[] = [
    { type: 'paragraph', text: `${contentWording(language).website}: ${clampText(result.url, limits.url)}` },
    { type: 'heading', level: 1, text: labels.headings.topIssues },
  ];

  // The version stores findings ranked: the first three are the top three (REQ-017).
  const top = result.findings.slice(0, PITCH_TOP_FINDINGS);
  if (top.length === 0) blocks.push({ type: 'paragraph', text: words.noFindings });
  top.forEach((finding, i) => {
    blocks.push(...findingBlocks(finding, i + 1, screenshotFor(finding, screenshots), labels, words, limits));
  });
  const more = result.findings.length - top.length;
  if (more > 0) blocks.push({ type: 'paragraph', text: formatLabel(words.moreFindings, { n: more }) });

  blocks.push(...coverageBlocks(view, labels, words));
  blocks.push({ type: 'heading', level: 1, text: labels.headings.optOut });
  blocks.push({ type: 'paragraph', text: optOutFor(lookup.requested, language, options.optOutText) });

  return { kind: 'pitch-glimpse', title: labels.documentTitles['pitch-glimpse'], language: lookup.requested ?? lookup.language, blocks };
}

/** The Pitch Glimpse as one self-contained HTML file laid out on one A4 page (REQ-019). */
export function buildPitchGlimpse(view: EditedAuditView, options: PitchGlimpseOptions = {}): string {
  const html = renderHtml(pitchGlimpseDoc(view, options));
  return html.replace('</head>', () => `<style>${PITCH_CSS}</style>\n</head>`);
}
