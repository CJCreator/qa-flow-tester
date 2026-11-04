/**
 * Website Audit store key layout (ADR 0036, Q-39).
 *
 * Everything an audit owns lives under `audits/<auditId>/`; each version under `audits/<auditId>/v<n>/`.
 * The only cross-audit objects are the Shared Link index (`share-index/<linkId>`) and the Helper index
 * (`helper-index/<sha256(email)>/<auditId>/`). Every id, version and name is checked against its pattern
 * here, before any key reaches a backend.
 *
 * Objects that must be removable on their own are kept in a folder of their own, because a backend
 * only deletes whole folders (`deletePrefix`).
 */
import { AUDIT_ID_PATTERN, SHARE_LINK_ID_PATTERN } from '@qa/types';
import { AuditStoreError } from './backend.js';

export const AUDITS_FOLDER = 'audits';
export const SHARE_INDEX_FOLDER = 'share-index';
export const HELPER_INDEX_FOLDER = 'helper-index';

/** Highest version number accepted: far above any real re-run count, low enough to stay a short key. */
export const MAX_AUDIT_VERSION = 100_000;

/** Generic per-version JSON names, such as `edits`, `rewrites` or `pages/home`. Stored as `<name>.json`. */
export const VERSION_JSON_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}(?:\/[A-Za-z0-9_-][A-Za-z0-9_-]{0,127}){0,2}$/;

/**
 * Generic per-version file names, such as `preview.html` or `screenshots/home-phone.png`.
 * Each part starts with a letter, digit, dash or underscore, so no part is '.' or '..'.
 * JSON belongs in the JSON methods, so a file name never ends in `.json` (no clash with a JSON object).
 */
export const VERSION_FILE_NAME_PATTERN =
  /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}\/){0,2}[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;

/** Names the store writes itself; the generic JSON methods refuse them. */
export const RESERVED_VERSION_JSON_NAMES: readonly string[] = ['version', 'result'];

/** SHA-256 of a normalised email address, as lower-case hex. */
export const EMAIL_HASH_PATTERN = /^[a-f0-9]{64}$/;

export type AuditRecordErrorCode = 'invalid-input' | 'not-found';

/**
 * A request the store will not carry out: a field value it refuses ('invalid-input', HTTP 400)
 * or an audit or version that does not exist ('not-found', HTTP 404). Fixed wording, no stored data.
 * Malformed ids, versions and names throw AuditStoreError('invalid-key') instead, before any I/O.
 */
export class AuditRecordError extends Error {
  readonly code: AuditRecordErrorCode;
  constructor(code: AuditRecordErrorCode, message: string) {
    super(message);
    this.name = 'AuditRecordError';
    this.code = code;
  }
}

export function invalidInput(message: string): AuditRecordError {
  return new AuditRecordError('invalid-input', message);
}

const NOT_FOUND_MESSAGES = {
  audit: 'Website Audit not found.',
  version: 'Audit version not found.',
  share: 'Shared Link not found.',
} as const;

export function notFound(what: keyof typeof NOT_FOUND_MESSAGES): AuditRecordError {
  return new AuditRecordError('not-found', NOT_FOUND_MESSAGES[what]);
}

function refused(what: string): AuditStoreError {
  return new AuditStoreError('invalid-key', `Audit store refused the ${what}.`);
}

export function assertAuditId(auditId: unknown): asserts auditId is string {
  if (typeof auditId !== 'string' || !AUDIT_ID_PATTERN.test(auditId)) throw refused('audit id');
}

export function assertVersion(version: unknown): asserts version is number {
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > MAX_AUDIT_VERSION) {
    throw refused('version number');
  }
}

export function assertShareLinkId(linkId: unknown): asserts linkId is string {
  if (typeof linkId !== 'string' || !SHARE_LINK_ID_PATTERN.test(linkId)) throw refused('Shared Link id');
}

export function assertEmailHash(hash: unknown): asserts hash is string {
  if (typeof hash !== 'string' || !EMAIL_HASH_PATTERN.test(hash)) throw refused('Helper key');
}

export function assertVersionJsonName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !VERSION_JSON_NAME_PATTERN.test(name) || RESERVED_VERSION_JSON_NAMES.includes(name)) {
    throw refused('version object name');
  }
}

export function assertVersionFileName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !VERSION_FILE_NAME_PATTERN.test(name) || name.toLowerCase().endsWith('.json')) {
    throw refused('version file name');
  }
}

