/**
 * Fixed UI wording for the Website Audit analysis views (HierarchyView, PageContentView, PageFactsView,
 * FindingsList). Terms follow CONTEXT.md; claims follow ADR 0018 (found or not found, never a claim about
 * the whole site) and ADR 0033 (a Website Audit has no release verdict).
 */
import {
  DOCUMENT_LANGUAGE_INFO,
  isDocumentLanguage,
  AUDIT_SCALE,
  type AssessmentNotDoneReason,
  type AuditAiStatus,
  type AuditArea,
  type AuditFinding,
  type AuditMarketing,
  type AuditScale,
  type ExternalSpeed,
  type HierarchyNode,
  type LinkRegion,
  type PageLanguage,
  type SectionKind,
  type SpeedMetric,
  type SpeedNotMeasuredReason,
  type SpeedValue,
  type TechnologyKind,
} from '@qa/types/src/browser.js';

export type MarketingSignalStatus = AuditMarketing['signals'][number]['status'];

export const NO_TITLE = 'No title';
export const EMPTY_TITLE = 'Empty title';
export const NO_DESCRIPTION = 'No description';
export const EMPTY_DESCRIPTION = 'Empty description';
export const NOT_IDENTIFIED = 'Not identified';
export const NOT_SET = 'Not set';
export const NONE = 'None';
export const WHOLE_PAGE = 'Whole page';
export const ALT_MISSING = 'Alt text missing';
export const ALT_DECORATIVE = 'Empty alt (decorative image)';
export const NO_TEXT = 'No text';
export const FORMS_NOTE = 'Forms are read and never sent: the Website Audit never fills in or submits a form.';
export const TEXT_TRUNCATED = 'The text was cut at the per-page limit.';
export const ACCESSIBILITY_STANDARD = 'WCAG 2.2 level AA, automatic checks only';
export const ACCESSIBILITY_NOTE = 'Automatic checks find some problems only; a person must check the rest.';
export const ADVISORY_LABEL = 'Advisory: written by AI, it never changes grades';
export const LEAVES_SITE = 'Leaves the site';

/** Link regions in the order the navigation map lists them. */
export const LINK_REGIONS: readonly LinkRegion[] = ['menu', 'footer', 'breadcrumb', 'internal'];

export const LINK_REGION_LABEL: Readonly<Record<LinkRegion, string>> = {
  menu: 'Menu',
  footer: 'Footer',
  breadcrumb: 'Breadcrumb',
  internal: 'Internal link',
};

export const PLACED_BY_LABEL: Readonly<Record<HierarchyNode['placedBy'], string>> = {
  start: 'Start page',
  menu: 'Placed by the menu',
  breadcrumb: 'Placed by breadcrumbs',
  path: 'Placed by its address',
};

/** What a Section was found from, for a Section without a heading. */
export const SECTION_KIND_LABEL: Readonly<Record<SectionKind, string>> = {
  header: 'Header',
  nav: 'Navigation',
  main: 'Main content',
  aside: 'Sidebar',
  footer: 'Footer',
  region: 'Labelled landmark',
  heading: 'Heading',
  page: 'Whole page',
};

export const SCALE_LABEL: Readonly<Record<AuditScale, string>> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const SOURCE_LABEL: Readonly<Record<AuditFinding['source'], string>> = {
  rule: 'Fixed rule over Page Content',
  checker: 'Browser checker on a Sample Page',
  ai: 'AI',
};

export const SIGNAL_STATUS_LABEL: Readonly<Record<MarketingSignalStatus, string>> = {
  found: 'Found',
  'not-found': 'Not found',
  'not-checked': 'Not checked',
};

export const TECHNOLOGY_KIND_LABEL: Readonly<Record<TechnologyKind, string>> = {
  cms: 'Website builder or CMS',
  framework: 'Framework',
  'static-site-generator': 'Static site generator',
};

/** The English name of a language code, or the code itself when it is not one of the listed languages. */
export function languageName(code: string): string {
  if (code === 'ta') return 'Tamil (தமிழ்)';
  return isDocumentLanguage(code) ? DOCUMENT_LANGUAGE_INFO[code].name : code;
}

