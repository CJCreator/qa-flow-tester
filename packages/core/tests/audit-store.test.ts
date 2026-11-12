import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { AUDIT_ID_PATTERN, type AuditRequest, type AuditResult } from '@qa/types';
import {
  AuditRecordError,
  AuditStore,
  AuditStoreError,
  auditDocPath,
  auditRecordKey,
  helperIndexKey,
  LocalAuditStoreBackend,
  resultKey,
  shareIndexKey,
  shortlistKey,
  STORED_DOCUMENT_KINDS,
  versionFileKey,
  versionJsonKey,
  versionRecordKey,
  helperEmailHash,
  pageSlug,
  type AuditStoreBackend,
  type DeletePrefixOptions,
} from '../src/audit/store/index.js';
import { pageContentName } from '../src/audit/store/keys.js';
import { phoneScreenshotFile } from '../src/audit/phone-layout.js';

const REQUEST: AuditRequest = {
  url: 'https://example.com/',
  limits: { maxPages: 25, maxDepth: 3, includePaths: ['/shop'], excludePaths: ['/admin'] },
  language: 'ta',
};

function fakeResult(auditId: string, version: number, note: string): AuditResult {
  return {
    auditId,
    version,
    url: REQUEST.url,
    limits: REQUEST.limits,
    language: REQUEST.language,
    startedAt: '2026-11-01T00:00:00.000Z',
    finishedAt: '2026-11-01T00:05:00.000Z',
    pages: [],
    findings: [],
    notes: [note],
  } as unknown as AuditResult;
}

/** Wraps a backend and records every call, to prove refusals happen before any I/O. */
function spy(inner: AuditStoreBackend): AuditStoreBackend & { calls: string[] } {
  const calls: string[] = [];
  return {
    kind: inner.kind,
    calls,
    getJson: (k) => (calls.push(`getJson ${k}`), inner.getJson(k)),
    putJson: (k, v) => (calls.push(`putJson ${k}`), inner.putJson(k, v)),
    getBytes: (k) => (calls.push(`getBytes ${k}`), inner.getBytes(k)),
    putBytes: (k, d) => (calls.push(`putBytes ${k}`), inner.putBytes(k, d)),
    list: (p) => (calls.push(`list ${p}`), inner.list(p)),
    deletePrefix: (p, o) => (calls.push(`deletePrefix ${p}`), inner.deletePrefix(p, o)),
  };
}

let dir: string;
let backend: LocalAuditStoreBackend;
let store: AuditStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-audit-store-'));
  backend = new LocalAuditStoreBackend(dir);
  store = new AuditStore(backend);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('key layout', () => {
  it('puts each audit under audits/<id>/ and each version under audits/<id>/v<n>/', () => {
    const id = 'AbCdEf12_-';
    expect(auditRecordKey(id)).toBe('audits/AbCdEf12_-/audit.json');
    expect(versionRecordKey(id, 2)).toBe('audits/AbCdEf12_-/v2/version.json');
    expect(resultKey(id, 2)).toBe('audits/AbCdEf12_-/v2/result.json');
    expect(versionJsonKey(id, 2, 'edits')).toBe('audits/AbCdEf12_-/v2/edits.json');
    expect(versionJsonKey(id, 2, 'pages/home')).toBe('audits/AbCdEf12_-/v2/pages/home.json');
    expect(versionFileKey(id, 2, 'preview.html')).toBe('audits/AbCdEf12_-/v2/preview.html');
    expect(versionFileKey(id, 2, 'screenshots/home-phone.png')).toBe('audits/AbCdEf12_-/v2/screenshots/home-phone.png');
    expect(auditDocPath(id, 2, 'structure', 'markdown')).toBe('audits/AbCdEf12_-/v2/docs/structure.md');
    expect(auditDocPath(id, 2, 'structure', 'html')).toBe('audits/AbCdEf12_-/v2/docs/structure.html');
    expect(auditDocPath(id, 2, 'pitch-glimpse', 'markdown')).toBe('audits/AbCdEf12_-/v2/docs/pitch-glimpse.md');
    expect(shortlistKey(id)).toBe('audits/AbCdEf12_-/shortlist.json');
    const linkId = 'A'.repeat(22);
    expect(shareIndexKey(linkId)).toBe(`share-index/${linkId}`);
    const hash = helperEmailHash('helper@example.com');
    expect(helperIndexKey(hash, id)).toBe(`helper-index/${hash}/AbCdEf12_-/entry.json`);
  });

  it('refuses ids, versions and names that do not match their pattern', () => {
    for (const bad of ['', 'short', '../../etc', 'a/b/c/d/e/f', 'abcdefgh.', 'abc defgh', 'x'.repeat(65)]) {
      expect(() => auditRecordKey(bad)).toThrow(AuditStoreError);
    }
    for (const bad of [0, -1, 1.5, Number.NaN, 100_001]) {
      expect(() => versionRecordKey('abcdefgh', bad)).toThrow(AuditStoreError);
    }
    for (const bad of ['version', 'result', '../x', 'Edits', 'a/../b', 'a.json', '', 'a//b']) {
      expect(() => versionJsonKey('abcdefgh', 1, bad)).toThrow(AuditStoreError);
    }
    for (const bad of ['../x.png', '.hidden', 'a/../b.png', 'page.json', 'a/b/c/d.png', '', 'a\\b.png']) {
      expect(() => versionFileKey('abcdefgh', 1, bad)).toThrow(AuditStoreError);
    }
    for (const bad of ['invalid', 'pdf', 'docx', 'bundle', ''] as const) {
      expect(() => auditDocPath('abcdefgh', 1, bad as any, 'markdown')).toThrow(AuditStoreError);
    }
    for (const bad of ['pdf', 'docx', 'png', 'txt', ''] as const) {
      expect(() => auditDocPath('abcdefgh', 1, 'structure', bad as any)).toThrow(AuditStoreError);
    }
  });
});

