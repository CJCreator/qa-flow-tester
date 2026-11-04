import {
  sectionText,
  type AuditEditsPatch,
  type AuditFinding,
  type AuditResult,
  type EditOverlay,
  type HierarchyNode,
  type PageAction,
  type PageContent,
  type PageRecommendation,
  type Section,
} from '@qa/types/src/browser.js';

/**
 * Pure helpers of the review and edit screen (REQ-020). The Website Audit's result is never changed: the
 * saved edits are an overlay (`EditOverlay`), and the tool user's unsaved changes are a `ReviewDraft` on top
 * of it. `draftToPatch` turns the draft into the `PATCH /api/audits/:id/edits` body; the `*Rows` helpers
 * merge the result, the saved edits and the draft for display, with the originals kept beside each edit.
 */

export type FindingField = 'title' | 'detail' | 'suggestion';
export const FINDING_FIELDS: readonly FindingField[] = ['title', 'detail', 'suggestion'];

/** Unsaved changes to one finding: new text per field, or a reset to the original. */
export type FindingDraft = { reset: true } | Partial<Record<FindingField, string>>;

/** Unsaved change to one Section: new text, or a reset to the original. */
export type SectionDraft = { urlPath: string; sectionId: string } & ({ text: string } | { reset: true });

/** The tool user's unsaved changes. Empty after each save. */
export interface ReviewDraft {
  findings: Record<string, FindingDraft>;
  /** Keyed by `sectionKey(urlPath, sectionId)`. */
  sections: Record<string, SectionDraft>;
  /** Pages to remove from or restore to the hierarchy of the Audit Documents. */
  pages: Record<string, 'remove' | 'restore'>;
  /** A chosen action per Sample Page, or a reset to the proposed one. */
  recommendations: Record<string, PageAction | 'reset'>;
}

export function emptyDraft(): ReviewDraft {
  return { findings: {}, sections: {}, pages: {}, recommendations: {} };
}

export function isDraftEmpty(draft: ReviewDraft): boolean {
  return (
    Object.keys(draft.findings).length === 0 &&
    Object.keys(draft.sections).length === 0 &&
    Object.keys(draft.pages).length === 0 &&
    Object.keys(draft.recommendations).length === 0
  );
}

export function sectionKey(urlPath: string, sectionId: string): string {
  return `${urlPath}\u0000${sectionId}`;
}

function isReset(value: object): value is { reset: true } {
  return 'reset' in value && (value as { reset?: unknown }).reset === true;
}

// ---------------------------------------------------------------------------------------------------
// Changing the draft (each returns a new draft)
// ---------------------------------------------------------------------------------------------------

export function setFindingField(draft: ReviewDraft, findingId: string, field: FindingField, value: string): ReviewDraft {
  const current = draft.findings[findingId];
  const fields = current && !isReset(current) ? current : {};
  return { ...draft, findings: { ...draft.findings, [findingId]: { ...fields, [field]: value } } };
}

export function resetFinding(draft: ReviewDraft, findingId: string): ReviewDraft {
  return { ...draft, findings: { ...draft.findings, [findingId]: { reset: true } } };
}

export function setSectionText(draft: ReviewDraft, urlPath: string, sectionId: string, text: string): ReviewDraft {
  return { ...draft, sections: { ...draft.sections, [sectionKey(urlPath, sectionId)]: { urlPath, sectionId, text } } };
}

export function resetSection(draft: ReviewDraft, urlPath: string, sectionId: string): ReviewDraft {
  return {
    ...draft,
    sections: { ...draft.sections, [sectionKey(urlPath, sectionId)]: { urlPath, sectionId, reset: true } },
  };
}

/** Removes a page from, or restores it to, the hierarchy. A change back to the saved state is dropped. */
export function setPageRemoved(draft: ReviewDraft, edits: EditOverlay, urlPath: string, removed: boolean): ReviewDraft {
  const pages = { ...draft.pages };
  if (edits.removedPages.includes(urlPath) === removed) delete pages[urlPath];
  else pages[urlPath] = removed ? 'remove' : 'restore';
  return { ...draft, pages };
}

export function chooseAction(draft: ReviewDraft, urlPath: string, action: PageAction): ReviewDraft {
  return { ...draft, recommendations: { ...draft.recommendations, [urlPath]: action } };
}

export function resetAction(draft: ReviewDraft, urlPath: string): ReviewDraft {
  return { ...draft, recommendations: { ...draft.recommendations, [urlPath]: 'reset' } };
}

// ---------------------------------------------------------------------------------------------------
// The PATCH body
// ---------------------------------------------------------------------------------------------------

