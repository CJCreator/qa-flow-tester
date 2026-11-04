import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  assertValidKey,
  AuditStoreError,
  normalizePrefix,
  type AuditStoreBackend,
} from '../src/audit/store/backend.js';
import { LocalAuditStoreBackend } from '../src/audit/store/local-backend.js';
import { GcsAuditStoreBackend, type FetchLike } from '../src/audit/store/gcs-backend.js';

const REFUSED_KEYS = [
  '',
  '..',
  '.',
  '../escape.json',
  'audits/../../escape.json',
  'audits/./a.json',
  'audits/.../a.json',
  'audits//a.json',
  '/etc/passwd',
  'audits/a1/',
  'audits\\a1.json',
  '..\\escape.json',
  'C:/Windows/win.ini',
  'audits/a b.json',
  'audits/a%2e.json',
  'audits/a\u0000.json',
  'audits/é.json',
  'a'.repeat(1025),
];

/** In-memory Cloud Storage JSON API: enough of upload, download, list and delete for the contract suite. */
function makeFakeGcs(bucket: string, pageSize = 2) {
  const objects = new Map<string, Uint8Array>();
  const calls: string[] = [];
  const fetch: FetchLike = async (input, init) => {
    calls.push(`${init?.method ?? 'GET'} ${input}`);
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    const uploadBase = `/upload/storage/v1/b/${bucket}/o`;
    const objectBase = `/storage/v1/b/${bucket}/o`;
    if (method === 'POST' && url.pathname === uploadBase && url.searchParams.get('uploadType') === 'media') {
      const name = url.searchParams.get('name')!;
      const body = init!.body;
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body as Uint8Array);
      objects.set(name, bytes);
      return new Response(JSON.stringify({ name }), { status: 200 });
    }
    if (method === 'GET' && url.pathname === objectBase) {
      const prefix = url.searchParams.get('prefix') ?? '';
      const names = [...objects.keys()].filter((n) => n.startsWith(prefix)).sort();
      const start = Number(url.searchParams.get('pageToken') ?? '0');
      const page = names.slice(start, start + pageSize);
      const next = start + pageSize < names.length ? String(start + pageSize) : undefined;
      return new Response(
        JSON.stringify({ ...(page.length ? { items: page.map((name) => ({ name })) } : {}), nextPageToken: next }),
        { status: 200 }
      );
    }
    if (url.pathname.startsWith(`${objectBase}/`)) {
      const name = decodeURIComponent(url.pathname.slice(objectBase.length + 1));
      if (method === 'GET' && url.searchParams.get('alt') === 'media') {
        const data = objects.get(name);
        return data ? new Response(new Uint8Array(data), { status: 200 }) : new Response('not found', { status: 404 });
      }
      if (method === 'DELETE') {
        return objects.delete(name) ? new Response(null, { status: 204 }) : new Response('not found', { status: 404 });
      }
    }
    return new Response('unexpected', { status: 400 });
  };
  return { fetch, objects, calls };
}

interface ContractHarness {
  backend: AuditStoreBackend;
  ioCount: () => Promise<number>;
  cleanup: () => Promise<void>;
}

async function countFiles(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
    return entries.length;
  } catch {
    return 0;
  }
}

const harnesses: Array<[string, () => Promise<ContractHarness>]> = [
  [
    'local backend on a temp dir',
    async () => {
      const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-audit-store-'));
      const backend = new LocalAuditStoreBackend(dataDir);
      return {
        backend,
        ioCount: () => countFiles(dataDir),
        cleanup: () => fs.rm(dataDir, { recursive: true, force: true }),
      };
    },
  ],
  [
    'Cloud Storage backend on an in-memory fake fetch',
    async () => {
      const fake = makeFakeGcs('qa-audits-test');
      const backend = new GcsAuditStoreBackend({
        bucket: 'qa-audits-test',
        fetch: fake.fetch,
        tokenProvider: async () => 'fake-token',
      });
      return { backend, ioCount: async () => fake.calls.length, cleanup: async () => {} };
    },
  ],
];

describe('audit store key rules', () => {
  it.each(REFUSED_KEYS.map((k) => [JSON.stringify(k).slice(0, 40), k]))('refuses %s', (_label, key) => {
    expect(() => assertValidKey(key)).toThrow(AuditStoreError);
  });

  it('accepts relative keys of the allowed characters', () => {
    for (const key of ['a', 'audits/a1/v1/page.json', 'audits/A-1_b/v.2/shot.png', 'index/links/abc123']) {
      expect(() => assertValidKey(key)).not.toThrow();
    }
  });

  it('normalizes folder prefixes and refuses an empty one unless allowed', () => {
    expect(normalizePrefix('audits/a1')).toBe('audits/a1/');
    expect(normalizePrefix('audits/a1/')).toBe('audits/a1/');
    expect(normalizePrefix('', { allowEmpty: true })).toBe('');
    expect(() => normalizePrefix('')).toThrow(AuditStoreError);
    expect(() => normalizePrefix('/')).toThrow(AuditStoreError);
    expect(() => normalizePrefix('../x')).toThrow(AuditStoreError);
  });
});

