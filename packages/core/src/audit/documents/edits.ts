/**
 * Edits before export (REQ-020, Q-25): the originals are kept and the tool user's edits are an overlay.
 *
 * - `validateAuditEditsPatch` checks a `PATCH /api/audits/:id/edits` body: shape, text caps, unknown keys
 *   refused, one message per field. Syntax only: whether a finding, page or Section exists in the version is
 *   the route's check.
 * - `mergeEditsPatch` folds a checked patch into an overlay and returns a new one.
 * - `buildEditedView` applies an overlay to a finished version and returns the read model every Audit
 *   Document builder uses.
 *
 * Pure: no I/O, and nothing passed in is ever changed (each function works on copies).
 */

import {
  sectionText,
  type AuditEditsPatch,
  type AuditFinding,
  type AuditPage,
  type AuditResult,
  type AuditScale,
  type EditOverlay,
  type FindingEdit,
  type HierarchyNode,
  type PageAction,
  type PageContent,
  type ProposalInputs,
  type RecommendationEdit,
  type SectionEdit,
} from '@qa/types';
import { ROADMAP_PHASE } from './roadmap.js';

// ---------------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------------

/** Longest edited finding title. */
export const MAX_EDIT_TITLE_CHARS = 300;
/** Longest edited finding detail or suggestion. */
export const MAX_EDIT_TEXT_CHARS = 5000;
/** Longest edited Section text. */
export const MAX_SECTION_EDIT_CHARS = 20000;
/** Longest page path in a patch. */
export const MAX_EDIT_PATH_CHARS = 2048;
/** Most entries in one list of a patch. */
export const MAX_EDIT_ITEMS = 500;
/** Longest Proposal price or payment terms. */
export const MAX_PROPOSAL_FIELD_CHARS = 2000;
/** Most "not included" lines, and the longest one. */
export const MAX_NOT_INCLUDED_ITEMS = 30;
export const MAX_NOT_INCLUDED_CHARS = 300;

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const PAGE_ACTIONS: readonly PageAction[] = ['redesign', 'repair'];

// ---------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------

/** One message per field that is wrong, keyed by its place in the body ("findings[0].title"). */
export type AuditEditsErrors = Record<string, string>;

export type AuditEditsCheck = { ok: true; value: AuditEditsPatch } | { ok: false; errors: AuditEditsErrors };

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Control characters other than tab, line feed and carriage return. */
// eslint-disable-next-line no-control-regex
const BAD_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function textProblem(value: unknown, max: number, allowEmpty: boolean): string | undefined {
  if (typeof value !== 'string') return 'must be text.';
  if (!allowEmpty && value.trim() === '') return 'must not be empty; use reset to show the original again.';
  if (value.length > max) return `is longer than ${max} characters.`;
  if (BAD_CONTROL.test(value)) return 'must not contain invisible control characters.';
  return undefined;
}

function idProblem(value: unknown): string | undefined {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) return 'must be an id such as AF-001 or s1.';
  return undefined;
}

/** Why a page path is malformed, or undefined. Paths may carry a (redacted) query. */
export function editPathProblem(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return 'must be a page path such as /about.';
  if (value.length > MAX_EDIT_PATH_CHARS) return `is longer than ${MAX_EDIT_PATH_CHARS} characters.`;
  if (!value.startsWith('/') || value.startsWith('//'))
    return 'must be a path on the site starting with /, such as /about.';
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(value)) return 'must not contain spaces or invisible characters.';
  if (value.includes('\\')) return 'must use / and not \\.';
  if (value.includes('#')) return 'must not contain #.';
  return undefined;
}

function unknownKeys(value: Obj, allowed: readonly string[], at: string, errors: AuditEditsErrors): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors[`${at}.${key}`.replace(/^\./, '')] = 'is not a field that can be edited.';
  }
}

function listOf(value: unknown, at: string, errors: AuditEditsErrors): unknown[] | undefined {
  if (!Array.isArray(value)) {
    errors[at] = 'must be a list.';
    return undefined;
  }
  if (value.length > MAX_EDIT_ITEMS) {
    errors[at] = `must have at most ${MAX_EDIT_ITEMS} entries.`;
    return undefined;
  }
  return value;
}

