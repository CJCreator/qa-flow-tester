import {
  AUDIT_API,
  AUDIT_ERROR_CODES,
  auditPath,
  type AuditErrorCode,
  type DocumentLanguage,
  type OverlapFlag,
  type RewriteState,
} from '@qa/types/src/browser.js';

/**
 * The Section rewrite's calls to the runner (REQ-030): the saved rewrites of a version
 * (`GET /api/audits/:id/rewrite`), the approval (`POST …/rewrite/approve`), the AI writing new copy
 * (`POST …/rewrite`, only after approval) and the accept (`POST …/rewrite/accept`, refused with ERR_OVERLAP
 * while copied phrases remain). Every refusal becomes a plain sentence safe to show as-is; status codes and raw
 * errors never reach the screen. New copy goes into the Audit Documents only, never onto the site.
 */

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type RewriteOutcome<T> =
  { ok: true; value: T } | { ok: false; message: string; code?: AuditErrorCode; overlaps?: OverlapFlag[] };

export const NOT_ANSWERING = 'The tool is not answering. Make sure it is still open in its terminal, then try again.';
export const NO_AI_KEY = 'Add an AI key in Settings to write new copy.';
export const NOT_APPROVED = 'Approve this Section for a rewrite first.';
export const AI_UNAVAILABLE = 'The AI did not write new copy. Try again later.';
export const OVERLAP_FALLBACK = 'This copy still repeats phrases from the original. Reword the marked phrases.';

const REFUSALS: Partial<Record<AuditErrorCode, string>> = {
  ERR_NO_AI_KEY: NO_AI_KEY,
  ERR_NOT_APPROVED: NOT_APPROVED,
  ERR_AUDIT_NOT_FOUND: 'This Website Audit was not found. It may have been deleted.',
  ERR_AUDIT_RUNNING: 'This version of the Website Audit is still running. Rewrite its Sections when it has finished.',
  ERR_FORBIDDEN: 'You do not have permission to do this on this Website Audit.',
};