export function primaryLanguageText(language: PageLanguage): string {
  return language.primary === 'not-identified' ? NOT_IDENTIFIED : languageName(language.primary);
}

export function otherLanguagesText(language: PageLanguage): string {
  return language.others.length === 0 ? NONE : language.others.map(languageName).join(', ');
}

/** The lang attribute exactly as the page wrote it. */
export function declaredLanguageText(language: PageLanguage): string {
  return language.declared === null ? NOT_SET : language.declared;
}

export function titleText(title: string | null): string {
  if (title === null) return NO_TITLE;
  return title.trim() === '' ? EMPTY_TITLE : title;
}

export function descriptionText(description: string | null): string {
  if (description === null) return NO_DESCRIPTION;
  return description.trim() === '' ? EMPTY_DESCRIPTION : description;
}

export function sectionLabel(sectionId: string | null): string {
  return sectionId === null ? WHOLE_PAGE : `Section ${sectionId}`;
}

export function foundText(found: boolean): string {
  return found ? 'Found' : 'Not found';
}

/** Unicode script ranges of the listed non-Latin languages. Devanagari serves Hindi and Marathi. */
const SCRIPTS: ReadonlyArray<{ range: RegExp; langs: readonly string[] }> = [
  { range: /[஀-௿]/, langs: ['ta'] },
  { range: /[ऀ-ॿ]/, langs: ['hi', 'mr'] },
  { range: /[ఀ-౿]/, langs: ['te'] },
  { range: /[ಀ-೿]/, langs: ['kn'] },
  { range: /[ഀ-ൿ]/, langs: ['ml'] },
  { range: /[઀-૿]/, langs: ['gu'] },
  { range: /[ঀ-৿]/, langs: ['bn'] },
  { range: /[଀-୿]/, langs: ['or'] },
  { range: /[਀-੿]/, langs: ['pa'] },
  { range: /[؀-ۿ]/, langs: ['ur'] },
];

/**
 * The lang and dir attributes for a piece of page text written mostly in one of the listed non-Latin scripts,
 * so screen readers and fonts treat it right. The page's primary language settles a shared script (Hindi or
 * Marathi). Mixed text, such as a page that says the same thing in several languages, and all other text
 * inherit the UI's language and direction: one Arabic line must not turn an English block right-to-left.
 */
export function textLangAttrs(text: string, primary?: PageLanguage['primary']): { lang?: string; dir?: 'rtl' } {
  // Letters and the vowel signs of Indian scripts, so a word in either kind of script weighs the same.
  const letters = text.match(/[\p{L}\p{M}]/gu) ?? [];
  for (const script of SCRIPTS) {
    const inScript = letters.filter((char) => script.range.test(char)).length;
    if (inScript === 0 || inScript * 2 <= letters.length) continue;
    const lang = primary !== undefined && script.langs.includes(primary) ? primary : script.langs[0];
    return lang === 'ur' ? { lang, dir: 'rtl' } : { lang };
  }
  return {};
}

// ---------------------------------------------------------------------------------------------------
// Summary, site areas, Improvement Roadmap and per-page speed (T-72, T-73)
// ---------------------------------------------------------------------------------------------------

export const AI_ADVISORY_CHIP = 'AI advisory';
export const NO_GRADE = 'No grade: no checks ran';
export const GRADE_BASIS =
  'The grade comes from automatic checks only. The AI writes the note and never changes the grade.';

export const AREA_LABEL: Readonly<Record<AuditArea, string>> = {
  'search-ranking': 'Search ranking',
  marketing: 'Marketing',
  usability: 'Usability',
  content: 'Content',
  accessibility: 'Accessibility (automatic checks only)',
  speed: 'Speed',
};

export const NOT_DONE_REASON_TEXT: Readonly<Record<AssessmentNotDoneReason, string>> = {
  'no-ai-key': 'No AI note was written: an AI key is needed. Add one in Settings.',
  'ai-failed': 'No AI note was written: the AI did not answer. Try again later.',
  'budget-spent': 'No AI note was written: the AI budget for this Website Audit was spent.',
};