function check(errors: AuditEditsErrors, at: string, problem: string | undefined): void {
  if (problem) errors[at] = problem;
}

function resetProblem(entry: Obj, textKeys: readonly string[]): string | undefined {
  if (entry.reset !== true) return 'must be true to show the original again.';
  if (textKeys.some((k) => k in entry)) return 'cannot be combined with new text.';
  return undefined;
}

function validateFindings(input: unknown, errors: AuditEditsErrors): AuditEditsPatch['findings'] {
  const list = listOf(input, 'findings', errors);
  if (!list) return undefined;
  const out: NonNullable<AuditEditsPatch['findings']> = [];
  const textKeys = ['title', 'detail', 'suggestion'] as const;
  list.forEach((entry, i) => {
    const at = `findings[${i}]`;
    if (!isObject(entry)) {
      errors[at] = 'must be an object with a findingId.';
      return;
    }
    unknownKeys(entry, ['findingId', 'reset', ...textKeys], at, errors);
    check(errors, `${at}.findingId`, idProblem(entry.findingId));
    if ('reset' in entry) {
      check(errors, `${at}.reset`, resetProblem(entry, textKeys));
      out.push({ findingId: entry.findingId as string, reset: true });
      return;
    }
    if (!textKeys.some((k) => k in entry)) {
      errors[at] = 'needs a title, detail or suggestion, or reset: true.';
      return;
    }
    const edit: { findingId: string; title?: string; detail?: string; suggestion?: string } = {
      findingId: entry.findingId as string,
    };
    for (const key of textKeys) {
      if (!(key in entry)) continue;
      const max = key === 'title' ? MAX_EDIT_TITLE_CHARS : MAX_EDIT_TEXT_CHARS;
      check(errors, `${at}.${key}`, textProblem(entry[key], max, false));
      edit[key] = entry[key] as string;
    }
    out.push(edit);
  });
  return out;
}

function validateSections(input: unknown, errors: AuditEditsErrors): AuditEditsPatch['sections'] {
  const list = listOf(input, 'sections', errors);
  if (!list) return undefined;
  const out: NonNullable<AuditEditsPatch['sections']> = [];
  list.forEach((entry, i) => {
    const at = `sections[${i}]`;
    if (!isObject(entry)) {
      errors[at] = 'must be an object with a urlPath and a sectionId.';
      return;
    }
    unknownKeys(entry, ['urlPath', 'sectionId', 'text', 'reset'], at, errors);
    check(errors, `${at}.urlPath`, editPathProblem(entry.urlPath));
    check(errors, `${at}.sectionId`, idProblem(entry.sectionId));
    const key = { urlPath: entry.urlPath as string, sectionId: entry.sectionId as string };
    if ('reset' in entry) {
      check(errors, `${at}.reset`, resetProblem(entry, ['text']));
      out.push({ ...key, reset: true });
      return;
    }
    // A Section may be emptied on purpose; reset brings the original back.
    check(errors, `${at}.text`, textProblem(entry.text, MAX_SECTION_EDIT_CHARS, true));
    out.push({ ...key, text: entry.text as string });
  });
  return out;
}

function validatePaths(input: unknown, at: string, errors: AuditEditsErrors): string[] | undefined {
  const list = listOf(input, at, errors);
  if (!list) return undefined;
  list.forEach((p, i) => check(errors, `${at}[${i}]`, editPathProblem(p)));
  return [...new Set(list as string[])];
}

function validateRecommendations(input: unknown, errors: AuditEditsErrors): AuditEditsPatch['recommendations'] {
  const list = listOf(input, 'recommendations', errors);
  if (!list) return undefined;
  const out: NonNullable<AuditEditsPatch['recommendations']> = [];
  list.forEach((entry, i) => {
    const at = `recommendations[${i}]`;
    if (!isObject(entry)) {
      errors[at] = 'must be an object with a urlPath.';
      return;
    }
    unknownKeys(entry, ['urlPath', 'action', 'reset'], at, errors);
    check(errors, `${at}.urlPath`, editPathProblem(entry.urlPath));
    if ('reset' in entry) {
      check(errors, `${at}.reset`, resetProblem(entry, ['action']));
      out.push({ urlPath: entry.urlPath as string, reset: true });
      return;
    }
    if (!PAGE_ACTIONS.includes(entry.action as PageAction)) {
      errors[`${at}.action`] = 'must be redesign or repair, or use reset: true.';
    }
    out.push({ urlPath: entry.urlPath as string, action: entry.action as PageAction });
  });
  return out;
}