function isAuditErrorCode(value: unknown): value is AuditErrorCode {
  return typeof value === 'string' && (AUDIT_ERROR_CODES as readonly string[]).includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isOverlapFlag(value: unknown): value is OverlapFlag {
  return isObject(value) && typeof value.words === 'string' && typeof value.wordCount === 'number';
}

/** The overlaps of a reply, keeping only well-formed ones. */
function overlapsOf(value: unknown): OverlapFlag[] {
  return Array.isArray(value) ? value.filter(isOverlapFlag) : [];
}

function isRewriteState(value: unknown): value is RewriteState {
  if (!isObject(value)) return false;
  if (typeof value.urlPath !== 'string' || typeof value.sectionId !== 'string') return false;
  if (value.approvedAt !== null && typeof value.approvedAt !== 'string') return false;
  if (value.acceptedAt !== null && typeof value.acceptedAt !== 'string') return false;
  const p = value.proposal;
  return p === null || (isObject(p) && typeof p.text === 'string' && Array.isArray(p.overlaps));
}

/** A rewrite with only well-formed overlaps, so the screen can trust them. */
function cleanRewrite(value: RewriteState): RewriteState {
  return value.proposal
    ? { ...value, proposal: { ...value.proposal, overlaps: overlapsOf(value.proposal.overlaps) } }
    : value;
}

function acceptRewriteReply(body: unknown): RewriteState | null {
  return isObject(body) && isRewriteState(body.rewrite) ? cleanRewrite(body.rewrite) : null;
}

/** `?version=2`, when it is set. */
function withVersion(path: string, version: number | undefined): string {
  return version === undefined ? path : `${path}?version=${encodeURIComponent(String(version))}`;
}

async function call<T>(
  url: string,
  init: RequestInit,
  fetchImpl: Fetch,
  fallback: string,
  accept: (body: unknown) => T | null
): Promise<RewriteOutcome<T>> {
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
  if (code === 'ERR_OVERLAP') {
    return {
      ok: false,
      message: refusalText(refusal) ?? OVERLAP_FALLBACK,
      code,
      overlaps: overlapsOf(refusal.overlaps),
    };
  }
  if (code && REFUSALS[code]) return { ok: false, message: REFUSALS[code]!, code };
  return { ok: false, message: refusalText(refusal) ?? fallback, code };
}

/** The refusal's own sentence (`error`, or `message`), when it has one. */
function refusalText(refusal: Record<string, unknown>): string | undefined {
  for (const key of ['error', 'message']) {
    const value = refusal[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return undefined;
}

function post(body: unknown): RequestInit {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** `GET /api/audits/:id/rewrite`: every saved rewrite of the version. */
export function listRewrites(
  auditId: string,
  version?: number,
  fetchImpl: Fetch = fetch
): Promise<RewriteOutcome<RewriteState[]>> {
  return call(
    withVersion(auditPath(AUDIT_API.listRewrites.path, { id: auditId }), version),
    { method: AUDIT_API.listRewrites.method },
    fetchImpl,
    'The saved rewrites could not be loaded. Try again.',
    (body) =>
      isObject(body) && Array.isArray(body.rewrites) ? body.rewrites.filter(isRewriteState).map(cleanRewrite) : null
  );
}

export interface RewriteTarget {
  urlPath: string;
  sectionId: string;
  version?: number;
}

/** `POST /api/audits/:id/rewrite/approve`: approves one Section for a rewrite. */
export function approveRewrite(
  auditId: string,
  target: RewriteTarget,
  fetchImpl: Fetch = fetch
): Promise<RewriteOutcome<RewriteState>> {
  return call(
    auditPath(AUDIT_API.approveRewrite.path, { id: auditId }),
    { method: AUDIT_API.approveRewrite.method, ...post(target) },
    fetchImpl,
    'The Section could not be approved for a rewrite. Try again.',
    acceptRewriteReply
  );
}

/**
 * `POST /api/audits/:id/rewrite`: the AI writes new copy for an approved Section. Without an approval no
 * request is sent at all (REQ-030 AC-1). An AI failure comes back as one plain sentence.
 */
export async function writeNewCopy(
  auditId: string,
  current: RewriteState | undefined,
  target: RewriteTarget & { language?: DocumentLanguage },
  fetchImpl: Fetch = fetch
): Promise<RewriteOutcome<RewriteState>> {
  if (!current?.approvedAt) return { ok: false, message: NOT_APPROVED, code: 'ERR_NOT_APPROVED' };
  return call(
    auditPath(AUDIT_API.runRewrite.path, { id: auditId }),
    { method: AUDIT_API.runRewrite.method, ...post(target) },
    fetchImpl,
    AI_UNAVAILABLE,
    acceptRewriteReply
  );
}

/** `POST /api/audits/:id/rewrite/accept`: accepts the (edited) copy; ERR_OVERLAP comes back with the phrases. */
export function acceptNewCopy(
  auditId: string,
  target: RewriteTarget & { text: string },
  fetchImpl: Fetch = fetch
): Promise<RewriteOutcome<RewriteState>> {
  return call(
    auditPath(AUDIT_API.acceptRewrite.path, { id: auditId }),
    { method: AUDIT_API.acceptRewrite.method, ...post(target) },
    fetchImpl,
    'The new copy could not be accepted. Try again.',
    acceptRewriteReply
  );
}

// ---------------------------------------------------------------------------------------------------
// Marking copied phrases
// ---------------------------------------------------------------------------------------------------

/** A piece of text, marked when it is part of a copied phrase. */
export interface TextPiece {
  text: string;
  copied: boolean;
}

const WORD = /[\p{L}\p{M}\p{N}­​-‍⁠﻿]+(?:['’][\p{L}\p{M}\p{N}­​-‍⁠﻿]+)*/gu;
const INVISIBLE_JOINERS = /[­​-‍⁠﻿]/g;
const APOSTROPHES = /['’]/g;

/** The text's words with where each one is, normalised like the runner's overlap check. */
function words(text: string): Array<{ word: string; start: number; end: number }> {
  const out: Array<{ word: string; start: number; end: number }> = [];
  for (const match of text.matchAll(WORD)) {
    const word = match[0].normalize('NFC').replace(INVISIBLE_JOINERS, '').replace(APOSTROPHES, '').toLowerCase();
    const start = match.index ?? 0;
    if (word !== '') out.push({ word, start, end: start + match[0].length });
  }
  return out;
}

/**
 * The text split into pieces, with every run of words that matches an OverlapFlag marked as copied. The
 * flags' words are normalised (lower case, no punctuation), so the match is on words, not characters.
 */
export function markCopiedPhrases(text: string, overlaps: readonly OverlapFlag[]): TextPiece[] {
  const list = words(text);
  const ranges: Array<[number, number]> = [];
  for (const flag of overlaps) {
    const wanted = flag.words.split(' ').filter((w) => w !== '');
    if (wanted.length === 0) continue;
    for (let i = 0; i + wanted.length <= list.length; i++) {
      if (wanted.every((w, k) => list[i + k]!.word === w))
        ranges.push([list[i]!.start, list[i + wanted.length - 1]!.end]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  const pieces: TextPiece[] = [];
  let at = 0;
  for (const [start, end] of merged) {
    if (start > at) pieces.push({ text: text.slice(at, start), copied: false });
    pieces.push({ text: text.slice(start, end), copied: true });
    at = end;
  }
  if (at < text.length) pieces.push({ text: text.slice(at), copied: false });
  return pieces;
}

/** "6 words" or "1 word". */
export function wordCountText(count: number): string {
  return count === 1 ? '1 word' : `${count} words`;
}