export const SPEED_METRIC_LABEL: Readonly<Record<SpeedMetric, string>> = {
  'performance-score': 'Performance score (0 to 100)',
  lcp: 'Largest Contentful Paint',
  inp: 'Interaction to Next Paint',
  cls: 'Cumulative Layout Shift',
  fcp: 'First Contentful Paint',
  ttfb: 'Time to First Byte',
  tbt: 'Total Blocking Time',
  'speed-index': 'Speed Index',
};

export const SPEED_NOT_MEASURED_TEXT: Readonly<Record<SpeedNotMeasuredReason, string>> = {
  failed: 'the measurement failed',
  timeout: 'the measurement took too long',
  quota: 'the PageSpeed Insights limit was reached',
  'no-network': 'the PageSpeed Insights service could not be reached',
  'no-field-data': 'Google has no visitor data for this page',
};

/** How one measured value reads: "2400 ms", "78", "0.05". */
export function speedValueText(value: SpeedValue): string {
  return value.unit === 'ms' ? `${Math.round(value.value)} ms` : String(value.value);
}

/** How a speed result was measured, said before its numbers (ADR 0018). */
export function speedMethodText(speed: ExternalSpeed): string {
  if (speed.method === 'lab') {
    return 'Lab test: a Lighthouse test made by the Google PageSpeed Insights API, simulating a phone (mobile)';
  }
  const scope =
    speed.status === 'measured' && speed.scope === 'origin'
      ? 'the whole website, as this page has few visitors'
      : 'this page';
  return `Field data: what real Chrome visitors on phones experienced, from the Chrome UX Report, for ${scope}`;
}

export const SPEED_LIMITS =
  'This is one measurement by Google, not a guarantee of how the website feels to every visitor.';

/** Findings ranked for "Fix first": higher impact first, then lower effort. Ties keep the given order. */
export function fixFirst(findings: AuditFinding[], limit = 5): AuditFinding[] {
  const impact = (f: AuditFinding) => AUDIT_SCALE.indexOf(f.impact);
  const effort = (f: AuditFinding) => AUDIT_SCALE.indexOf(f.effort);
  return findings
    .map((finding, i) => ({ finding, i }))
    .sort((a, b) => impact(a.finding) - impact(b.finding) || effort(b.finding) - effort(a.finding) || a.i - b.i)
    .slice(0, limit)
    .map((entry) => entry.finding);
}

// ---------------------------------------------------------------------------------------------------
// Result notes (T-88, ADR 0042)
// ---------------------------------------------------------------------------------------------------

/** Whether a note is about AI status or configuration (T-88). */
export function isAiNote(note: string): boolean {
  return /\bAI\b/i.test(note);
}

/** "Only 1 page was read" note text (T-88, ADR 0042). */
export function onlyOnePageNoteText(): string {
  return 'Only 1 page was read.';
}

/** "The site stopped answering after N pages" note text (T-88, ADR 0042). */
export function siteStoppedAnsweringNoteText(pages: number): string {
  return `The site stopped answering after ${pages} ${pages === 1 ? 'page' : 'pages'}.`;
}

/** Speed source note text (T-88, ADR 0042). */
export function speedSourceNoteText(source: 'pagespeed-insights' | 'this-tool' | 'not-measured'): string {
  if (source === 'pagespeed-insights') return 'Speed was measured by Google PageSpeed Insights.';
  if (source === 'this-tool') return 'Speed was measured by this tool.';
  return 'Speed was not measured.';
}

/** AI status note text with its reason (T-88, ADR 0042). */
export function aiStatusNoteText(status: AuditAiStatus, reason?: string): string {
  if (status === 'ready') return 'AI: ready.';
  if (status === 'no-key') return 'AI notes need an AI key.';
  if (status === 'key-expired') return 'The AI key expired. Update it in Audit settings.';
  if (status === 'quota') return 'The AI quota was reached.';
  if (status === 'timeout') return 'The AI did not answer in time.';
  if (status === 'provider-error') {
    return reason ? `The AI provider returned an error: ${reason}.` : 'The AI provider returned an error.';
  }
  return 'AI status: not available.';
}
