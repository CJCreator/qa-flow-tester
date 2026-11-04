import {
  AUDIT_API,
  AUDIT_DOCUMENT_KINDS,
  auditPath,
  type AuditDocumentKind,
  type AuditExportQuery,
  type AuditStatus,
  type ExportFormat,
  type OwnerAuditQuery,
  type PitchQuery,
} from '@qa/types/src/browser.js';

/**
 * The export panel's download links (REQ-021, REQ-022, REQ-019, REQ-025): the Audit Documents
 * (`GET /api/audits/:id/export`), the Pitch Glimpse (`GET /api/audits/:id/pitch`) and the Owner Audit
 * (`GET /api/audits/:id/owner`). Every link is a plain GET the browser downloads; nothing here sends
 * anything to anyone (REQ-019 AC-4).
 */

/** The languages the export panel offers. */
export const EXPORT_LANGUAGES = ['en', 'ta'] as const;
export type ExportLanguage = (typeof EXPORT_LANGUAGES)[number];

export type PitchFormat = NonNullable<PitchQuery['format']>;
export const PITCH_FORMATS: readonly PitchFormat[] = ['html', 'pdf'];

export type OwnerAuditFormat = NonNullable<OwnerAuditQuery['format']>;
export const OWNER_AUDIT_FORMATS: readonly OwnerAuditFormat[] = ['md', 'html', 'pdf', 'docx'];

export interface ExportChoice {
  format: ExportFormat;
  documents: AuditDocumentKind[];
  language: ExportLanguage;
}

export interface PitchChoice {
  format: PitchFormat;
  language: ExportLanguage;
}

export interface OwnerAuditChoice {
  format: OwnerAuditFormat;
  language: ExportLanguage;
}

/** All five Audit Documents, in English, as Markdown. */
export function defaultExportChoice(): ExportChoice {
  return { format: 'md', documents: [...AUDIT_DOCUMENT_KINDS], language: 'en' };
}

export function defaultPitchChoice(): PitchChoice {
  return { format: 'pdf', language: 'en' };
}

export function defaultOwnerAuditChoice(): OwnerAuditChoice {
  return { format: 'pdf', language: 'en' };
}

/** Ticks or unticks one Audit Document; the list keeps the order of `AUDIT_DOCUMENT_KINDS`. */
export function setDocument(choice: ExportChoice, kind: AuditDocumentKind, picked: boolean): ExportChoice {
  const next = new Set(choice.documents);
  if (picked) next.add(kind);
  else next.delete(kind);
  return { ...choice, documents: AUDIT_DOCUMENT_KINDS.filter((k) => next.has(k)) };
}

function withQuery(path: string, query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  const text = params.toString();
  return text === '' ? path : `${path}?${text}`;
}

/**
 * The Audit Documents download: `format`, the ticked `documents` as a comma-separated list, `language`,
 * and `version` when given. Null when no Audit Document is ticked: there is nothing to download.
 */
export function exportUrl(auditId: string, choice: ExportChoice, version?: number): string | null {
  const documents = AUDIT_DOCUMENT_KINDS.filter((k) => choice.documents.includes(k));
  if (documents.length === 0) return null;
  const query: AuditExportQuery = { format: choice.format, documents, language: choice.language, version };
  return withQuery(auditPath(AUDIT_API.export.path, { id: auditId }), {
    format: query.format,
    documents: query.documents?.join(','),
    language: query.language,
    version: query.version,
  });
}

/** The Pitch Glimpse download: one A4 page, HTML or PDF. */
export function pitchUrl(auditId: string, choice: PitchChoice, version?: number): string {
  const query: PitchQuery = { format: choice.format, language: choice.language, version };
  return withQuery(auditPath(AUDIT_API.pitch.path, { id: auditId }), { ...query });
}

/** The Owner Audit download. */
export function ownerAuditUrl(auditId: string, choice: OwnerAuditChoice, version?: number): string {
  const query: OwnerAuditQuery = { format: choice.format, language: choice.language, version };
  return withQuery(auditPath(AUDIT_API.owner.path, { id: auditId }), { ...query });
}

// ---------------------------------------------------------------------------------------------------
// Saving a file (T-70)
// ---------------------------------------------------------------------------------------------------

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type DownloadOutcome = { ok: true; fileName: string; blob: Blob } | { ok: false; message: string };

const NOT_ANSWERING = 'The tool is not answering. Make sure it is still open in its terminal, then try again.';
const DOWNLOAD_FAILED = 'The file could not be made. Try again.';

/** Which of the three downloads. */
export type DownloadKind = 'documents' | 'pitch' | 'owner';

/** A sensible file name for when the reply names none. */
export function fallbackFileName(kind: DownloadKind, format: ExportFormat): string {
  const base = kind === 'documents' ? 'audit-documents' : kind === 'pitch' ? 'pitch-glimpse' : 'owner-audit';
  return `${base}.${format === 'bundle' ? 'zip' : format}`;
}

/** The file name of a Content-Disposition header, with no folder part; the fallback when it has none. */
export function fileNameFrom(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  let name: string | undefined;
  const star = disposition.match(/filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/);
  if (star) {
    try {
      name = decodeURIComponent(star[1]!.trim());
    } catch {
      name = undefined;
    }
  }
  if (!name) {
    const plain = disposition.match(/filename\s*=\s*(?:"([^"]*)"|([^;]+))/);
    name = (plain?.[1] ?? plain?.[2])?.trim();
  }
  const clean = name?.split(/[\\/]/).pop()?.trim();
  return clean ? clean : fallback;
}

/** The reason an export cannot start for a version with this status; null when it can. */
export function exportBlockedReason(status: AuditStatus | undefined): string | null {
  if (status === 'running') return 'This version is still running. Download it when it has finished.';
  if (status === 'failed') return 'This version did not finish, so there is nothing to download.';
  return null;
}

/** Fetches one download. A non-OK JSON reply becomes the runner's own message; nothing is saved then. */
export async function fetchDownload(
  url: string,
  fallbackName: string,
  fetchImpl: Fetch = fetch
): Promise<DownloadOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'GET' });
  } catch {
    return { ok: false, message: NOT_ANSWERING };
  }
  if (!res.ok) {
    let message = DOWNLOAD_FAILED;
    try {
      const body: unknown = await res.json();
      const text = body !== null && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
      if (typeof text === 'string' && text.trim() !== '') message = text.trim();
    } catch {
      // not JSON: the fixed sentence
    }
    return { ok: false, message };
  }
  try {
    const blob = await res.blob();
    return { ok: true, blob, fileName: fileNameFrom(res.headers.get('Content-Disposition'), fallbackName) };
  } catch {
    return { ok: false, message: DOWNLOAD_FAILED };
  }
}

/** Saves a blob through a temporary link, then frees the object URL. */
export function saveBlob(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
