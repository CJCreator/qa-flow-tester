import {
  AUDIT_API,
  AUDIT_ERROR_CODES,
  auditPath,
  isShortlistOutcome,
  type AuditErrorCode,
  type AuditGetReply,
  type AuditStartReply,
  type AuditStatus,
  type AuditSummary,
  type AuditVersion,
  type ShortlistEntry,
  type ShortlistListItem,
  type ShortlistListQuery,
  type ShortlistMark,
  type ShortlistOutcome,
  type ShortlistUpdate,
} from '@qa/types/src/browser.js';
import { count } from '../../../lib/format';
import { watchAudit, type AuditEventSourceFactory } from '../start/audit-start-api';

/**
 * The saved Website Audits screens' calls to the runner (REQ-028, REQ-023): the list (`GET /api/audits`), one
 * version (`GET /api/audits/:id?version=n`), re-run (`POST /api/audits/:id/rerun`), delete
 * (`DELETE /api/audits/:id`) and the Shortlist (`GET|PUT /api/audits/:id/shortlist`, `GET /api/shortlist`).
 * Every refusal becomes a plain sentence safe to show as-is; status codes and raw errors never reach the screen.
 */

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type SavedOutcome<T> = { ok: true; value: T } | { ok: false; message: string; code?: AuditErrorCode };

/**
 * The wizard addresses of the Website Audit screens these screens link to. Plain paths, not imports: the
 * wizard router (FE-191) registers a route for each. The preview and Shared Link screen and the Helpers
 * screen are built by other tasks.
 */
export const AUDIT_PATHS = {
  /** The start screen of a new Website Audit. */
  start: '/audits/new',
  list: '/audits',
  history: (auditId: string) => `/audits/${encodeURIComponent(auditId)}`,
  /** One version's results. */
  version: (auditId: string, version: number) => `/audits/${encodeURIComponent(auditId)}/versions/${version}`,
  review: (auditId: string, version: number) => `/audits/${encodeURIComponent(auditId)}/versions/${version}/review`,
  export: (auditId: string, version: number) => `/audits/${encodeURIComponent(auditId)}/versions/${version}/export`,
  previewShare: (auditId: string) => `/audits/${encodeURIComponent(auditId)}/share`,
  helpers: (auditId: string) => `/audits/${encodeURIComponent(auditId)}/helpers`,
  shortlist: '/shortlist',
} as const;

const NOT_ANSWERING = 'The tool is not answering. Make sure it is still open in its terminal, then try again.';

/** Shown when a re-run is refused because the run slot is busy (REQ-028 AC-3). */
export const RUN_IN_PROGRESS_TEXT =
  'Another run is in progress: a Check-up, a benchmark or a Website Audit. Wait for it to finish, then try again.';

const REFUSALS: Partial<Record<AuditErrorCode, string>> = {
  ERR_RUN_IN_PROGRESS: RUN_IN_PROGRESS_TEXT,
  ERR_AUDIT_NOT_FOUND: 'This Website Audit was not found. It may have been deleted.',
  ERR_AUDIT_RUNNING: 'A version of this Website Audit is still running. Try again when it has finished.',
  ERR_FORBIDDEN: 'You do not have permission to do this on this Website Audit.',
};

