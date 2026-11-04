import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { AuditStoreError } from '../src/audit/store/backend.js';
import { LocalAuditStoreBackend } from '../src/audit/store/local-backend.js';
import { GcsAuditStoreBackend, type FetchLike } from '../src/audit/store/gcs-backend.js';
import { selectAuditStoreBackend } from '../src/audit/store/select-backend.js';

function recordingFetch() {
  const calls: string[] = [];
  const fetch: FetchLike = async (input) => {
    calls.push(input);
    return new Response('{}', { status: 200 });
  };
  return { fetch, calls };
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('selectAuditStoreBackend (REQ-029)', () => {
  it('returns the local backend with no AUDIT_STORE_BUCKET and makes no network call', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-audit-select-'));
    dirs.push(dataDir);
    const { fetch, calls } = recordingFetch();
    const backend = selectAuditStoreBackend({ dataDir, env: {}, fetch });
    expect(backend).toBeInstanceOf(LocalAuditStoreBackend);
    expect(backend.kind).toBe('local');
    expect((backend as LocalAuditStoreBackend).root).toBe(path.resolve(dataDir, 'audit-store'));
    await backend.putJson('audits/a1/meta.json', { ok: true });
    expect(await backend.getJson('audits/a1/meta.json')).toEqual({ ok: true });
    expect(await backend.list('audits')).toEqual(['audits/a1/meta.json']);
    await backend.deletePrefix('audits/a1');
    expect(calls).toEqual([]);
  });

  it('treats an empty or blank AUDIT_STORE_BUCKET as unset', () => {
    const { fetch, calls } = recordingFetch();
    expect(selectAuditStoreBackend({ dataDir: os.tmpdir(), env: { AUDIT_STORE_BUCKET: '' }, fetch }).kind).toBe('local');
    expect(selectAuditStoreBackend({ dataDir: os.tmpdir(), env: { AUDIT_STORE_BUCKET: '  ' }, fetch }).kind).toBe('local');
    expect(calls).toEqual([]);
  });

  it('returns the Cloud Storage backend when AUDIT_STORE_BUCKET is set, without a call until first use', async () => {
    const { fetch, calls } = recordingFetch();
    const backend = selectAuditStoreBackend({
      dataDir: os.tmpdir(),
      env: { AUDIT_STORE_BUCKET: 'qa-audits-prod' },
      fetch,
      tokenProvider: async () => 'fake-token',
    });
    expect(backend).toBeInstanceOf(GcsAuditStoreBackend);
    expect(backend.kind).toBe('gcs');
    expect((backend as GcsAuditStoreBackend).bucket).toBe('qa-audits-prod');
    expect(calls).toEqual([]);
    await backend.getJson('audits/a1/meta.json');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/storage/v1/b/qa-audits-prod/o/');
  });

  it('uses the metadata server token provider by default, lazily', async () => {
    const { fetch, calls } = recordingFetch();
    selectAuditStoreBackend({ dataDir: os.tmpdir(), env: { AUDIT_STORE_BUCKET: 'qa-audits-prod' }, fetch });
    expect(calls).toEqual([]);
  });

  it.each(['Bad_Bucket', 'ab', 'gs://qa-audits', 'qa audits', 'goog-audits', '10.0.0.1'])(
    'refuses the bucket name %s with a clear message',
    (bucket) => {
      const { fetch, calls } = recordingFetch();
      let err: unknown;
      try {
        selectAuditStoreBackend({ dataDir: os.tmpdir(), env: { AUDIT_STORE_BUCKET: bucket }, fetch });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AuditStoreError);
      expect((err as AuditStoreError).code).toBe('invalid-bucket');
      expect((err as Error).message).toMatch(/AUDIT_STORE_BUCKET is not a valid Cloud Storage bucket name/);
      expect(calls).toEqual([]);
    }
  );
});