describe('AuditStore: audits and versions (REQ-028)', () => {
  it('creates an audit with a random id and version 1 running', async () => {
    const v1 = await store.createAudit(REQUEST);
    const other = await store.createAudit(REQUEST);
    expect(v1.auditId).toMatch(AUDIT_ID_PATTERN);
    expect(v1.auditId).not.toBe(other.auditId);
    expect(v1).toMatchObject({
      version: 1,
      status: 'running',
      url: REQUEST.url,
      limits: REQUEST.limits,
      language: 'ta',
    });
  });

  it('adds the next version with the same url, limits and language (REQ-028 AC-3)', async () => {
    const v1 = await store.createAudit(REQUEST);
    const v2 = await store.addVersion(v1.auditId);
    expect(v2).toMatchObject({ auditId: v1.auditId, version: 2, status: 'running' });
    expect(v2.url).toBe(v1.url);
    expect(v2.limits).toEqual(v1.limits);
    expect(v2.language).toBe(v1.language);
  });

  it('records status, finishedAt and counts; only sent fields change', async () => {
    const v1 = await store.createAudit(REQUEST);
    await store.updateVersion(v1.auditId, 1, { pagesRecorded: 4 });
    const done = await store.updateVersion(v1.auditId, 1, {
      status: 'done',
      finishedAt: '2026-11-03T10:00:00.000Z',
      pagesSkipped: 1,
      findings: 7,
    });
    expect(done).toMatchObject({ status: 'done', pagesRecorded: 4, pagesSkipped: 1, findings: 7 });
    expect(await store.getVersion(v1.auditId, 1)).toEqual(done);
    await expect(store.updateVersion(v1.auditId, 1, { status: 'bogus' as never })).rejects.toThrow(AuditRecordError);
    await expect(store.updateVersion(v1.auditId, 1, { pagesRecorded: -1 })).rejects.toThrow(AuditRecordError);
    await expect(store.updateVersion(v1.auditId, 9, { status: 'done' })).rejects.toMatchObject({ code: 'not-found' });
  });

  it('refuses a stored document of an unknown kind', async () => {
    const v1 = await store.createAudit(REQUEST);
    await expect(
      store.updateVersion(v1.auditId, 1, { documents: [{ kind: 'nonsense', status: 'ready', title: 'x' } as never] })
    ).rejects.toThrow(AuditRecordError);
  });

  it('keeps only markdown and html formats and caps the reason', async () => {
    const v1 = await store.createAudit(REQUEST);
    await store.updateVersion(v1.auditId, 1, {
      documents: [
        {
          kind: 'findings',
          status: 'ready',
          title: 'Findings',
          formats: ['markdown', 'exe'] as never,
          updatedAt: '2026-11-03T10:00:00.000Z',
        },
        { kind: 'content', status: 'not-written', title: 'Content', reason: 'x'.repeat(1000) },
      ],
    });
    const version = await store.getVersion(v1.auditId, 1);
    const docs = version!.documents!;
    expect(docs[0]).toMatchObject({ kind: 'findings', formats: ['markdown'] });
    expect(docs[1]).toMatchObject({ kind: 'content' });
    expect((docs[1] as { reason: string }).reason).toHaveLength(300);
  });

  it('writeVersionEntries saves JSON and files and reports each one', async () => {
    const v1 = await store.createAudit(REQUEST);
    const saved = await store.writeVersionEntries(v1.auditId, 1, [
      { kind: 'json', name: 'pages/a', value: { a: 1 } },
      { kind: 'file', name: 'phone/a.png', data: new Uint8Array([1, 2]) },
    ]);
    expect(saved).toEqual([true, true]);
    expect(await store.readVersionJson(v1.auditId, 1, 'pages/a')).toEqual({ a: 1 });
    expect([...(await store.getVersionFile(v1.auditId, 1, 'phone/a.png'))!]).toEqual([1, 2]);
  });

  it('writeVersionEntries refuses a version that does not exist', async () => {
    const v1 = await store.createAudit(REQUEST);
    await expect(
      store.writeVersionEntries(v1.auditId, 99, [{ kind: 'json', name: 'pages/a', value: {} }])
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('writeVersionEntries reports a failed entry without failing the others', async () => {
    const v1 = await store.createAudit(REQUEST);
    const originalPutJson = backend.putJson.bind(backend);
    backend.putJson = async (key: string, value: unknown) => {
      if (key.includes('pages/bad')) throw new Error('storage down');
      return originalPutJson(key, value);
    };
    try {
      const saved = await store.writeVersionEntries(v1.auditId, 1, [
        { kind: 'json', name: 'pages/bad', value: { x: 1 } },
        { kind: 'json', name: 'pages/good', value: { y: 2 } },
      ]);
      expect(saved).toEqual([false, true]);
      expect(await store.readVersionJson(v1.auditId, 1, 'pages/good')).toEqual({ y: 2 });
    } finally {
      backend.putJson = originalPutJson;
    }
  });

  it('pageSlug: a readable slug plus a hash, the same names as before', () => {
    expect(pageSlug('/')).toMatch(/^home-[0-9a-f]{8}$/);
    expect(pageSlug('/About Us/')).toMatch(/^about-us-[0-9a-f]{8}$/);
    expect(pageSlug('/a')).not.toBe(pageSlug('/A'));
    expect(pageContentName('/pricing')).toBe(`pages/${pageSlug('/pricing')}`);
    expect(phoneScreenshotFile('/pricing')).toBe(`phone/${pageSlug('/pricing')}.png`);
  });

  it('refuses an invalid request and a URL with credentials', async () => {
    await expect(store.createAudit({ ...REQUEST, url: 'ftp://x.example' })).rejects.toThrow(AuditRecordError);
    await expect(store.createAudit({ ...REQUEST, url: 'https://u:p@x.example/' })).rejects.toThrow(AuditRecordError);
    await expect(store.createAudit({ ...REQUEST, language: 'xx' as never })).rejects.toThrow(AuditRecordError);
    await expect(store.createAudit({ ...REQUEST, limits: { ...REQUEST.limits, maxPages: 0 } })).rejects.toThrow(
      AuditRecordError
    );
    expect(await backend.list('')).toEqual([]);
  });

  it('REQ-028 AC-1/AC-2: after a restart a finished audit opens, and both versions list oldest first with their own result', async () => {
    const v1 = await store.createAudit(REQUEST);
    const id = v1.auditId;
    await store.saveResult(id, 1, fakeResult(id, 1, 'first run'));
    await store.updateVersion(id, 1, { status: 'done', finishedAt: '2026-11-03T10:00:00.000Z' });
    await store.addVersion(id);
    await store.saveResult(id, 2, fakeResult(id, 2, 'second run'));
    await store.updateVersion(id, 2, { status: 'done', finishedAt: '2026-11-03T11:00:00.000Z' });
    await store.putShortlist(id, { mark: 'pitch' });

    // A restart: a new backend and a new store over the same folder.
    const reopened = new AuditStore(new LocalAuditStoreBackend(dir));
    const audit = await reopened.getAudit(id);
    expect(audit).not.toBeNull();
    expect(audit!.url).toBe(REQUEST.url);
    expect(audit!.host).toBe('example.com');
    expect(audit!.versions.map((v) => [v.version, v.status])).toEqual([
      [1, 'done'],
      [2, 'done'],
    ]);
    expect(((await reopened.getResult(id, 1)) as unknown as { notes: string[] }).notes).toEqual(['first run']);
    expect(((await reopened.getResult(id, 2)) as unknown as { notes: string[] }).notes).toEqual(['second run']);

    const list = await reopened.listAudits();
    expect(list.map((a) => a.auditId)).toEqual([id]);
    expect(list[0].versions.map((v) => v.version)).toEqual([1, 2]);
    expect(list[0].shortlist).toMatchObject({ auditId: id, mark: 'pitch' });
  });

  it('lists audits newest first', async () => {
    let t = Date.parse('2026-11-01T00:00:00.000Z');
    const timed = new AuditStore(backend, { now: () => new Date((t += 1000)) });
    const a = await timed.createAudit(REQUEST);
    const b = await timed.createAudit({ ...REQUEST, url: 'https://b.example/' });
    expect((await timed.listAudits()).map((s) => s.auditId)).toEqual([b.auditId, a.auditId]);
  });

  it('refuses a result that belongs to another version', async () => {
    const v1 = await store.createAudit(REQUEST);
    await expect(store.saveResult(v1.auditId, 1, fakeResult(v1.auditId, 2, 'x'))).rejects.toThrow(AuditRecordError);
    await expect(store.saveResult(v1.auditId, 2, fakeResult(v1.auditId, 2, 'x'))).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('serves generic per-version JSON and files', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    await store.writeVersionJson(auditId, 1, 'edits', { findings: [] });
    await store.writeVersionJson(auditId, 1, 'pages/home', { text: 'hello' });
    await store.putVersionFile(auditId, 1, 'preview.html', new TextEncoder().encode('<p>hi</p>'));
    expect(await store.readVersionJson(auditId, 1, 'edits')).toEqual({ findings: [] });
    expect(await store.readVersionJson(auditId, 1, 'pages/home')).toEqual({ text: 'hello' });
    expect(new TextDecoder().decode((await store.getVersionFile(auditId, 1, 'preview.html'))!)).toBe('<p>hi</p>');
    expect(await store.readVersionJson(auditId, 1, 'rewrites')).toBeNull();
    await expect(store.writeVersionJson(auditId, 3, 'edits', {})).rejects.toMatchObject({ code: 'not-found' });
  });

  it('saves and reads audit documents in markdown and html (T-83)', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    await store.saveAuditDocument(auditId, 1, 'structure', 'markdown', '# Structure\n');
    await store.saveAuditDocument(auditId, 1, 'structure', 'html', '<h1>Structure</h1>');
    expect(await store.readAuditDocument(auditId, 1, 'structure', 'markdown')).toBe('# Structure\n');
    expect(await store.readAuditDocument(auditId, 1, 'structure', 'html')).toBe('<h1>Structure</h1>');
    expect(await store.readAuditDocument(auditId, 1, 'findings', 'markdown')).toBeNull();

    // Round trip with Tamil characters
    const tamilText = '# கட்டமைப்பு\n';
    await store.saveAuditDocument(auditId, 1, 'content', 'markdown', tamilText);
    expect(await store.readAuditDocument(auditId, 1, 'content', 'markdown')).toBe(tamilText);
  });

  it('refuses invalid document kind, format or missing version (T-83)', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    await expect(store.saveAuditDocument(auditId, 1, 'bad-kind' as any, 'markdown', 'text')).rejects.toThrow(
      AuditStoreError
    );
    await expect(store.saveAuditDocument(auditId, 1, 'structure', 'docx' as any, 'text')).rejects.toThrow(
      AuditStoreError
    );
    await expect(store.saveAuditDocument(auditId, 1, 'structure', 'markdown', 123 as any)).rejects.toThrow(
      AuditRecordError
    );
    await expect(store.saveAuditDocument(auditId, 2, 'structure', 'markdown', 'text')).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(store.readAuditDocument(auditId, 1, 'bad-kind' as any, 'markdown')).rejects.toThrow(AuditStoreError);
  });

  it('records stored documents on version update (T-83)', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    const updated = await store.updateVersion(auditId, 1, {
      documents: [
        {
          kind: 'structure',
          status: 'ready',
          title: 'Structure',
          formats: ['markdown', 'html'],
          updatedAt: '2026-11-03T10:00:00.000Z',
        },
        {
          kind: 'findings',
          status: 'not-written',
          title: 'Findings',
          reason: 'Render error',
        },
      ],
    });
    expect(updated.documents).toHaveLength(2);
    expect(updated.documents![0]).toMatchObject({ kind: 'structure', status: 'ready' });
    expect(updated.documents![1]).toMatchObject({ kind: 'findings', status: 'not-written', reason: 'Render error' });
  });

  it('refuses bad ids, versions and names before touching the backend', async () => {
    const watched = spy(backend);
    const s = new AuditStore(watched);
    const bad = '../escape';
    const attempts: Array<() => Promise<unknown>> = [
      () => s.addVersion(bad),
      () => s.updateVersion(bad, 1, { status: 'done' }),
      () => s.updateVersion('abcdefgh', 0, { status: 'done' }),
      () => s.getVersion('abcdefgh', 1.5),
      () => s.getAudit(bad),
      () => s.deleteAudit(bad),
      () => s.saveResult(bad, 1, fakeResult(bad, 1, 'x')),
      () => s.getResult('abcdefgh', -1),
      () => s.readVersionJson('abcdefgh', 1, '../x'),
      () => s.writeVersionJson('abcdefgh', 1, 'version', {}),
      () => s.putVersionFile('abcdefgh', 1, '../x.png', new Uint8Array(1)),
      () => s.getVersionFile('abcdefgh', 1, 'a/../b'),
      () => s.saveAuditDocument(bad, 1, 'structure', 'markdown', 'x'),
      () => s.readAuditDocument(bad, 1, 'structure', 'markdown'),
      () => s.getShortlist(bad),
      () => s.putShortlist(bad, { mark: 'pitch' }),
      () => s.createShare(bad, { version: 1, kind: 'pitch', language: 'en' }),
      () => s.revokeShare('abcdefgh', 'short'),
      () => s.listShares(bad),
      () => s.grantHelper(bad, 'a@example.com', ['view']),
      () => s.removeHelper(bad, 'a@example.com'),
      () => s.listHelpers(bad),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toThrow(AuditStoreError);
    }
    expect(await s.resolveShare('../../x')).toEqual({ status: 'missing' });
    expect(watched.calls).toEqual([]);
  });
});

describe('deleteAudit (Q-30)', () => {
  it('removes every version, result, file, edit, preview, Shortlist entry, Shared Link and Helper grant', async () => {
    const keep = await store.createAudit({ ...REQUEST, url: 'https://keep.example/' });
    const keepLink = await store.createShare(keep.auditId, { version: 1, kind: 'pitch', language: 'en' });
    await store.grantHelper(keep.auditId, 'helper@example.com', ['view']);

    const { auditId: id } = await store.createAudit(REQUEST);
    await store.saveResult(id, 1, fakeResult(id, 1, 'one'));
    await store.addVersion(id);
    await store.saveResult(id, 2, fakeResult(id, 2, 'two'));
    await store.writeVersionJson(id, 2, 'edits', { findings: [] });
    await store.writeVersionJson(id, 2, 'pages/home', { text: 'page' });
    await store.putVersionFile(id, 2, 'preview.html', new Uint8Array([1]));
    await store.putVersionFile(id, 2, 'screenshots/home.png', new Uint8Array([2]));
    await store.putShortlist(id, { mark: 'pitch', notes: 'Owner: Ravi, 98xxxxxx' });
    const open = await store.createShare(id, { version: 2, kind: 'preview', language: 'ta' });
    const revoked = await store.createShare(id, { version: 1, kind: 'pitch', language: 'en' });
    await store.revokeShare(id, revoked.id);
    await store.grantHelper(id, 'helper@example.com', ['view', 'edit']);
    await store.grantHelper(id, 'other@example.com', ['export']);

    expect(await store.deleteAudit(id)).toBe(true);

    expect(await backend.list(`audits/${id}`)).toEqual([]);
    for (const key of await backend.list('share-index')) {
      expect(JSON.stringify(await backend.getJson(key))).not.toContain(id);
    }
    for (const key of await backend.list('helper-index')) expect(key).not.toContain(id);
    expect(await store.getAudit(id)).toBeNull();
    expect(await store.resolveShare(open.id)).toEqual({ status: 'gone' });
    expect(await store.resolveShare(revoked.id)).toEqual({ status: 'gone' });
    expect((await store.grantsFor('helper@example.com')).map((g) => g.auditId)).toEqual([keep.auditId]);
    expect(await store.grantsFor('other@example.com')).toEqual([]);
    expect(await store.listShortlist()).toEqual([]);
    // Writes after deletion do not bring the audit back.
    await expect(store.writeVersionJson(id, 1, 'edits', {})).rejects.toMatchObject({ code: 'not-found' });
    await expect(store.putShortlist(id, { mark: 'skip' })).rejects.toMatchObject({ code: 'not-found' });
    expect(await backend.list(`audits/${id}`)).toEqual([]);

    // The other audit is untouched.
    expect((await store.listAudits()).map((a) => a.auditId)).toEqual([keep.auditId]);
    expect((await store.resolveShare(keepLink.id)).status).toBe('open');
    // Deleting again is harmless.
    expect(await store.deleteAudit(id)).toBe(false);
  });

  it('names the audit record as the last key', async () => {
    let capturedOptions: DeletePrefixOptions | undefined;
    const watched = spy(backend);
    watched.deletePrefix = async (prefix, options) => {
      capturedOptions = options;
      return backend.deletePrefix(prefix, options);
    };
    const wrappedStore = new AuditStore(watched);
    const { auditId: id } = await wrappedStore.createAudit(REQUEST);
    await wrappedStore.deleteAudit(id);
    expect(capturedOptions?.last).toBe(`audits/${id}/audit.json`);
  });
});

describe('serialised writes', () => {
  it('a Shortlist save during version updates loses nothing', async () => {
    const { auditId: id } = await store.createAudit(REQUEST);
    // A second store on the same backend shares the same queue.
    const other = new AuditStore(backend);
    await Promise.all([
      store.updateVersion(id, 1, { pagesRecorded: 3 }),
      other.putShortlist(id, { mark: 'pitch' }),
      store.updateVersion(id, 1, { findings: 9 }),
      other.putShortlist(id, { notes: 'call on Monday' }),
      store.updateVersion(id, 1, { status: 'done', finishedAt: '2026-11-03T10:00:00.000Z' }),
      other.putShortlist(id, { outcome: 'Interested' }),
      store.addVersion(id),
      other.putShortlist(id, { outcomeNote: 'wants a quote' }),
      store.grantHelper(id, 'h@example.com', ['view']),
    ]);
    const audit = await store.getAudit(id);
    expect(audit!.versions[0]).toMatchObject({ pagesRecorded: 3, findings: 9, status: 'done' });
    expect(audit!.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(audit!.shortlist).toMatchObject({
      mark: 'pitch',
      notes: 'call on Monday',
      outcome: 'Interested',
      outcomeNote: 'wants a quote',
    });
    expect(await store.listHelpers(id)).toHaveLength(1);
  });

  it('a failed write does not block the next one', async () => {
    const { auditId: id } = await store.createAudit(REQUEST);
    await expect(store.updateVersion(id, 5, { status: 'done' })).rejects.toThrow();
    await expect(store.updateVersion(id, 1, { status: 'done' })).resolves.toMatchObject({ status: 'done' });
  });
});

describe('no secrets in stored audits', () => {
  const SECRETS = {
    RUNNER_ACCESS_TOKEN: 'fake-runner-token-7Hq2ZpL0vX',
    GEMINI_API_KEY: 'AIzaFAKEkey000000000000000000000000000',
    GOOGLE_ID_TOKEN: 'eyJhbGciOiJSUzI1NiJ9.fakeIdTokenPayload.fakeSig',
  };
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const [name, value] of Object.entries(SECRETS)) {
      saved[name] = process.env[name];
      process.env[name] = value;
    }
  });
  afterEach(() => {
    for (const name of Object.keys(SECRETS)) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('keeps none of the seeded secrets after every store method runs', async () => {
    const stray = {
      token: SECRETS.RUNNER_ACCESS_TOKEN,
      apiKey: SECRETS.GEMINI_API_KEY,
      idToken: SECRETS.GOOGLE_ID_TOKEN,
    };
    const v1 = await store.createAudit({ ...REQUEST, ...stray, limits: { ...REQUEST.limits, ...stray } } as never);
    const id = v1.auditId;
    await store.addVersion(id);
    await store.updateVersion(id, 1, { status: 'done', finishedAt: '2026-11-03T10:00:00.000Z', ...stray } as never);
    await store.saveResult(id, 1, fakeResult(id, 1, 'clean'));
    await store.writeVersionJson(id, 1, 'edits', { findings: [] });
    await store.putVersionFile(id, 1, 'preview.html', new TextEncoder().encode('<p>preview</p>'));
    await store.putShortlist(id, { mark: 'pitch', notes: 'n', ...stray } as never);
    const link = await store.createShare(id, { version: 1, kind: 'pitch', language: 'en', ...stray } as never);
    await store.revokeShare(id, link.id);
    await store.createShare(id, { version: 2, kind: 'preview', language: 'en' });
    await store.grantHelper(id, 'helper@example.com', ['view']);
    await store.grantHelper(id, 'gone@example.com', ['edit']);
    await store.removeHelper(id, 'gone@example.com');
    await store.getAudit(id);
    await store.listAudits();
    await store.listShortlist();
    await store.listShares(id);
    await store.resolveShare(link.id);
    await store.listHelpers(id);
    await store.grantsFor('helper@example.com');
    const second = await store.createAudit(REQUEST);
    await store.createShare(second.auditId, { version: 1, kind: 'pitch', language: 'en' });
    await store.deleteAudit(second.auditId);

    const keys = await backend.list('');
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) {
      const text = new TextDecoder().decode((await backend.getBytes(key))!);
      for (const secret of Object.values(SECRETS)) expect(text, key).not.toContain(secret);
    }
  });
});

