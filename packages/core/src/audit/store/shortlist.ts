/**
 * Shortlist entries (REQ-023): one per Website Audit, at `audits/<auditId>/shortlist.json`,
 * so deleting the audit deletes the entry (its notes can hold an owner's personal details).
 */
import {
  isShortlistOutcome,
  type ShortlistEntry,
  type ShortlistListItem,
  type ShortlistMark,
  type ShortlistOutcome,
  type ShortlistUpdate,
} from '@qa/types';
import type { AuditStoreContext } from './audit-store.js';
import { assertAuditId, invalidInput, notFound, shortlistKey } from './keys.js';

/** Longest Shortlist notes, in characters. */
export const MAX_SHORTLIST_NOTES_CHARS = 4000;
/** Longest free-text outcome note, in characters. */
export const MAX_SHORTLIST_OUTCOME_NOTE_CHARS = 1000;

export interface ShortlistFilter {
  /** Only entries with this mark; null means entries with no mark. */
  mark?: ShortlistMark | null;
  /** Only entries with this outcome; null means entries with no outcome. */
  outcome?: ShortlistOutcome | null;
}

export function isShortlistMark(value: unknown): value is ShortlistMark {
  return value === 'pitch' || value === 'skip';
}

/** Checks a ShortlistUpdate and copies only its known fields. */
export function checkShortlistUpdate(input: unknown): ShortlistUpdate {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalidInput('The Shortlist update is not valid.');
  }
  const update = input as Record<string, unknown>;
  const out: ShortlistUpdate = {};
  if (update.mark !== undefined) {
    if (update.mark !== null && !isShortlistMark(update.mark)) throw invalidInput('The mark must be pitch or skip.');
    out.mark = update.mark as ShortlistMark | null;
  }
  if (update.outcome !== undefined) {
    if (update.outcome !== null && !isShortlistOutcome(update.outcome)) {
      throw invalidInput('The outcome is not one of the listed outcomes.');
    }
    out.outcome = update.outcome as ShortlistOutcome | null;
  }
  if (update.notes !== undefined) {
    if (typeof update.notes !== 'string' || update.notes.length > MAX_SHORTLIST_NOTES_CHARS) {
      throw invalidInput(`The notes must be text of at most ${MAX_SHORTLIST_NOTES_CHARS} characters.`);
    }
    out.notes = update.notes;
  }
  if (update.outcomeNote !== undefined) {
    if (typeof update.outcomeNote !== 'string' || update.outcomeNote.length > MAX_SHORTLIST_OUTCOME_NOTE_CHARS) {
      throw invalidInput(`The outcome note must be text of at most ${MAX_SHORTLIST_OUTCOME_NOTE_CHARS} characters.`);
    }
    out.outcomeNote = update.outcomeNote;
  }
  return out;
}

export async function getShortlist(ctx: AuditStoreContext, auditId: string): Promise<ShortlistEntry | null> {
  return ctx.backend.getJson<ShortlistEntry>(shortlistKey(auditId));
}

/** Applies an update: only the fields sent change; null clears the mark or the outcome. */
export async function putShortlist(
  ctx: AuditStoreContext,
  auditId: string,
  update: ShortlistUpdate
): Promise<ShortlistEntry> {
  assertAuditId(auditId);
  const checked = checkShortlistUpdate(update);
  return ctx.withAuditLock(auditId, async () => {
    if (!(await ctx.readAuditRecord(auditId))) throw notFound('audit');
    const current = await getShortlist(ctx, auditId);
    const entry: ShortlistEntry = {
      auditId,
      mark: current?.mark ?? null,
      notes: current?.notes ?? '',
      outcome: current?.outcome ?? null,
      outcomeNote: current?.outcomeNote ?? '',
      ...checked,
      updatedAt: ctx.now().toISOString(),
    };
    await ctx.backend.putJson(shortlistKey(auditId), entry);
    return entry;
  });
}

/** Every Shortlist entry with its audit's address, newest audit first, filtered by mark and outcome. */
export async function listShortlist(ctx: AuditStoreContext, filter: ShortlistFilter = {}): Promise<ShortlistListItem[]> {
  if (filter.mark !== undefined && filter.mark !== null && !isShortlistMark(filter.mark)) {
    throw invalidInput('The mark must be pitch or skip.');
  }
  if (filter.outcome !== undefined && filter.outcome !== null && !isShortlistOutcome(filter.outcome)) {
    throw invalidInput('The outcome is not one of the listed outcomes.');
  }
  const audits = await ctx.listAudits();
  const items: ShortlistListItem[] = [];
  for (const audit of audits) {
    const entry = audit.shortlist;
    if (!entry) continue;
    if (filter.mark !== undefined && entry.mark !== filter.mark) continue;
    if (filter.outcome !== undefined && entry.outcome !== filter.outcome) continue;
    items.push({ ...entry, url: audit.url, host: audit.host });
  }
  return items;
}
