/**
 * Fixed UI wording for the Website Audit analysis views (HierarchyView, PageContentView, PageFactsView,
 * FindingsList). Terms follow CONTEXT.md; claims follow ADR 0018 (found or not found, never "accessible",
 * "compliant" or "secure") and ADR 0033 (a Website Audit has no release verdict).
 */
import {
  DOCUMENT_LANGUAGE_INFO,
  isDocumentLanguage,
  type AuditFinding,
  type AuditMarketing,
  type AuditScale,
  type HierarchyNode,
  type LinkRegion,
  type PageLanguage,
  type SectionKind,
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
 * The lang and dir attributes for a piece of page text written in one of the listed non-Latin scripts, so
 * screen readers and fonts treat it right. The page's primary language settles a shared script (Hindi or
 * Marathi). Other text inherits the UI's language.
 */
export function textLangAttrs(text: string, primary: PageLanguage['primary']): { lang?: string; dir?: 'rtl' } {
  for (const script of SCRIPTS) {
    if (!script.range.test(text)) continue;
    const lang = script.langs.includes(primary) ? primary : script.langs[0];
    return lang === 'ur' ? { lang, dir: 'rtl' } : { lang };
  }
  return {};
}
