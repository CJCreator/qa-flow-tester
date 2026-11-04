import { describe, it, expect } from 'vitest';
import { AuditStoreError } from '../src/audit/store/backend.js';
import {
  createMetadataTokenProvider,
  GcsAuditStoreBackend,
  isValidBucketName,
  METADATA_TOKEN_URL,
  TOKEN_REFRESH_MARGIN_MS,
  type FetchLike,
} from '../src/audit/store/gcs-backend.js';

const BUCKET = 'qa-audits-test';
const TOKEN = 'ya29.secret-token-value';
const SECRET_BODY = 'bucket says: internal-detail-xyz and object contents';

interface Recorded {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

function recordingFetch(respond: (req: Recorded) => Response | Promise<Response>) {
  const requests: Recorded[] = [];
  const fetch: FetchLike = async (input, init) => {
    const req: Recorded = {
      url: input,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body,
    };
    requests.push(req);
    return respond(req);
  };
  return { fetch, requests };
}

function backendWith(fetch: FetchLike) {
  return new GcsAuditStoreBackend({ bucket: BUCKET, fetch, tokenProvider: async () => TOKEN });
}

describe('Cloud Storage backend requests', () => {
  it('uploads with uploadType=media, a URL-encoded name and a bearer token', async () => {
    const { fetch, requests } = recordingFetch(() => new Response('{}', { status: 200 }));
    const backend = backendWith(fetch);
    await backend.putJson('audits/a1/v1/meta.json', { a: 1 });
    await backend.putBytes('audits/a1/v1/shot.png', new Uint8Array([1, 2]));

    expect(requests[0].method).toBe('POST');
    expect(requests[0].url).toBe(
      'https://storage.googleapis.com/upload/storage/v1/b/qa-audits-test/o?uploadType=media&name=audits%2Fa1%2Fv1%2Fmeta.json'
    );
    expect(requests[0].headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(requests[0].headers.get('content-type')).toMatch(/^application\/json/);
    expect(requests[0].body).toBe('{"a":1}');
    expect(requests[1].headers.get('content-type')).toBe('application/octet-stream');
    expect([...(requests[1].body as Uint8Array)]).toEqual([1, 2]);
  });

  it('downloads with alt=media and an encoded object name', async () => {
    const { fetch, requests } = recordingFetch(() => new Response('{"x":true}', { status: 200 }));
    expect(await backendWith(fetch).getJson('audits/a1/v1/meta.json')).toEqual({ x: true });
    expect(requests[0].method).toBe('GET');
    expect(requests[0].url).toBe(
      'https://storage.googleapis.com/storage/v1/b/qa-audits-test/o/audits%2Fa1%2Fv1%2Fmeta.json?alt=media'
    );
    expect(requests[0].headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('lists with prefix and follows pageToken until done', async () => {
    const pages: Record<string, unknown> = {
      '': { items: [{ name: 'audits/a1/b' }, { name: 'audits/a1/a' }], nextPageToken: 'p2' },
      p2: { items: [{ name: 'audits/a1/c' }], nextPageToken: 'p3' },
      p3: {},
    };
    const { fetch, requests } = recordingFetch((req) => {
      const token = new URL(req.url).searchParams.get('pageToken') ?? '';
      return new Response(JSON.stringify(pages[token]), { status: 200 });
    });
    expect(await backendWith(fetch).list('audits/a1')).toEqual(['audits/a1/a', 'audits/a1/b', 'audits/a1/c']);
    expect(requests).toHaveLength(3);
    for (const req of requests) {
      const url = new URL(req.url);
      expect(url.pathname).toBe('/storage/v1/b/qa-audits-test/o');
      expect(url.searchParams.get('prefix')).toBe('audits/a1/');
    }
    expect(new URL(requests[1].url).searchParams.get('pageToken')).toBe('p2');
    expect(new URL(requests[2].url).searchParams.get('pageToken')).toBe('p3');
  });

  it('deletes each object under the prefix, tolerating 404', async () => {
    const { fetch, requests } = recordingFetch((req) => {
      if (req.method === 'GET') {
        return new Response(JSON.stringify({ items: [{ name: 'audits/a1/x.json' }, { name: 'audits/a1/y z' }] }));
      }
      return new Response(null, { status: req.url.endsWith('y%20z') ? 404 : 204 });
    });
    await backendWith(fetch).deletePrefix('audits/a1/');
    const deletes = requests.filter((r) => r.method === 'DELETE').map((r) => r.url);
    expect(deletes).toEqual([
      'https://storage.googleapis.com/storage/v1/b/qa-audits-test/o/audits%2Fa1%2Fx.json',
      'https://storage.googleapis.com/storage/v1/b/qa-audits-test/o/audits%2Fa1%2Fy%20z',
    ]);
  });

  it('reads 404 as null', async () => {
    const { fetch } = recordingFetch(() => new Response(SECRET_BODY, { status: 404 }));
    const backend = backendWith(fetch);
    expect(await backend.getJson('audits/a1/meta.json')).toBeNull();
    expect(await backend.getBytes('audits/a1/shot.png')).toBeNull();
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [429, 'rate-limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ])('raises a fixed-wording store error on %i without leaking token or body', async (status, code) => {
    const { fetch } = recordingFetch(() => new Response(SECRET_BODY, { status }));
    const backend = backendWith(fetch);
    const ops: Array<() => Promise<unknown>> = [
      () => backend.getJson('audits/a1/meta.json'),
      () => backend.getBytes('audits/a1/shot.png'),
      () => backend.putJson('audits/a1/meta.json', { secretField: 'object-contents-123' }),
      () => backend.putBytes('audits/a1/shot.png', new Uint8Array([1])),
      () => backend.list('audits/a1'),
      () => backend.deletePrefix('audits/a1'),
    ];
    for (const op of ops) {
      const err = await op().then(
        () => null,
        (e: unknown) => e
      );
      expect(err).toBeInstanceOf(AuditStoreError);
      expect((err as AuditStoreError).code).toBe(code);
      const text = `${(err as Error).message} ${(err as Error).stack ?? ''} ${JSON.stringify(err)}`;
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain('internal-detail-xyz');
      expect(text).not.toContain('object-contents-123');
    }
  });

  it('turns a network failure into a store error without its cause', async () => {
    const fetch: FetchLike = async () => {
      throw new Error(`socket hang up with ${TOKEN}`);
    };
    const err = await backendWith(fetch)
      .getJson('audits/a1/meta.json')
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'unavailable' });
    expect(String((err as Error).message)).not.toContain(TOKEN);
  });

  it('raises invalid-data for a non-JSON object', async () => {
    const { fetch } = recordingFetch(() => new Response('{oops', { status: 200 }));
    await expect(backendWith(fetch).getJson('audits/a1/meta.json')).rejects.toMatchObject({ code: 'invalid-data' });
  });

  it('refuses a bad bucket name at construction', () => {
    expect(
      () =>
        new GcsAuditStoreBackend({
          bucket: 'Bad_Bucket',
          fetch: async () => new Response(),
          tokenProvider: async () => TOKEN,
        })
    ).toThrow(AuditStoreError);
  });
});

describe('isValidBucketName', () => {
  it.each(['qa-audits', 'abc', 'my_bucket-1', 'a'.repeat(63), 'example.com.audits'])('accepts %s', (name) => {
    expect(isValidBucketName(name)).toBe(true);
  });
  it.each([
    'ab',
    'a'.repeat(64),
    'UPPER',
    '-start',
    'end-',
    'has space',
    'a..b',
    'bad/slash',
    '192.168.1.1',
    'goog-audits',
    'my-google-bucket',
    `${'a'.repeat(64)}.com`,
  ])('refuses %s', (name) => {
    expect(isValidBucketName(name)).toBe(false);
  });
});

describe('metadata server token provider', () => {
  function metadataFetch(expiresIn = 3600) {
    let n = 0;
    return recordingFetch(() => {
      n += 1;
      return new Response(JSON.stringify({ access_token: `token-${n}`, expires_in: expiresIn, token_type: 'Bearer' }));
    });
  }

  it('reads the metadata server with Metadata-Flavor: Google', async () => {
    const { fetch, requests } = metadataFetch();
    const provider = createMetadataTokenProvider({ fetch, now: () => 0 });
    expect(await provider()).toBe('token-1');
    expect(requests[0].url).toBe(METADATA_TOKEN_URL);
    expect(requests[0].headers.get('metadata-flavor')).toBe('Google');
  });

  it('caches the token until shortly before it expires', async () => {
    const { fetch, requests } = metadataFetch(3600);
    let clock = 1_000_000;
    const provider = createMetadataTokenProvider({ fetch, now: () => clock });
    expect(await provider()).toBe('token-1');
    clock += 3600_000 - TOKEN_REFRESH_MARGIN_MS - 1;
    expect(await provider()).toBe('token-1');
    expect(requests).toHaveLength(1);
    clock += 1;
    expect(await provider()).toBe('token-2');
    expect(requests).toHaveLength(2);
  });

  it('shares one request between concurrent callers', async () => {
    const { fetch, requests } = metadataFetch();
    const provider = createMetadataTokenProvider({ fetch, now: () => 0 });
    expect(await Promise.all([provider(), provider(), provider()])).toEqual(['token-1', 'token-1', 'token-1']);
    expect(requests).toHaveLength(1);
  });

  it('raises a store error without the body when the metadata server fails', async () => {
    const { fetch } = recordingFetch(() => new Response(SECRET_BODY, { status: 500 }));
    const err = await createMetadataTokenProvider({ fetch })().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuditStoreError);
    expect((err as Error).message).not.toContain('internal-detail-xyz');
  });

  it('is used lazily by the backend: no request until the first store call', async () => {
    const { fetch, requests } = recordingFetch((req) =>
      req.url === METADATA_TOKEN_URL
        ? new Response(JSON.stringify({ access_token: 'meta-token', expires_in: 3600 }))
        : new Response('{"ok":1}')
    );
    const backend = new GcsAuditStoreBackend({
      bucket: BUCKET,
      fetch,
      tokenProvider: createMetadataTokenProvider({ fetch }),
    });
    expect(requests).toHaveLength(0);
    await backend.getJson('audits/a1/meta.json');
    expect(requests.map((r) => r.url)[0]).toBe(METADATA_TOKEN_URL);
    expect(requests[1].headers.get('authorization')).toBe('Bearer meta-token');
  });
});
