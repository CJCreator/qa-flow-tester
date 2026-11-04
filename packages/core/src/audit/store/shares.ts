/**
 * Shared Links (REQ-019, REQ-024, Q-30, ADR 0036).
 *
 * The record lives in the audit's folder (`audits/<auditId>/shares/<linkId>/link.json`, beside the
 * shared snapshot). The Shared Link index (`share-index/<linkId>`) maps a link to its audit so `/s/:linkId`
 * can be answered. Deleting the audit turns its index entries into tombstones that name no audit,
 * so a deleted audit's links answer 'gone' (410) at once, not 'missing' (404).
 */
import { randomBytes } from 'crypto';
import {
  AUDIT_ID_PATTERN,
  isDocumentLanguage,
  SHARE_LINK_DAYS,
  SHARE_LINK_ID_PATTERN,
  type AuditSummary,
  type DocumentLanguage,
  type ShareLink,
  type ShareLinkKind,
} from '@qa/types';
import type { AuditStoreContext } from './audit-store.js';
import {
  assertAuditId,
  assertShareLinkId,
  assertVersion,
  invalidInput,
  notFound,
  shareIndexKey,
  shareRecordKey,
  sharesFolder,
} from './keys.js';

/** Random bytes in a Shared Link id: 16 bytes is 128 bits, 22 base64url characters. */
export const SHARE_LINK_ID_BYTES = 16;
export const SHARE_LINK_MS = SHARE_LINK_DAYS * 24 * 60 * 60 * 1000;

const SHARE_LINK_KINDS: readonly ShareLinkKind[] = ['pitch', 'preview'];

/** `share-index/<linkId>`: the audit a live link belongs to, or a tombstone after the audit was deleted. */
type ShareIndexEntry = { linkId: string; auditId: string } | { linkId: string; gone: true };

export type ShareResolution =
  | { status: 'open'; link: ShareLink; audit: AuditSummary }
  /** Revoked, expired, or its audit was deleted: answer 410. */
  | { status: 'gone' }
  /** Unknown or malformed: answer 404. */
  | { status: 'missing' };

export interface CreateShareInput {
  version: number;
  kind: ShareLinkKind;
  language: DocumentLanguage;
}

export function newShareLinkId(): string {
  return randomBytes(SHARE_LINK_ID_BYTES).toString('base64url');
}

export async function createShare(
  ctx: AuditStoreContext,
  auditId: string,
  input: CreateShareInput
): Promise<ShareLink> {
  assertAuditId(auditId);
  if (!input || typeof input !== 'object') throw invalidInput('The Shared Link request is not valid.');
  assertVersion(input.version);
  if (!SHARE_LINK_KINDS.includes(input.kind)) throw invalidInput('Only a Pitch Glimpse or a preview can be shared.');
  if (!isDocumentLanguage(input.language)) throw invalidInput('The language is not valid.');
  const { version, kind, language } = input;
  return ctx.withAuditLock(auditId, async () => {
    if (!(await ctx.readVersion(auditId, version))) throw notFound('version');
    let id = newShareLinkId();
    // 128 random bits never collide in practice; the check keeps an index entry from being reused.
    while ((await ctx.backend.getJson(shareIndexKey(id))) !== null) id = newShareLinkId();
    const created = ctx.now();
    const link: ShareLink = {
      id,
      auditId,
      version,
      kind,
      language,
      createdAt: created.toISOString(),
      expiresAt: new Date(created.getTime() + SHARE_LINK_MS).toISOString(),
      revokedAt: null,
    };
    await ctx.backend.putJson(shareRecordKey(auditId, id), link);
    const entry: ShareIndexEntry = { linkId: id, auditId };
    await ctx.backend.putJson(shareIndexKey(id), entry);
    return link;
  });
}

/** Sets revokedAt (once: revoking again keeps the first time). */
export async function revokeShare(ctx: AuditStoreContext, auditId: string, linkId: string): Promise<ShareLink> {
  const key = shareRecordKey(auditId, linkId);
  return ctx.withAuditLock(auditId, async () => {
    const link = await ctx.backend.getJson<ShareLink>(key);
    if (!link) throw notFound('share');
    if (link.revokedAt) return link;
    const revoked: ShareLink = { ...link, revokedAt: ctx.now().toISOString() };
    await ctx.backend.putJson(key, revoked);
    return revoked;
  });
}

const LINK_RECORD_KEY = /\/shares\/([A-Za-z0-9_-]{22,128})\/link\.json$/;

async function linkIdsOf(ctx: AuditStoreContext, auditId: string): Promise<string[]> {
  const keys = await ctx.backend.list(sharesFolder(auditId));
  return keys.map((key) => LINK_RECORD_KEY.exec(key)?.[1]).filter((id): id is string => !!id);
}

/** The audit's Shared Links, oldest first, revoked and expired ones included. */
export async function listShares(ctx: AuditStoreContext, auditId: string): Promise<ShareLink[]> {
  const ids = await linkIdsOf(ctx, auditId);
  const links = await Promise.all(ids.map((id) => ctx.backend.getJson<ShareLink>(shareRecordKey(auditId, id))));
  return links
    .filter((link): link is ShareLink => link !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Answers `/s/:linkId`: the link and its audit when open; 'gone' or 'missing' otherwise. */
export async function resolveShare(ctx: AuditStoreContext, linkId: string): Promise<ShareResolution> {
  // Malformed ids never reach the backend.
  if (typeof linkId !== 'string' || !SHARE_LINK_ID_PATTERN.test(linkId)) return { status: 'missing' };
  const entry = await ctx.backend.getJson<ShareIndexEntry>(shareIndexKey(linkId));
  if (!entry || typeof entry !== 'object') return { status: 'missing' };
  if (!('auditId' in entry) || typeof entry.auditId !== 'string' || !AUDIT_ID_PATTERN.test(entry.auditId)) {
    return { status: 'gone' };
  }
  const auditId = entry.auditId;
  const link = await ctx.backend.getJson<ShareLink>(shareRecordKey(auditId, linkId));
  if (!link || link.id !== linkId || link.auditId !== auditId) return { status: 'gone' };
  if (link.revokedAt) return { status: 'gone' };
  const expiresAt = Date.parse(link.expiresAt);
  if (!Number.isFinite(expiresAt) || ctx.now().getTime() >= expiresAt) return { status: 'gone' };
  const audit = await ctx.getAudit(auditId);
  if (!audit || !audit.versions.some((v) => v.version === link.version)) return { status: 'gone' };
  return { status: 'open', link, audit };
}

/** Called by deleteAudit (under the audit lock): every index entry of the audit becomes a tombstone. */
export async function tombstoneShares(ctx: AuditStoreContext, auditId: string): Promise<void> {
  for (const linkId of await linkIdsOf(ctx, auditId)) {
    assertShareLinkId(linkId);
    const tombstone: ShareIndexEntry = { linkId, gone: true };
    await ctx.backend.putJson(shareIndexKey(linkId), tombstone);
  }
}
