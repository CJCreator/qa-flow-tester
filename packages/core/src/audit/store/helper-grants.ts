/**
 * Helper grants (REQ-033): one per Helper per audit, at `audits/<auditId>/helpers/<sha256(email)>/grant.json`.
 * The Helper index (`helper-index/<sha256(email)>/<auditId>/`) lets `grantsFor(email)` find a Helper's audits
 * without reading every audit; it names no email address. The grant in the audit's folder is the source of
 * truth: an index entry without its grant is ignored. Nothing is cached, so a removal shows on the next read.
 */
import { createHash } from 'crypto';
import { HELPER_PERMISSIONS, type HelperGrant, type HelperPermission } from '@qa/types';
import type { AuditStoreContext } from './audit-store.js';
import {
  assertAuditId,
  helperGrantFolder,
  helperGrantKey,
  helperIndexEmailFolder,
  helperIndexFolder,
  helperIndexKey,
  helpersFolder,
  invalidInput,
  notFound,
} from './keys.js';

/** Longest email address accepted (RFC 5321 path limit). */
export const MAX_HELPER_EMAIL_CHARS = 254;

const EMAIL =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Trims, lower-cases and checks a Helper's Google account address. */
export function normalizeHelperEmail(email: unknown): string {
  if (typeof email !== 'string') throw invalidInput('The Helper email address is not valid.');
  const normalized = email.trim().toLowerCase();
  if (normalized.length > MAX_HELPER_EMAIL_CHARS || !EMAIL.test(normalized)) {
    throw invalidInput('The Helper email address is not valid.');
  }
  return normalized;
}

/** SHA-256 hex of the normalised address: the Helper's key in folder names. */
export function helperEmailHash(normalizedEmail: string): string {
  return createHash('sha256').update(normalizedEmail, 'utf8').digest('hex');
}

/** A non-empty subset of HELPER_PERMISSIONS, without repeats, in HELPER_PERMISSIONS order. */
export function checkHelperPermissions(permissions: unknown): HelperPermission[] {
  if (!Array.isArray(permissions) || permissions.length === 0) {
    throw invalidInput('Choose at least one Helper permission.');
  }
  for (const p of permissions) {
    if (!(HELPER_PERMISSIONS as readonly unknown[]).includes(p)) {
      throw invalidInput('A Helper permission is not valid.');
    }
  }
  return HELPER_PERMISSIONS.filter((p) => permissions.includes(p));
}

/** Gives (or replaces) a Helper's access to one audit. */
export async function grantHelper(
  ctx: AuditStoreContext,
  auditId: string,
  email: string,
  permissions: HelperPermission[]
): Promise<HelperGrant> {
  assertAuditId(auditId);
  const normalized = normalizeHelperEmail(email);
  const checked = checkHelperPermissions(permissions);
  const hash = helperEmailHash(normalized);
  return ctx.withAuditLock(auditId, async () => {
    if (!(await ctx.readAuditRecord(auditId))) throw notFound('audit');
    const grant: HelperGrant = {
      auditId,
      email: normalized,
      permissions: checked,
      grantedAt: ctx.now().toISOString(),
    };
    await ctx.backend.putJson(helperGrantKey(auditId, hash), grant);
    await ctx.backend.putJson(helperIndexKey(hash, auditId), { auditId });
    return grant;
  });
}

/** Removes a Helper's access to one audit. Returns false when there was none. */
export async function removeHelper(ctx: AuditStoreContext, auditId: string, email: string): Promise<boolean> {
  assertAuditId(auditId);
  const hash = helperEmailHash(normalizeHelperEmail(email));
  return ctx.withAuditLock(auditId, async () => {
    const existed = (await ctx.backend.getJson(helperGrantKey(auditId, hash))) !== null;
    // The grant first: it is the source of truth, so access ends even if the index removal fails.
    await ctx.backend.deletePrefix(helperGrantFolder(auditId, hash));
    await ctx.backend.deletePrefix(helperIndexFolder(hash, auditId));
    return existed;
  });
}

const GRANT_RECORD_KEY = /\/helpers\/([a-f0-9]{64})\/grant\.json$/;
const INDEX_ENTRY_KEY = /^helper-index\/[a-f0-9]{64}\/([A-Za-z0-9_-]{8,64})\/entry\.json$/;

async function grantHashesOf(ctx: AuditStoreContext, auditId: string): Promise<string[]> {
  const keys = await ctx.backend.list(helpersFolder(auditId));
  return keys.map((key) => GRANT_RECORD_KEY.exec(key)?.[1]).filter((h): h is string => !!h);
}

/** The audit's Helpers, sorted by email. */
export async function listHelpers(ctx: AuditStoreContext, auditId: string): Promise<HelperGrant[]> {
  const hashes = await grantHashesOf(ctx, auditId);
  const grants = await Promise.all(hashes.map((h) => ctx.backend.getJson<HelperGrant>(helperGrantKey(auditId, h))));
  return grants.filter((g): g is HelperGrant => g !== null).sort((a, b) => a.email.localeCompare(b.email));
}

/** Every grant given to this email address, and only those. */
export async function grantsFor(ctx: AuditStoreContext, email: string): Promise<HelperGrant[]> {
  const normalized = normalizeHelperEmail(email);
  const hash = helperEmailHash(normalized);
  const keys = await ctx.backend.list(helperIndexEmailFolder(hash));
  const auditIds = keys.map((key) => INDEX_ENTRY_KEY.exec(key)?.[1]).filter((id): id is string => !!id);
  const grants = await Promise.all(
    auditIds.map((auditId) => ctx.backend.getJson<HelperGrant>(helperGrantKey(auditId, hash)))
  );
  return grants
    .filter((g): g is HelperGrant => g !== null && g.email === normalized)
    .sort((a, b) => a.auditId.localeCompare(b.auditId));
}

/** Called by deleteAudit (under the audit lock): removes the audit's Helper index entries. */
export async function removeHelperIndexEntries(ctx: AuditStoreContext, auditId: string): Promise<void> {
  for (const hash of await grantHashesOf(ctx, auditId)) {
    await ctx.backend.deletePrefix(helperIndexFolder(hash, auditId));
  }
}
