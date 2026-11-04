import {
  AUDIT_API,
  AUDIT_DOCUMENT_KINDS,
  auditPath,
  type AuditDocumentKind,
  type AuditExportQuery,
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