/** The `PATCH /api/audits/:id/edits` body for the draft; a list with nothing in it is left out. */
export function draftToPatch(draft: ReviewDraft): AuditEditsPatch {
  const patch: AuditEditsPatch = {};

  const findings: NonNullable<AuditEditsPatch['findings']> = [];
  for (const [findingId, change] of Object.entries(draft.findings)) {
    if (isReset(change)) {
      findings.push({ findingId, reset: true });
      continue;
    }
    const fields: Partial<Record<FindingField, string>> = {};
    for (const field of FINDING_FIELDS) if (typeof change[field] === 'string') fields[field] = change[field];
    if (Object.keys(fields).length > 0) findings.push({ findingId, ...fields });
  }
  if (findings.length > 0) patch.findings = findings;

  const sections: NonNullable<AuditEditsPatch['sections']> = Object.values(draft.sections).map((change) =>
    isReset(change)
      ? { urlPath: change.urlPath, sectionId: change.sectionId, reset: true }
      : { urlPath: change.urlPath, sectionId: change.sectionId, text: change.text }
  );
  if (sections.length > 0) patch.sections = sections;

  const removePages = Object.keys(draft.pages).filter((page) => draft.pages[page] === 'remove');
  const restorePages = Object.keys(draft.pages).filter((page) => draft.pages[page] === 'restore');
  if (removePages.length > 0) patch.removePages = removePages;
  if (restorePages.length > 0) patch.restorePages = restorePages;

  const recommendations: NonNullable<AuditEditsPatch['recommendations']> = Object.entries(draft.recommendations).map(
    ([urlPath, choice]) => (choice === 'reset' ? { urlPath, reset: true } : { urlPath, action: choice })
  );
  if (recommendations.length > 0) patch.recommendations = recommendations;

  return patch;
}

// ---------------------------------------------------------------------------------------------------
// Display: the result, merged with the saved edits and the draft, originals kept
// ---------------------------------------------------------------------------------------------------

export function isPageRemoved(urlPath: string, edits: EditOverlay, draft: ReviewDraft): boolean {
  const change = draft.pages[urlPath];
  if (change) return change === 'remove';
  return edits.removedPages.includes(urlPath);
}

export interface ReviewPageNode {
  urlPath: string;
  title: string | null;
  placedBy: HierarchyNode['placedBy'];
  removed: boolean;
  /** Removed or restored and not saved yet. */
  unsaved: boolean;
  children: ReviewPageNode[];
}

/** The page hierarchy with each page's removed state; a page repeated in the data is kept to its first place. */
export function hierarchyTree(result: AuditResult, edits: EditOverlay, draft: ReviewDraft): ReviewPageNode {
  const seen = new Set<string>([result.hierarchy.root.urlPath]);
  const build = (node: HierarchyNode): ReviewPageNode => ({
    urlPath: node.urlPath,
    title: node.title,
    placedBy: node.placedBy,
    removed: isPageRemoved(node.urlPath, edits, draft),
    unsaved: node.urlPath in draft.pages,
    children: node.children
      .filter((child) => {
        if (seen.has(child.urlPath)) return false;
        seen.add(child.urlPath);
        return true;
      })
      .map(build),
  });
  return build(result.hierarchy.root);
}

export interface FindingRow {
  finding: AuditFinding;
  /** The text shown and exported: the draft, else the saved edit, else the original. */
  shown: Record<FindingField, string>;
  /** Fields whose shown text differs from the original. */
  changed: FindingField[];
  /** The finding has a change that is not saved yet. */
  unsaved: boolean;
}

export function findingRows(result: AuditResult, edits: EditOverlay, draft: ReviewDraft): FindingRow[] {
  return result.findings.map((finding) => {
    const saved = edits.findings.find((edit) => edit.findingId === finding.id);
    const change = draft.findings[finding.id];
    const shown = {} as Record<FindingField, string>;
    for (const field of FINDING_FIELDS) {
      if (change && isReset(change)) shown[field] = finding[field];
      else shown[field] = change?.[field] ?? saved?.[field] ?? finding[field];
    }
    return {
      finding,
      shown,
      changed: FINDING_FIELDS.filter((field) => shown[field] !== finding[field]),
      unsaved: change !== undefined,
    };
  });
}

export interface SectionRow {
  section: Section;
  original: string;
  shown: string;
  /** The shown text differs from the original. */
  edited: boolean;
  /** Written by an accepted AI rewrite rather than a person. */
  byRewrite: boolean;
  unsaved: boolean;
}

/** A page's Sections in page order, each with its original text and the text the documents use. */
export function sectionRows(content: PageContent, edits: EditOverlay, draft: ReviewDraft): SectionRow[] {
  return content.sections.map((section) => {
    const original = sectionText(content, section);
    const saved = edits.sections.find((edit) => edit.urlPath === content.urlPath && edit.sectionId === section.id);
    const change = draft.sections[sectionKey(content.urlPath, section.id)];
    let shown = saved ? saved.text : original;
    let byRewrite = saved?.by === 'rewrite';
    if (change) {
      shown = isReset(change) ? original : change.text;
      byRewrite = false;
    }
    return { section, original, shown, edited: shown !== original, byRewrite, unsaved: change !== undefined };
  });
}

export interface RecommendationRow {
  urlPath: string;
  title: string | null;
  proposed: PageRecommendation;
  /** The choice the documents use: the draft, else the saved edit, else the proposed one. */
  chosen: PageAction;
  edited: boolean;
  unsaved: boolean;
}

/** One row per Sample Page with a redesign-or-repair recommendation, in page order. */
export function recommendationRows(result: AuditResult, edits: EditOverlay, draft: ReviewDraft): RecommendationRow[] {
  const rows: RecommendationRow[] = [];
  for (const page of result.pages) {
    const proposed = page.recommendation;
    if (page.coverage !== 'sample' || !proposed) continue;
    const saved = edits.recommendations.find((edit) => edit.urlPath === page.urlPath);
    const change = draft.recommendations[page.urlPath];
    const chosen = change === 'reset' ? proposed.action : (change ?? saved?.action ?? proposed.action);
    rows.push({
      urlPath: page.urlPath,
      title: page.title,
      proposed,
      chosen,
      edited: chosen !== proposed.action,
      unsaved: change !== undefined,
    });
  }
  return rows;
}
