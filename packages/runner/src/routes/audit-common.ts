/** Helpers shared by the Website Audit route modules. */
import type http from 'http';
import { AuditRecordError, AuditStoreError } from '@qa/core';
import type { AuditErrorCode, AuditErrorReply } from '@qa/types';
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

const INVALID_REQUEST = 'The request is not valid.';

/** The two sentences that change from route to route. */
export interface StoreFailureText {
  /** The 404 sentence for a record that is not there. */
  notFound: string;
  /** The 500 sentence for any other failure. */
  failed: string;
}

/** Store failures become fixed sentences: no keys, paths or backend text reach the caller. */
export function refuseStoreFailure(res: http.ServerResponse, err: unknown, text: StoreFailureText): void {
  if (err instanceof AuditRecordError) {
    if (err.code === 'not-found') return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', text.notFound);
    return refuse(res, 400, 'ERR_INVALID_REQUEST', INVALID_REQUEST);
  }
  if (err instanceof AuditStoreError && err.code === 'invalid-key') {
    return refuse(res, 400, 'ERR_INVALID_REQUEST', INVALID_REQUEST);
  }
  sendJson(res, 500, { error: text.failed });
}