function isAuditErrorCode(value: unknown): value is AuditErrorCode {
  return typeof value === 'string' && (AUDIT_ERROR_CODES as readonly string[]).includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function withQuery(path: string, query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  const text = params.toString();
  return text === '' ? path : `${path}?${text}`;
}

async function call<T>(
  url: string,
  init: RequestInit,
  fetchImpl: Fetch,
  fallback: string,
  accept: (body: unknown) => T | null
): Promise<SavedOutcome<T>> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch {
    return { ok: false, message: NOT_ANSWERING };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (res.ok) {
    const value = accept(body);
    return value === null ? { ok: false, message: fallback } : { ok: true, value };
  }
  const refusal = isObject(body) ? body : {};
  const code = isAuditErrorCode(refusal.code) ? refusal.code : undefined;
  if (code && REFUSALS[code]) return { ok: false, message: REFUSALS[code]!, code };
  const error = typeof refusal.error === 'string' && refusal.error.trim() !== '' ? refusal.error.trim() : fallback;
  return { ok: false, message: error, code };
}

function isSummary(value: unknown): value is AuditSummary {
  return (
    isObject(value) &&
    typeof value.auditId === 'string' &&
    typeof value.url === 'string' &&
    Array.isArray(value.versions)
  );
}

function isEntry(value: unknown): value is ShortlistEntry {
  return isObject(value) && typeof value.auditId === 'string' && typeof value.notes === 'string';
}

// ---------------------------------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------------------------------

/** `GET /api/audits`: every saved Website Audit the caller may see, each with its versions. */
export function listAudits(fetchImpl: Fetch = fetch): Promise<SavedOutcome<AuditSummary[]>> {
  return call(
    AUDIT_API.list.path,
    { method: AUDIT_API.list.method },
    fetchImpl,
    'Your saved Website Audits could not be listed. Try again.',
    (body) => (isObject(body) && Array.isArray(body.audits) && body.audits.every(isSummary) ? body.audits : null)
  );
}

/** `GET /api/audits/:id?version=n`: one version (the latest when `version` is not given) with its summary. */
export function loadVersion(
  auditId: string,
  version?: number,
  fetchImpl: Fetch = fetch
): Promise<SavedOutcome<AuditGetReply>> {
  return call(
    withQuery(auditPath(AUDIT_API.get.path, { id: auditId }), { version }),
    { method: AUDIT_API.get.method },
    fetchImpl,
    'The Website Audit could not be opened. Try again.',
    (body) =>
      isObject(body) && isSummary(body.summary) && isObject(body.version) ? (body as unknown as AuditGetReply) : null
  );
}

/** `POST /api/audits/:id/rerun`: a new version with the same address and limits. */
export function rerunAudit(auditId: string, fetchImpl: Fetch = fetch): Promise<SavedOutcome<AuditStartReply>> {
  return call(
    auditPath(AUDIT_API.rerun.path, { id: auditId }),
    { method: AUDIT_API.rerun.method },
    fetchImpl,
    'The Website Audit could not be re-run. Try again.',
    (body) =>
      isObject(body) && typeof body.version === 'number' && typeof body.auditId === 'string'
        ? (body as unknown as AuditStartReply)
        : null
  );
}

/**
 * Re-runs, then loads the Website Audit again so its history lists the new version (REQ-028 AC-3). A reload
 * that fails still reports the started version.
 */
export async function rerunAndReload(
  auditId: string,
  fetchImpl: Fetch = fetch
): Promise<SavedOutcome<{ started: AuditStartReply; summary: AuditSummary | null }>> {
  const started = await rerunAudit(auditId, fetchImpl);
  if (!started.ok) return started;
  const reloaded = await loadVersion(auditId, undefined, fetchImpl);
  return { ok: true, value: { started: started.value, summary: reloaded.ok ? reloaded.value.summary : null } };
}

/** `DELETE /api/audits/:id`: every version, edit, file, Shortlist entry, Shared Link and Helper access. */
export function deleteAudit(auditId: string, fetchImpl: Fetch = fetch): Promise<SavedOutcome<true>> {
  return call(
    auditPath(AUDIT_API.remove.path, { id: auditId }),
    { method: AUDIT_API.remove.method },
    fetchImpl,
    'The Website Audit could not be deleted. Try again.',
    (body) => (isObject(body) && body.deleted === true ? true : null)
  );
}

/** `GET /api/audits/:id/shortlist`: the saved Shortlist entry. */
export function loadShortlistEntry(auditId: string, fetchImpl: Fetch = fetch): Promise<SavedOutcome<ShortlistEntry>> {
  return call(
    auditPath(AUDIT_API.getShortlist.path, { id: auditId }),
    { method: AUDIT_API.getShortlist.method },
    fetchImpl,
    'The Shortlist entry could not be loaded. Try again.',
    (body) => (isObject(body) && isEntry(body.entry) ? body.entry : null)
  );
}

/** `PUT /api/audits/:id/shortlist`: only the fields sent change; returns the saved entry. */
export function saveShortlistEntry(
  auditId: string,
  update: ShortlistUpdate,
  fetchImpl: Fetch = fetch
): Promise<SavedOutcome<ShortlistEntry>> {
  return call(
    auditPath(AUDIT_API.putShortlist.path, { id: auditId }),
    {
      method: AUDIT_API.putShortlist.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    },
    fetchImpl,
    'The Shortlist entry could not be saved. Try again.',
    (body) => (isObject(body) && isEntry(body.entry) ? body.entry : null)
  );
}

/** `GET /api/shortlist?mark=&outcome=`: the Shortlist, filtered on the runner. */
export function listShortlist(
  query: ShortlistListQuery = {},
  fetchImpl: Fetch = fetch
): Promise<SavedOutcome<ShortlistListItem[]>> {
  return call(
    withQuery(AUDIT_API.listShortlist.path, { mark: query.mark, outcome: query.outcome }),
    { method: AUDIT_API.listShortlist.method },
    fetchImpl,
    'The Shortlist could not be loaded. Try again.',
    (body) =>
      isObject(body) && Array.isArray(body.entries) && body.entries.every(isEntry)
        ? (body.entries as ShortlistListItem[])
        : null
  );
}

// ---------------------------------------------------------------------------------------------------
// Wording and pure helpers
// ---------------------------------------------------------------------------------------------------

/** Status in words, so it is never shown by colour alone. */
export const STATUS_LABEL: Readonly<Record<AuditStatus, string>> = {
  running: 'Running',
  done: 'Finished',
  failed: 'Failed',
  stopped: 'Stopped',
};

export const MARK_LABEL: Readonly<Record<ShortlistMark, string>> = { pitch: 'Pitch', skip: 'Skip' };

export const SHORTLIST_MARKS: readonly ShortlistMark[] = ['pitch', 'skip'];

/** Every version, oldest first (REQ-028 AC-2). */
export function versionsOldestFirst(summary: AuditSummary): AuditVersion[] {
  return [...summary.versions].sort((a, b) => a.version - b.version);
}

/** The newest version, or null when the Website Audit has none. */
export function latestVersion(summary: AuditSummary): AuditVersion | null {
  const all = versionsOldestFirst(summary);
  return all.length === 0 ? null : all[all.length - 1];
}

/** The newest finished version, or null when none has finished. */
export function latestFinishedVersion(summary: AuditSummary): AuditVersion | null {
  const done = versionsOldestFirst(summary).filter((v) => v.status === 'done');
  return done.length === 0 ? null : done[done.length - 1];
}

/** The newest version that is still running, or null. */
export function runningVersion(summary: AuditSummary): AuditVersion | null {
  const running = versionsOldestFirst(summary).filter((v) => v.status === 'running');
  return running.length === 0 ? null : running[running.length - 1];
}

/**
 * Follows the running version of a Website Audit on `GET /api/audits/:id/stream`. `onProgress` fires for
 * every event; `onEnd` once when it is done, failed or the stream closed for good: the caller re-reads then.
 * Returns a function that closes the stream; a Website Audit with nothing running opens no stream.
 */
export function followRunningVersion(
  summary: AuditSummary,
  handlers: { onProgress?: () => void; onEnd: () => void },
  openSource?: AuditEventSourceFactory
): () => void {
  const running = runningVersion(summary);
  if (!running) return () => {};
  return watchAudit(
    { auditId: summary.auditId, version: running.version },
    {
      onEvent: (event) => {
        handlers.onProgress?.();
        if (event.type === 'done' || event.type === 'failed') handlers.onEnd();
      },
      onEnd: handlers.onEnd,
    },
    openSource
  );
}

/** "12 pages recorded · 2 pages skipped · 7 findings", with only the counts the version has. */
export function versionCounts(version: AuditVersion): string {
  const parts: string[] = [];
  if (version.pagesRecorded !== undefined) parts.push(count(version.pagesRecorded, 'page recorded', 'pages recorded'));
  if (version.pagesSkipped !== undefined) parts.push(count(version.pagesSkipped, 'page skipped', 'pages skipped'));
  if (version.findings !== undefined) parts.push(count(version.findings, 'finding', 'findings'));
  return parts.length === 0 ? 'No counts yet' : parts.join(' · ');
}

/** "Shortlist: Pitch", "Shortlist: Skip", or that there is no mark. */
export function shortlistMarkText(entry: ShortlistEntry | undefined | null): string {
  return entry?.mark ? `Shortlist: ${MARK_LABEL[entry.mark]}` : 'No Shortlist mark';
}

/** What the Shortlist panel's fields hold. */
export interface ShortlistDraft {
  mark: ShortlistMark | null;
  notes: string;
  outcome: ShortlistOutcome | null;
  outcomeNote: string;
}

export function draftFromEntry(entry: ShortlistEntry | null | undefined): ShortlistDraft {
  return {
    mark: entry?.mark ?? null,
    notes: entry?.notes ?? '',
    outcome: entry?.outcome ?? null,
    outcomeNote: entry?.outcomeNote ?? '',
  };
}

/** The fields that differ from the saved entry; an empty object when nothing changed. */
export function shortlistUpdate(saved: ShortlistEntry | null | undefined, draft: ShortlistDraft): ShortlistUpdate {
  const before = draftFromEntry(saved);
  const update: ShortlistUpdate = {};
  if (draft.mark !== before.mark) update.mark = draft.mark;
  if (draft.notes !== before.notes) update.notes = draft.notes;
  if (draft.outcome !== before.outcome) update.outcome = draft.outcome;
  if (draft.outcomeNote !== before.outcomeNote) update.outcomeNote = draft.outcomeNote;
  return update;
}

/** The Shortlist screen's filters: 'all' sends no filter. */
export interface ShortlistFilters {
  mark: ShortlistMark | 'all';
  outcome: ShortlistOutcome | 'all';
}

export function filtersToQuery(filters: ShortlistFilters): ShortlistListQuery {
  const query: ShortlistListQuery = {};
  if (filters.mark !== 'all') query.mark = filters.mark;
  if (filters.outcome !== 'all') query.outcome = filters.outcome;
  return query;
}

/** Reads a filter value from a select; anything unknown is 'all'. */
export function readMarkFilter(value: string): ShortlistFilters['mark'] {
  return value === 'pitch' || value === 'skip' ? value : 'all';
}

export function readOutcomeFilter(value: string): ShortlistFilters['outcome'] {
  return isShortlistOutcome(value) ? value : 'all';
}

/** The same filters applied in the wizard, for a list already loaded. */
export function filterShortlist(items: readonly ShortlistListItem[], filters: ShortlistFilters): ShortlistListItem[] {
  return items.filter(
    (item) =>
      (filters.mark === 'all' || item.mark === filters.mark) &&
      (filters.outcome === 'all' || item.outcome === filters.outcome)
  );
}
