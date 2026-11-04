import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { SHARE_LINK_DAYS, SHARE_LINK_ID_PATTERN, type AuditRequest } from '@qa/types';
import {
  AuditRecordError,
  AuditStore,
  LocalAuditStoreBackend,
  shareIndexKey,
  shareRecordKey,
} from '../src/audit/store/index.js';

const REQUEST: AuditRequest = {
  url: 'https://shop.example/',
  limits: { maxPages: 10, maxDepth: 2, includePaths: [], excludePaths: [] },
  language: 'en',
};
const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse('2026-11-03T00:00:00.000Z');

let dir: string;
let backend: LocalAuditStoreBackend;
let clock: number;
let store: AuditStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-shares-'));
  backend = new LocalAuditStoreBackend(dir);
  clock = START;
  store = new AuditStore(backend, { now: () => new Date(clock) });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Shared Links (REQ-019, REQ-024)', () => {
  it('creates a random 128-bit base64url id, expiring SHARE_LINK_DAYS after creation', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    const link = await store.createShare(auditId, { version: 1, kind: 'pitch', language: 'ta' });
    const other = await store.createShare(auditId, { version: 1, kind: 'preview', language: 'en' });
    expect(link.id).toMatch(SHARE_LINK_ID_PATTERN);
    expect(link.id).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    expect(Buffer.from(link.id, 'base64url').length).toBeGreaterThanOrEqual(16);
    expect(link.id).not.toBe(other.id);
    expect(link).toMatchObject({ auditId, version: 1, kind: 'pitch', language: 'ta', revokedAt: null });
    expect(link.createdAt).toBe(new Date(START).toISOString());
    expect(Date.parse(link.expiresAt) - Date.parse(link.createdAt)).toBe(SHARE_LINK_DAYS * DAY);
    // The record lives in the audit's folder; only the index entry is outside it.
    expect(await backend.getJson(shareRecordKey(auditId, link.id))).toEqual(link);
    expect(await backend.getJson(shareIndexKey(link.id))).toEqual({ linkId: link.id, auditId });
    expect((await store.listShares(auditId)).map((l) => l.id).sort()).toEqual([link.id, other.id].sort());
  });

  it('refuses a bad kind, language or a version that does not exist', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    await expect(store.createShare(auditId, { version: 1, kind: 'report' as never, language: 'en' })).rejects.toThrow(
      AuditRecordError
    );
    await expect(store.createShare(auditId, { version: 1, kind: 'pitch', language: 'zz' as never })).rejects.toThrow(
      AuditRecordError
    );
    await expect(store.createShare(auditId, { version: 2, kind: 'pitch', language: 'en' })).rejects.toMatchObject({
      code: 'not-found',
    });
    expect(await store.listShares(auditId)).toEqual([]);
  });

  it('resolves an open link with its audit', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    const link = await store.createShare(auditId, { version: 1, kind: 'pitch', language: 'en' });
    const resolved = await store.resolveShare(link.id);
    expect(resolved.status).toBe('open');
    if (resolved.status !== 'open') return;
    expect(resolved.link).toEqual(link);
    expect(resolved.audit.auditId).toBe(auditId);
  });

  it('is gone once revoked; revoking again keeps the first time', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    const link = await store.createShare(auditId, { version: 1, kind: 'pitch', language: 'en' });
    clock += 1000;
    const revoked = await store.revokeShare(auditId, link.id);
    expect(revoked.revokedAt).toBe(new Date(START + 1000).toISOString());
    clock += 1000;
    expect((await store.revokeShare(auditId, link.id)).revokedAt).toBe(revoked.revokedAt);
    expect(await store.resolveShare(link.id)).toEqual({ status: 'gone' });
  });

  it('is open until 30 days and gone at 30 days plus 1 ms (injected clock)', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    const link = await store.createShare(auditId, { version: 1, kind: 'preview', language: 'en' });
    clock = START + SHARE_LINK_DAYS * DAY - 1;
    expect((await store.resolveShare(link.id)).status).toBe('open');
    clock = START + SHARE_LINK_DAYS * DAY + 1;
    expect(await store.resolveShare(link.id)).toEqual({ status: 'gone' });
  });

  it('is gone when its audit was deleted', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    const link = await store.createShare(auditId, { version: 1, kind: 'pitch', language: 'en' });
    await store.deleteAudit(auditId);
    expect(await store.resolveShare(link.id)).toEqual({ status: 'gone' });
    // The index entry no longer names the audit.
    expect(JSON.stringify(await backend.getJson(shareIndexKey(link.id)))).not.toContain(auditId);
  });

  it('is missing when unknown or malformed', async () => {
    expect(await store.resolveShare('A'.repeat(22))).toEqual({ status: 'missing' });
    expect(await store.resolveShare('short')).toEqual({ status: 'missing' });
    expect(await store.resolveShare('../../audits/x')).toEqual({ status: 'missing' });
  });

  it('refuses to revoke an unknown link', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    await expect(store.revokeShare(auditId, 'B'.repeat(22))).rejects.toMatchObject({ code: 'not-found' });
  });
});