function validateProposal(input: unknown, errors: AuditEditsErrors): ProposalInputs | undefined {
  if (!isObject(input)) {
    errors.proposal = 'must be an object with price, paymentTerms or notIncluded.';
    return undefined;
  }
  unknownKeys(input, ['price', 'paymentTerms', 'notIncluded'], 'proposal', errors);
  const out: ProposalInputs = {};
  for (const key of ['price', 'paymentTerms'] as const) {
    if (!(key in input)) continue;
    check(errors, `proposal.${key}`, textProblem(input[key], MAX_PROPOSAL_FIELD_CHARS, true));
    out[key] = input[key] as string;
  }
  if ('notIncluded' in input) {
    const lines = input.notIncluded;
    if (!Array.isArray(lines)) {
      errors['proposal.notIncluded'] = 'must be a list of lines.';
    } else if (lines.length > MAX_NOT_INCLUDED_ITEMS) {
      errors['proposal.notIncluded'] = `must have at most ${MAX_NOT_INCLUDED_ITEMS} lines.`;
    } else {
      lines.forEach((line, i) =>
        check(errors, `proposal.notIncluded[${i}]`, textProblem(line, MAX_NOT_INCLUDED_CHARS, false))
      );
      out.notIncluded = [...(lines as string[])];
    }
  }
  return out;
}

/**
 * Checks a `PATCH /api/audits/:id/edits` body (REQ-020). Refuses wrong types, unknown keys, text over the
 * caps, control characters, malformed page paths and ids, `reset` mixed with new text, and a page that is
 * both removed and restored, with one message per field. On success the value holds only known keys.
 */
