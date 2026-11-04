import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { AuditRequest } from '@qa/types';
import {
  AuditRecordError,
  AuditStore,
  helperEmailHash,
  helperIndexKey,
  LocalAuditStoreBackend,
  normalizeHelperEmail,
} from '../src/audit/store/index.js';

const REQUEST: AuditRequest = {
  url: 'https://salon.example/',
  limits: { maxPages: 10, maxDepth: 2, includePaths: [], excludePaths: [] },
  language: 'en',
};

let dir: string;
let backend: LocalAuditStoreBackend;
let store: AuditStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-helpers-'));
  backend = new LocalAuditStoreBackend(dir);
  store = new AuditStore(backend, { now: () => new Date('2026-11-03T09:00:00.000Z') });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Helper grants (REQ-033)', () => {
  it('trims, lower-cases and validates the email', async () => {
    expect(normalizeHelperEmail('  Priya.K@Example.COM ')).toBe('priya.k@example.com');
    for (const bad of ['', 'no-at-sign', 'a@b', 'a b@example.com', '@example.com', `${'x'.repeat(250)}@example.com`, 7]) {
      expect(() => normalizeHelperEmail(bad)).toThrow(AuditRecordError);
    }
  });

  it('grants, lists and removes per audit', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    const grant = await store.grantHelper(auditId, '  Priya@Example.com', ['export', 'view', 'view']);
    expect(grant).toEqual({
      auditId,
      email: 'priya@example.com',
      permissions: ['view', 'export'],
      grantedAt: '2026-11-03T09:00:00.000Z',
    });
    await store.grantHelper(auditId, 'arun@example.com', ['edit']);
    expect((await store.listHelpers(auditId)).map((g) => g.email)).toEqual(['arun@example.com', 'priya@example.com']);
    // Re-granting replaces the permissions.
    await store.grantHelper(auditId, 'PRIYA@example.com', ['view']);
    expect((await store.listHelpers(auditId)).find((g) => g.email === 'priya@example.com')!.permissions).toEqual([
      'view',
    ]);
    // The index names the hash, never the address.
    const hash = helperEmailHash('priya@example.com');
    expect(await backend.getJson(helperIndexKey(hash, auditId))).toEqual({ auditId });
    for (const key of await backend.list('helper-index')) expect(key).not.toContain('@');

    expect(await store.removeHelper(auditId, 'Priya@example.com ')).toBe(true);
    expect(await store.removeHelper(auditId, 'priya@example.com')).toBe(false);
    expect((await store.listHelpers(auditId)).map((g) => g.email)).toEqual(['arun@example.com']);
    expect(await backend.list(`helper-index/${hash}`)).toEqual([]);
  });

  it('permissions must be a non-empty subset of HELPER_PERMISSIONS', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    for (const bad of [[], ['owner'], ['view', 'delete'], 'view', null]) {
      await expect(store.grantHelper(auditId, 'a@example.com', bad as never)).rejects.toThrow(AuditRecordError);
    }
    expect(await store.listHelpers(auditId)).toEqual([]);
  });

  it('refuses a grant for an audit that does not exist', async () => {
    await expect(store.grantHelper('abcdefgh12', 'a@example.com', ['view'])).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it("grantsFor returns only that email's grants", async () => {
    const a = await store.createAudit(REQUEST);
    const b = await store.createAudit({ ...REQUEST, url: 'https://gym.example/' });
    await store.grantHelper(a.auditId, 'priya@example.com', ['view']);
    await store.grantHelper(b.auditId, 'priya@example.com', ['edit', 'export']);
    await store.grantHelper(b.auditId, 'arun@example.com', ['view']);

    const priya = await store.grantsFor(' PRIYA@example.com');
    expect(priya.map((g) => g.auditId).sort()).toEqual([a.auditId, b.auditId].sort());
    expect(priya.every((g) => g.email === 'priya@example.com')).toBe(true);
    const arun = await store.grantsFor('arun@example.com');
    expect(arun.map((g) => [g.auditId, g.email])).toEqual([[b.auditId, 'arun@example.com']]);
    expect(await store.grantsFor('nobody@example.com')).toEqual([]);
  });

  it('a removal is visible on the very next read, also from another store instance', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    const reader = new AuditStore(new LocalAuditStoreBackend(dir));
    await store.grantHelper(auditId, 'priya@example.com', ['view']);
    expect(await reader.grantsFor('priya@example.com')).toHaveLength(1);
    await store.removeHelper(auditId, 'priya@example.com');
    expect(await reader.grantsFor('priya@example.com')).toEqual([]);
    expect(await reader.listHelpers(auditId)).toEqual([]);
  });

  it('ignores an index entry whose grant is gone', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    await store.grantHelper(auditId, 'priya@example.com', ['view']);
    await backend.deletePrefix(`audits/${auditId}/helpers`);
    expect(await store.grantsFor('priya@example.com')).toEqual([]);
  });
});