/** `audits/<auditId>` (a folder). */
export function auditFolder(auditId: string): string {
  assertAuditId(auditId);
  return `${AUDITS_FOLDER}/${auditId}`;
}

/** The saved-audit record: `audits/<auditId>/audit.json`. */
export function auditRecordKey(auditId: string): string {
  return `${auditFolder(auditId)}/audit.json`;
}

/** `audits/<auditId>/v<n>` (a folder). */
export function versionFolder(auditId: string, version: number): string {
  assertVersion(version);
  return `${auditFolder(auditId)}/v${version}`;
}

/** The version record: `audits/<auditId>/v<n>/version.json`. */
export function versionRecordKey(auditId: string, version: number): string {
  return `${versionFolder(auditId, version)}/version.json`;
}

/** The AuditResult: `audits/<auditId>/v<n>/result.json`. */
export function resultKey(auditId: string, version: number): string {
  return `${versionFolder(auditId, version)}/result.json`;
}

/** Generic per-version JSON: `audits/<auditId>/v<n>/<name>.json` (edits, rewrites, Page Content...). */
export function versionJsonKey(auditId: string, version: number, name: string): string {
  assertVersionJsonName(name);
  return `${versionFolder(auditId, version)}/${name}.json`;
}

/** Generic per-version file: `audits/<auditId>/v<n>/<name>` (preview.html, screenshots...). */
export function versionFileKey(auditId: string, version: number, name: string): string {
  assertVersionFileName(name);
  return `${versionFolder(auditId, version)}/${name}`;
}

/** The Shortlist entry: `audits/<auditId>/shortlist.json`. */
export function shortlistKey(auditId: string): string {
  return `${auditFolder(auditId)}/shortlist.json`;
}

/** `audits/<auditId>/shares` (a folder holding one folder per Shared Link). */
export function sharesFolder(auditId: string): string {
  return `${auditFolder(auditId)}/shares`;
}

/** `audits/<auditId>/shares/<linkId>` (a folder: the link record and its shared snapshot). */
export function shareFolder(auditId: string, linkId: string): string {
  assertShareLinkId(linkId);
  return `${sharesFolder(auditId)}/${linkId}`;
}

/** The Shared Link record: `audits/<auditId>/shares/<linkId>/link.json`. */
export function shareRecordKey(auditId: string, linkId: string): string {
  return `${shareFolder(auditId, linkId)}/link.json`;
}

/** The shared snapshot served at `/s/<linkId>`: `audits/<auditId>/shares/<linkId>/snapshot.html`. */
export function shareSnapshotKey(auditId: string, linkId: string): string {
  return `${shareFolder(auditId, linkId)}/snapshot.html`;
}

/** The Shared Link index entry: `share-index/<linkId>` (linkId to auditId, or a tombstone). */
export function shareIndexKey(linkId: string): string {
  assertShareLinkId(linkId);
  return `${SHARE_INDEX_FOLDER}/${linkId}`;
}

/** `audits/<auditId>/helpers` (a folder holding one folder per Helper). */
export function helpersFolder(auditId: string): string {
  return `${auditFolder(auditId)}/helpers`;
}

/** `audits/<auditId>/helpers/<sha256(email)>` (a folder). */
export function helperGrantFolder(auditId: string, emailHash: string): string {
  assertEmailHash(emailHash);
  return `${helpersFolder(auditId)}/${emailHash}`;
}

/** The Helper grant: `audits/<auditId>/helpers/<sha256(email)>/grant.json`. */
export function helperGrantKey(auditId: string, emailHash: string): string {
  return `${helperGrantFolder(auditId, emailHash)}/grant.json`;
}

/** `helper-index/<sha256(email)>` (a folder holding one folder per audit). */
export function helperIndexEmailFolder(emailHash: string): string {
  assertEmailHash(emailHash);
  return `${HELPER_INDEX_FOLDER}/${emailHash}`;
}

/** `helper-index/<sha256(email)>/<auditId>` (a folder). */
export function helperIndexFolder(emailHash: string, auditId: string): string {
  assertAuditId(auditId);
  return `${helperIndexEmailFolder(emailHash)}/${auditId}`;
}

/** The Helper index entry: `helper-index/<sha256(email)>/<auditId>/entry.json`. */
export function helperIndexKey(emailHash: string, auditId: string): string {
  return `${helperIndexFolder(emailHash, auditId)}/entry.json`;
}
