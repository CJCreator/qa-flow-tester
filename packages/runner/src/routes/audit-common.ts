/** Helpers shared by the Website Audit route modules. */
import type http from 'http';
import {
  AuditRecordError,
  AuditStoreError,
  PITCH_TOP_FINDINGS,
  editedViewOf,
  emptyOverlay,
  type AuditStore,
} from '@qa/core';
import type { AuditErrorCode, AuditErrorReply, EditOverlay, AuditResult, PageContent } from '@qa/types';
import { sendJson } from './body.js';

const VERSION = /^[1-9][0-9]{0,6}$/;

/**
 * The `?version=` of a Website Audit request: the number, undefined when the query has none (the caller
 * then uses the latest version), or 'invalid' for anything that is not a whole number from 1.
 */
export function versionQuery(url: URL): number | undefined | 'invalid' {
  const raw = url.searchParams.get('version');
  if (raw === null) return undefined;
  return VERSION.test(raw) ? Number(raw) : 'invalid';
}

/** A refusal with its fixed code and message. */
export function refuse(res: http.ServerResponse, status: number, code: AuditErrorCode, error: string): void {
  const body: AuditErrorReply = { error, code };
  sendJson(res, status, body);
}

export const AUDIT_NOT_FOUND = 'This Website Audit was not found. It may have been deleted.';
export const INVALID_REQUEST = 'The request is not valid.';

export interface StoreFailureSentences {
  notFound?: string;
  failed?: string;
}

export type StoreFailureText = StoreFailureSentences;

/** Store failures become fixed sentences: no keys, paths or provider text reach the caller. */
export function refuseStoreFailure(
  res: http.ServerResponse,
  err: unknown,
  sentences: StoreFailureSentences = {}
): void {
  if (err instanceof AuditRecordError) {
    if (err.code === 'not-found') {
      return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', sentences.notFound ?? AUDIT_NOT_FOUND);
    }
    return refuse(res, 400, 'ERR_INVALID_REQUEST', INVALID_REQUEST);
  }
  if (err instanceof AuditStoreError && err.code === 'invalid-key') {
    return refuse(res, 400, 'ERR_INVALID_REQUEST', INVALID_REQUEST);
  }
  sendJson(res, 500, { error: sentences.failed ?? 'The saved audits could not be read or changed. Try again.' });
}

/** The edit overlay beside a version's result. */
export const EDITS_NAME = 'edits';

/** A version's edits; an empty overlay when none were saved. */
export async function readEdits(store: AuditStore, auditId: string, version: number): Promise<EditOverlay> {
  return (await store.readVersionJson<EditOverlay>(auditId, version, EDITS_NAME)) ?? emptyOverlay();
}

/** Largest screenshot embedded in a Pitch Glimpse. */
const MAX_SCREENSHOT_BYTES = 3_000_000;

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export interface PitchSource {
  auditId: string;
  version: number;
  result: AuditResult;
  contents: PageContent[];
  edits: EditOverlay;
}

/** Screenshots of the findings the Pitch Glimpse shows, as data: URIs. A missing or odd one is left out. */
export async function pitchScreenshots(store: AuditStore, source: PitchSource): Promise<Record<string, string>> {
  const shots: Record<string, string> = {};
  const { auditId, version } = source;
  const top = editedViewOf({
    result: source.result,
    contents: source.contents,
    edits: source.edits,
  }).result.findings.slice(0, PITCH_TOP_FINDINGS);
  for (const finding of top) {
    const name = finding.screenshotPath;
    if (!name || Object.prototype.hasOwnProperty.call(shots, name)) continue;
    const type = IMAGE_TYPES[name.slice(name.lastIndexOf('.') + 1).toLowerCase()];
    if (!type) continue;
    try {
      const bytes = await store.getVersionFile(auditId, version, name);
      if (bytes && bytes.byteLength > 0 && bytes.byteLength <= MAX_SCREENSHOT_BYTES) {
        shots[name] = `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
      }
    } catch {
      // A path the store refuses is shown as "no screenshot", never as an error.
    }
  }
  return shots;
}