describe('bounded reads', () => {
  it('listAudits and getAudit keep their reads bounded', async () => {
    let inFlight = 0;
    let peak = 0;
    const originalGetJson = backend.getJson.bind(backend);
    backend.getJson = async <T>(key: string): Promise<T | null> => {
      inFlight++;
      if (inFlight > peak) peak = inFlight;
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await originalGetJson<T>(key);
      } finally {
        inFlight--;
      }
    };

    try {
      for (let i = 0; i < 20; i++) {
        const { auditId } = await store.createAudit(REQUEST);
        await store.addVersion(auditId);
      }

      peak = 0;
      const audits = await store.listAudits();
      expect(audits).toHaveLength(20);
      const sorted = [...audits].sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt) || a.auditId.localeCompare(b.auditId)
      );
      expect(audits).toEqual(sorted);
      expect(peak).toBeLessThanOrEqual(16);
      expect(peak).toBeGreaterThan(0);

      const { auditId: manyVersionsId } = await store.createAudit(REQUEST);
      for (let i = 0; i < 11; i++) {
        await store.addVersion(manyVersionsId);
      }

      peak = 0;
      const audit = await store.getAudit(manyVersionsId);
      expect(audit).not.toBeNull();
      expect(audit!.versions).toHaveLength(12);
      expect(peak).toBeLessThanOrEqual(8);
      expect(peak).toBeGreaterThan(0);
    } finally {
      backend.getJson = originalGetJson;
    }
  });
});