export function validateAuditEditsPatch(body: unknown): AuditEditsCheck {
  const errors: AuditEditsErrors = {};
  if (!isObject(body)) return { ok: false, errors: { body: 'must be an object.' } };
  unknownKeys(body, ['findings', 'sections', 'removePages', 'restorePages', 'recommendations', 'proposal'], '', errors);

  const value: AuditEditsPatch = {};
  if ('findings' in body) value.findings = validateFindings(body.findings, errors);
  if ('sections' in body) value.sections = validateSections(body.sections, errors);
  if ('removePages' in body) value.removePages = validatePaths(body.removePages, 'removePages', errors);
  if ('restorePages' in body) value.restorePages = validatePaths(body.restorePages, 'restorePages', errors);
  if ('recommendations' in body) value.recommendations = validateRecommendations(body.recommendations, errors);
  if ('proposal' in body) value.proposal = validateProposal(body.proposal, errors);

  if (value.removePages && value.restorePages) {
    const both = value.restorePages.filter((p) => value.removePages!.includes(p));
    if (both.length > 0) errors.restorePages = `${both[0]} is also in removePages: pick one.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value };
}

// ---------------------------------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------------------------------

/** An overlay with no edits. */
export function emptyOverlay(): EditOverlay {
  return { findings: [], sections: [], removedPages: [], recommendations: [], proposal: {}, updatedAt: null };
}

function copyOverlay(overlay: EditOverlay): EditOverlay {
  return {
    findings: overlay.findings.map((e) => ({ ...e })),
    sections: overlay.sections.map((e) => ({ ...e })),
    removedPages: [...overlay.removedPages],
    recommendations: overlay.recommendations.map((e) => ({ ...e })),
    proposal: {
      ...overlay.proposal,
      ...(overlay.proposal.notIncluded ? { notIncluded: [...overlay.proposal.notIncluded] } : {}),
    },
    updatedAt: overlay.updatedAt,
  };
}

/**
 * Folds a checked patch into an overlay and returns the new overlay; `overlay` is not changed. Finding
 * edits merge field by field; a Section or recommendation edit replaces the earlier one; `reset: true`
 * removes the edit so the original shows again. `restorePages` brings removed pages back. Proposal fields
 * given replace the earlier ones; an empty price or payment terms clears it. Sets `updatedAt` to `now`.
 * Call `validateAuditEditsPatch` first: this function trusts the patch's shape.
 */
export function mergeEditsPatch(overlay: EditOverlay, patch: AuditEditsPatch, now: Date | string): EditOverlay {
  const next = copyOverlay(overlay);
  const editedAt = typeof now === 'string' ? now : now.toISOString();

  for (const entry of patch.findings ?? []) {
    const at = next.findings.findIndex((e) => e.findingId === entry.findingId);
    if ('reset' in entry) {
      if (at >= 0) next.findings.splice(at, 1);
      continue;
    }
    const merged: FindingEdit = { ...(at >= 0 ? next.findings[at] : { findingId: entry.findingId }), editedAt };
    if (entry.title !== undefined) merged.title = entry.title;
    if (entry.detail !== undefined) merged.detail = entry.detail;
    if (entry.suggestion !== undefined) merged.suggestion = entry.suggestion;
    if (at >= 0) next.findings[at] = merged;
    else next.findings.push(merged);
  }

  for (const entry of patch.sections ?? []) {
    const at = next.sections.findIndex((e) => e.urlPath === entry.urlPath && e.sectionId === entry.sectionId);
    if ('reset' in entry) {
      if (at >= 0) next.sections.splice(at, 1);
      continue;
    }
    const edit: SectionEdit = {
      urlPath: entry.urlPath,
      sectionId: entry.sectionId,
      text: entry.text,
      by: 'person',
      editedAt,
    };
    if (at >= 0) next.sections[at] = edit;
    else next.sections.push(edit);
  }

  for (const page of patch.removePages ?? []) {
    if (!next.removedPages.includes(page)) next.removedPages.push(page);
  }
  if (patch.restorePages?.length) {
    next.removedPages = next.removedPages.filter((p) => !patch.restorePages!.includes(p));
  }

  for (const entry of patch.recommendations ?? []) {
    const at = next.recommendations.findIndex((e) => e.urlPath === entry.urlPath);
    if ('reset' in entry) {
      if (at >= 0) next.recommendations.splice(at, 1);
      continue;
    }
    const edit: RecommendationEdit = { urlPath: entry.urlPath, action: entry.action, editedAt };
    if (at >= 0) next.recommendations[at] = edit;
    else next.recommendations.push(edit);
  }

  if (patch.proposal) {
    for (const key of ['price', 'paymentTerms'] as const) {
      const value = patch.proposal[key];
      if (value === undefined) continue;
      if (value.trim() === '') delete next.proposal[key];
      else next.proposal[key] = value;
    }
    if (patch.proposal.notIncluded !== undefined) next.proposal.notIncluded = [...patch.proposal.notIncluded];
  }

  next.updatedAt = editedAt;
  return next;
}

// ---------------------------------------------------------------------------------------------------
// The edited view
// ---------------------------------------------------------------------------------------------------

/**
 * One version as its Audit Documents show it: the result and Page Content with the overlay applied.
 * Every document builder reads this, never the raw result, so edits show everywhere the same way.
 */
export interface EditedAuditView {
  /** A copy of the result with removed pages gone and edited text in place. */
  result: AuditResult;
  /**
   * Page Content of the pages kept, in the order given. An edited Section's text replaces the original and
   * the page's `text` and Section offsets are rebuilt, so `sectionText` gives every Section's text.
   */
  contents: PageContent[];
  /** The pages actually removed (a path not in the version, or the start page, is not). */
  removedPages: string[];
  /** The Proposal inputs the tool user filled in. */
  proposal: ProposalInputs;
  /** The overlay this view was built from (a copy). */
  overlay: EditOverlay;
}

/** The hierarchy without removed nodes: each removed node's children take its place under its parent. */
function pruneChildren(children: readonly HierarchyNode[], removed: ReadonlySet<string>): HierarchyNode[] {
  const out: HierarchyNode[] = [];
  for (const child of children) {
    const kept = pruneChildren(child.children, removed);
    if (removed.has(child.urlPath)) out.push(...kept);
    else out.push({ ...child, children: kept });
  }
  return out;
}

/** Rebuilds a page's text with edited Sections in place; text outside every Section is kept as it is. */
function applySectionEdits(content: PageContent, edits: ReadonlyMap<string, string>): PageContent {
  const copy = structuredClone(content);
  if (edits.size === 0 || !copy.sections.some((s) => edits.has(s.id))) return copy;
  const order = copy.sections
    .map((s, i) => ({ s, i, start: s.start, end: s.end }))
    .sort((a, b) => a.start - b.start || a.i - b.i);
  let text = '';
  let cursor = 0;
  for (const { s, start, end } of order) {
    if (start > cursor) text += content.text.slice(cursor, start);
    const piece = edits.get(s.id) ?? sectionText(content, { start, end });
    s.start = text.length;
    text += piece;
    s.end = text.length;
    cursor = Math.max(cursor, end);
  }
  if (cursor < content.text.length) text += content.text.slice(cursor);
  copy.text = text;
  return copy;
}

function editFinding(finding: AuditFinding, edit: FindingEdit | undefined): AuditFinding {
  if (!edit) return finding;
  return {
    ...finding,
    ...(edit.title !== undefined ? { title: edit.title } : {}),
    ...(edit.detail !== undefined ? { detail: edit.detail } : {}),
    ...(edit.suggestion !== undefined ? { suggestion: edit.suggestion } : {}),
  };
}

/** A finding without removed pages, or null when every page it is on was removed. */
function withoutRemovedPages(finding: AuditFinding, removed: ReadonlySet<string>): AuditFinding | null {
  const pages = (finding.pages ?? [finding.urlPath]).filter((p) => !removed.has(p));
  const mainKept = !removed.has(finding.urlPath);
  if (!mainKept && pages.length === 0) return null;
  const out: AuditFinding = { ...finding };
  if (finding.pages) out.pages = pages;
  if (!mainKept) {
    // The Section belonged to the removed page: the finding now stands on the next page it spans.
    out.urlPath = pages[0];
    out.sectionId = null;
  }
  return out;
}

/**
 * `buildRoadmap`'s rule (roadmap.ts, not exported there): an item's priority is the highest impact of its
 * findings and its effort the highest effort. Lower rank is more: high 0, medium 1, low 2.
 */
const SCALE_RANK: Record<AuditScale, number> = { high: 0, medium: 1, low: 2 };
const highestScale = (a: AuditScale, b: AuditScale): AuditScale => (SCALE_RANK[a] <= SCALE_RANK[b] ? a : b);

/**
 * Applies `overlay` to one finished version (REQ-020). Removed pages are dropped from the pages, the
 * hierarchy (their children re-parented to their parent), navigation links, leaving-site sources,
 * internal-linking counts and marketing signal pages; findings only on removed pages are dropped and the
 * rest lose those pages; roadmap items left without findings are dropped. Finding title, detail and
 * suggestion, Section text and the redesign-or-repair action are replaced by their edits.
 *
 * A kept roadmap item follows its kept findings as edited: its first kept finding names it when that
 * finding's title was edited or the item's first finding was dropped, and once any of its findings is
 * dropped its priority, effort and phase are worked out again from the findings left, with
 * `buildRoadmap`'s rule. An item no edit touches stays as recorded, and keeps its id and place.
 *
 * The start page cannot be removed: everything sits beneath it. Crawl coverage (found, reached, skipped)
 * is a fact about the crawl and stays as recorded. `result`, `contents` and `overlay` are never changed.
 */
export function buildEditedView(
  result: AuditResult,
  contents: readonly PageContent[],
  overlay: EditOverlay
): EditedAuditView {
  const view = structuredClone(result);
  const known = new Set(result.pages.map((p) => p.urlPath));
  const rootPath = result.hierarchy.root.urlPath;
  const removedPages = [...new Set(overlay.removedPages)].filter((p) => known.has(p) && p !== rootPath);
  const removed = new Set(removedPages);
  const keep = (p: string): boolean => !removed.has(p);

  // Findings: removed pages first, then the edited text.
  const findingEdits = new Map(overlay.findings.map((e) => [e.findingId, e]));
  view.findings = view.findings
    .map((f) => withoutRemovedPages(f, removed))
    .filter((f): f is AuditFinding => f !== null)
    .map((f) => editFinding(f, findingEdits.get(f.id)));
  const findingIds = new Set(view.findings.map((f) => f.id));
  const keepFinding = (id: string): boolean => findingIds.has(id);

  // Pages, with the recommendation edits.
  const recommendationEdits = new Map(overlay.recommendations.map((e) => [e.urlPath, e.action]));
  view.pages = view.pages
    .filter((p) => keep(p.urlPath))
    .map((page): AuditPage => {
      const out: AuditPage = { ...page };
      if (out.sampleUrlPath !== undefined && removed.has(out.sampleUrlPath)) delete out.sampleUrlPath;
      const action = recommendationEdits.get(page.urlPath);
      if (out.recommendation) {
        out.recommendation = {
          ...out.recommendation,
          ...(action ? { action } : {}),
          findingIds: out.recommendation.findingIds.filter(keepFinding),
        };
      }
      out.seo = { ...out.seo, findingIds: out.seo.findingIds.filter(keepFinding) };
      if (out.accessibility) {
        out.accessibility = { ...out.accessibility, findingIds: out.accessibility.findingIds.filter(keepFinding) };
      }
      if (out.phone) out.phone = { ...out.phone, findingIds: out.phone.findingIds.filter(keepFinding) };
      if (out.areas) {
        out.areas = out.areas.map((a) =>
          a.status === 'done' ? { ...a, evidence: a.evidence.filter(keepFinding) } : a
        );
      }
      return out;
    });

  // Structure.
  view.hierarchy = {
    root: { ...view.hierarchy.root, children: pruneChildren(view.hierarchy.root.children, removed) },
    links: view.hierarchy.links.filter((l) => keep(l.from) && keep(l.to)),
  };
  view.leavingSite = view.leavingSite
    .map((entry) => ({ ...entry, from: entry.from.filter(keep) }))
    .filter((entry) => entry.from.length > 0);
  view.internalLinking = {
    inboundCounts: Object.fromEntries(Object.entries(view.internalLinking.inboundCounts).filter(([p]) => keep(p))),
    unlinkedPages: view.internalLinking.unlinkedPages.filter(keep),
  };

  // Improvement Roadmap: items left without findings go; the rest follow their kept findings as edited.
  const findingsById = new Map(view.findings.map((f) => [f.id, f]));
  view.roadmap = view.roadmap.flatMap((item) => {
    const kept = item.findingIds.filter(keepFinding);
    if (kept.length === 0) return [];
    const out = { ...item, findingIds: kept, pages: item.pages.filter(keep) };
    const first = findingsById.get(kept[0])!;
    // The first (highest ranked) kept finding names the item, as `buildRoadmap` does.
    if (kept[0] !== item.findingIds[0] || findingEdits.get(first.id)?.title !== undefined) out.title = first.title;
    if (kept.length < item.findingIds.length) {
      const keptFindings = kept.map((id) => findingsById.get(id)!);
      out.priority = keptFindings.map((f) => f.impact).reduce(highestScale);
      out.effort = keptFindings.map((f) => f.effort).reduce(highestScale);
      out.phase = ROADMAP_PHASE[out.priority];
    }
    return [out];
  });

  // Marketing and site-wide notes.
  view.marketing = {
    ...view.marketing,
    readPages: view.marketing.readPages.filter(keep),
    signals: view.marketing.signals.map((s) => ({
      ...s,
      pages: s.pages.filter(keep),
      ...(s.nap ? { nap: s.nap.filter((n) => keep(n.urlPath)) } : {}),
      ...(s.findingIds ? { findingIds: s.findingIds.filter(keepFinding) } : {}),
    })),
  };
  view.siteAreas = view.siteAreas.map((a) =>
    a.status === 'done' ? { ...a, evidence: a.evidence.filter(keepFinding) } : a
  );

  // Page Content with the Section edits.
  const sectionEdits = new Map<string, Map<string, string>>();
  for (const e of overlay.sections) {
    if (!sectionEdits.has(e.urlPath)) sectionEdits.set(e.urlPath, new Map());
    sectionEdits.get(e.urlPath)!.set(e.sectionId, e.text);
  }
  const editedContents = contents
    .filter((c) => keep(c.urlPath))
    .map((c) => applySectionEdits(c, sectionEdits.get(c.urlPath) ?? new Map()));

  const overlayCopy = structuredClone(overlay);
  return { result: view, contents: editedContents, removedPages, proposal: overlayCopy.proposal, overlay: overlayCopy };
}