describe.each(harnesses)('audit store contract: %s', (_name, make) => {
  let h: ContractHarness;
  beforeEach(async () => {
    h = await make();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('puts and gets JSON', async () => {
    await h.backend.putJson('audits/a1/v1/meta.json', { title: 'Home', n: 1, tags: ['x'] });
    expect(await h.backend.getJson('audits/a1/v1/meta.json')).toEqual({ title: 'Home', n: 1, tags: ['x'] });
  });

  it('puts and gets bytes unchanged', async () => {
    const data = new Uint8Array([0, 1, 2, 250, 255, 10, 13]);
    await h.backend.putBytes('audits/a1/v1/shot.png', data);
    const read = await h.backend.getBytes('audits/a1/v1/shot.png');
    expect(read).toBeInstanceOf(Uint8Array);
    expect([...read!]).toEqual([...data]);
  });

  it('overwrites an existing key', async () => {
    await h.backend.putJson('audits/a1/meta.json', { v: 1 });
    await h.backend.putJson('audits/a1/meta.json', { v: 2 });
    expect(await h.backend.getJson('audits/a1/meta.json')).toEqual({ v: 2 });
    await h.backend.putBytes('audits/a1/file.bin', new Uint8Array([1, 2, 3]));
    await h.backend.putBytes('audits/a1/file.bin', new Uint8Array([9]));
    expect([...(await h.backend.getBytes('audits/a1/file.bin'))!]).toEqual([9]);
  });

  it('reads a missing key as null', async () => {
    expect(await h.backend.getJson('audits/none/meta.json')).toBeNull();
    expect(await h.backend.getBytes('audits/none/shot.png')).toBeNull();
  });

  it('lists every key under a folder prefix, sorted, across pages', async () => {
    await h.backend.putJson('audits/a1/v1/meta.json', {});
    await h.backend.putJson('audits/a1/v2/meta.json', {});
    await h.backend.putBytes('audits/a1/v1/shot.png', new Uint8Array([1]));
    await h.backend.putJson('audits/a10/v1/meta.json', {});
    await h.backend.putJson('index/links/l1.json', {});
    expect(await h.backend.list('audits/a1')).toEqual([
      'audits/a1/v1/meta.json',
      'audits/a1/v1/shot.png',
      'audits/a1/v2/meta.json',
    ]);
    expect(await h.backend.list('audits/a1/')).toHaveLength(3);
    expect(await h.backend.list('audits/missing')).toEqual([]);
    expect(await h.backend.list('')).toHaveLength(5);
  });

  it('deletePrefix removes everything under the prefix and nothing else', async () => {
    await h.backend.putJson('audits/a1/v1/meta.json', {});
    await h.backend.putBytes('audits/a1/v1/shot.png', new Uint8Array([1]));
    await h.backend.putJson('audits/a1/v2/meta.json', {});
    await h.backend.putJson('audits/a10/v1/meta.json', { keep: true });
    await h.backend.deletePrefix('audits/a1');
    expect(await h.backend.list('audits/a1')).toEqual([]);
    expect(await h.backend.getJson('audits/a1/v1/meta.json')).toBeNull();
    expect(await h.backend.getJson('audits/a10/v1/meta.json')).toEqual({ keep: true });
    await expect(h.backend.deletePrefix('audits/never')).resolves.toBeUndefined();
  });

  it('refuses bad keys before any I/O', async () => {
    const before = await h.ioCount();
    for (const key of REFUSED_KEYS) {
      await expect(h.backend.getJson(key)).rejects.toBeInstanceOf(AuditStoreError);
      await expect(h.backend.putJson(key, {})).rejects.toBeInstanceOf(AuditStoreError);
      await expect(h.backend.getBytes(key)).rejects.toBeInstanceOf(AuditStoreError);
      await expect(h.backend.putBytes(key, new Uint8Array([1]))).rejects.toBeInstanceOf(AuditStoreError);
    }
    for (const prefix of ['', '/', '..', '../x', 'a//b', 'a\\b']) {
      await expect(h.backend.deletePrefix(prefix)).rejects.toBeInstanceOf(AuditStoreError);
    }
    for (const prefix of ['/', '..', '../x', 'a\\b']) {
      await expect(h.backend.list(prefix)).rejects.toBeInstanceOf(AuditStoreError);
    }
    expect(await h.ioCount()).toBe(before);
  });
});

describe('local backend specifics', () => {
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-audit-store-'));
  });
  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('stores under <dataDir>/audit-store/ and leaves no temp files', async () => {
    const backend = new LocalAuditStoreBackend(dataDir);
    await backend.putJson('audits/a1/meta.json', { ok: true });
    await backend.putBytes('audits/a1/shot.png', new Uint8Array([7, 8]));
    const root = path.join(dataDir, 'audit-store');
    expect(JSON.parse(await fs.readFile(path.join(root, 'audits', 'a1', 'meta.json'), 'utf8'))).toEqual({ ok: true });
    expect([...(await fs.readFile(path.join(root, 'audits', 'a1', 'shot.png')))]).toEqual([7, 8]);
    expect((await fs.readdir(path.join(root, 'audits', 'a1'))).sort()).toEqual(['meta.json', 'shot.png']);
  });

  it('does not list temp files left by an interrupted write', async () => {
    const backend = new LocalAuditStoreBackend(dataDir);
    await backend.putJson('audits/a1/meta.json', {});
    await fs.writeFile(path.join(dataDir, 'audit-store', 'audits', 'a1', 'meta.json.tmp-123-456-abc123'), 'x');
    expect(await backend.list('audits/a1')).toEqual(['audits/a1/meta.json']);
  });

  it('raises a store error for a corrupt JSON object', async () => {
    const backend = new LocalAuditStoreBackend(dataDir);
    await backend.putBytes('audits/a1/meta.json', new TextEncoder().encode('{not json'));
    await expect(backend.getJson('audits/a1/meta.json')).rejects.toMatchObject({ code: 'invalid-data' });
  });
});
