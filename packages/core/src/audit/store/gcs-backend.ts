import {
  assertKeyInFolder,
  assertValidKey,
  AuditStoreError,
  normalizePrefix,
  type AuditStoreBackend,
  type DeletePrefixOptions,
} from './backend.js';

/**
 * Cloud Storage backend over the JSON REST API (ADR 0036). No SDK: every request goes through the
 * injected fetch, with a bearer token from the injected token provider. Errors carry fixed wording only:
 * never the token, the response body or object contents.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Returns a current OAuth access token for the runner's service account. */
export type AccessTokenProvider = () => Promise<string>;

export const GCS_API_BASE = 'https://storage.googleapis.com';

export const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

/** Refresh the cached token this long before it expires. */
export const TOKEN_REFRESH_MARGIN_MS = 60_000;

export const GCS_REQUEST_TIMEOUT_MS = 30_000;
export const METADATA_TIMEOUT_MS = 5_000;
export const GCS_RETRY_DELAYS_MS: readonly number[] = [250, 1000];

/** Object deletes sent at once by `deletePrefix`. */
const DELETE_IN_FLIGHT = 8;

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cloud Storage bucket naming rules: 3-63 characters (up to 222 with dots, each dot-separated part at most 63),
 * lowercase letters, digits, dashes, underscores and dots, starting and ending with a letter or digit,
 * not an IP address, not starting with "goog" and not containing "google".
 */
export function isValidBucketName(name: string): boolean {
  if (typeof name !== 'string') return false;
  if (name.length < 3 || name.length > 222) return false;
  if (!/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(name)) return false;
  const parts = name.split('.');
  if (parts.length === 1 && name.length > 63) return false;
  for (const part of parts) {
    if (part.length === 0 || part.length > 63) return false;
    if (!/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/.test(part)) return false;
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(name)) return false;
  if (name.startsWith('goog') || name.includes('google')) return false;
  return true;
}

function statusError(status: number): AuditStoreError {
  if (status === 401) {
    return new AuditStoreError('unauthorized', 'Cloud Storage refused the audit store credentials (401).');
  }
  if (status === 403) {
    return new AuditStoreError('forbidden', 'Cloud Storage denied access to the audit store bucket (403).');
  }
  if (status === 429) {
    return new AuditStoreError(
      'rate-limited',
      'Cloud Storage is rate limiting the audit store (429). Try again later.'
    );
  }
  if (status >= 500) {
    return new AuditStoreError('unavailable', `Cloud Storage is unavailable (${status}). Try again later.`);
  }
  return new AuditStoreError('failed', `Cloud Storage rejected an audit store request (${status}).`);
}

function networkError(): AuditStoreError {
  return new AuditStoreError('unavailable', 'Cloud Storage could not be reached. Try again later.');
}

async function discardBody(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => {});
}

/**
 * Default token provider: reads the Cloud Run metadata server and caches the token until
 * shortly before it expires. Concurrent callers share one request.
 */
export function createMetadataTokenProvider(options: {
  fetch: FetchLike;
  now?: () => number;
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
}): AccessTokenProvider {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? METADATA_TIMEOUT_MS;
  const retryDelaysMs = options.retryDelaysMs ?? GCS_RETRY_DELAYS_MS;
  let cached: { token: string; expiresAt: number } | null = null;
  let inflight: Promise<string> | null = null;

  const refresh = async (): Promise<string> => {
    for (let i = 0; i <= retryDelaysMs.length; i++) {
      const isLast = i === retryDelaysMs.length;
      let res: Response;
      try {
        res = await options.fetch(METADATA_TOKEN_URL, {
          headers: { 'Metadata-Flavor': 'Google' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        if (isLast) {
          throw new AuditStoreError('unauthorized', 'The audit store could not get a Cloud Storage access token.');
        }
        await sleep(retryDelaysMs[i]);
        continue;
      }
      if (!isLast && isRetryableStatus(res.status)) {
        await discardBody(res);
        await sleep(retryDelaysMs[i]);
        continue;
      }
      if (!res.ok) {
        await discardBody(res);
        throw new AuditStoreError(
          'unauthorized',
          `The audit store could not get a Cloud Storage access token (${res.status}).`
        );
      }
      let body: { access_token?: unknown; expires_in?: unknown };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        throw new AuditStoreError('unauthorized', 'The audit store got an unreadable Cloud Storage access token.');
      }
      if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
        throw new AuditStoreError('unauthorized', 'The audit store got an unreadable Cloud Storage access token.');
      }
      const expiresInSec = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 0;
      cached = { token: body.access_token, expiresAt: now() + expiresInSec * 1000 };
      return body.access_token;
    }
    throw new AuditStoreError('unauthorized', 'The audit store could not get a Cloud Storage access token.');
  };

  return async () => {
    if (cached && now() < cached.expiresAt - TOKEN_REFRESH_MARGIN_MS) return cached.token;
    if (!inflight) {
      inflight = refresh().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  };
}

export interface GcsAuditStoreOptions {
  bucket: string;
  fetch: FetchLike;
  tokenProvider: AccessTokenProvider;
  /** Override for tests; defaults to the public Cloud Storage endpoint. */
  apiBase?: string;
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
}

export class GcsAuditStoreBackend implements AuditStoreBackend {
  readonly kind = 'gcs' as const;
  readonly bucket: string;
  private readonly fetchFn: FetchLike;
  private readonly tokenProvider: AccessTokenProvider;
  private readonly apiBase: string;
  private readonly timeoutMs: number;
  private readonly retryDelaysMs: readonly number[];

  constructor(options: GcsAuditStoreOptions) {
    if (!isValidBucketName(options.bucket)) {
      throw new AuditStoreError('invalid-bucket', invalidBucketMessage());
    }
    this.bucket = options.bucket;
    this.fetchFn = options.fetch;
    this.tokenProvider = options.tokenProvider;
    this.apiBase = (options.apiBase ?? GCS_API_BASE).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? GCS_REQUEST_TIMEOUT_MS;
    this.retryDelaysMs = options.retryDelaysMs ?? GCS_RETRY_DELAYS_MS;
  }

  private objectUrl(key: string): string {
    return `${this.apiBase}/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(key)}`;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    for (let i = 0; i <= this.retryDelaysMs.length; i++) {
      const isLast = i === this.retryDelaysMs.length;
      const token = await this.tokenProvider();
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${token}`);
      let res: Response;
      try {
        res = await this.fetchFn(url, { ...init, headers, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch {
        if (isLast) {
          throw networkError();
        }
        await sleep(this.retryDelaysMs[i]);
        continue;
      }
      if (!isLast && isRetryableStatus(res.status)) {
        await discardBody(res);
        await sleep(this.retryDelaysMs[i]);
        continue;
      }
      return res;
    }
    throw networkError();
  }

  /** Downloads an object; null on 404. */
  private async download(key: string): Promise<Response | null> {
    assertValidKey(key);
    const res = await this.request(`${this.objectUrl(key)}?alt=media`);
    if (res.status === 404) {
      await discardBody(res);
      return null;
    }
    if (!res.ok) {
      await discardBody(res);
      throw statusError(res.status);
    }
    return res;
  }

  private async upload(key: string, body: Uint8Array | string, contentType: string): Promise<void> {
    assertValidKey(key);
    const url =
      `${this.apiBase}/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o` +
      `?uploadType=media&name=${encodeURIComponent(key)}`;
    const res = await this.request(url, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: body as BodyInit,
    });
    await discardBody(res);
    if (!res.ok) throw statusError(res.status);
  }

  async getJson<T = unknown>(key: string): Promise<T | null> {
    const res = await this.download(key);
    if (!res) return null;
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw networkError();
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AuditStoreError('invalid-data', 'Audit store object is not valid JSON.');
    }
  }

  async putJson(key: string, value: unknown): Promise<void> {
    await this.upload(key, JSON.stringify(value), 'application/json; charset=utf-8');
  }

  async getBytes(key: string): Promise<Uint8Array | null> {
    const res = await this.download(key);
    if (!res) return null;
    try {
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      throw networkError();
    }
  }

  async putBytes(key: string, data: Uint8Array): Promise<void> {
    await this.upload(key, data, 'application/octet-stream');
  }

  async list(prefix: string): Promise<string[]> {
    const folder = normalizePrefix(prefix, { allowEmpty: true });
    const keys: string[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ fields: 'items(name),nextPageToken' });
      if (folder) params.set('prefix', folder);
      if (pageToken) params.set('pageToken', pageToken);
      const res = await this.request(`${this.apiBase}/storage/v1/b/${encodeURIComponent(this.bucket)}/o?${params}`);
      if (!res.ok) {
        await discardBody(res);
        throw statusError(res.status);
      }
      let page: { items?: Array<{ name?: unknown }>; nextPageToken?: unknown };
      try {
        page = (await res.json()) as typeof page;
      } catch {
        throw new AuditStoreError('invalid-data', 'Cloud Storage returned an unreadable object list.');
      }
      for (const item of page.items ?? []) {
        if (typeof item?.name === 'string') keys.push(item.name);
      }
      pageToken = typeof page.nextPageToken === 'string' && page.nextPageToken ? page.nextPageToken : undefined;
    } while (pageToken);
    return keys.sort();
  }

  async listFolders(prefix: string): Promise<string[]> {
    const folder = normalizePrefix(prefix, { allowEmpty: true });
    const names: string[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ fields: 'prefixes,nextPageToken', delimiter: '/' });
      if (folder) params.set('prefix', folder);
      if (pageToken) params.set('pageToken', pageToken);
      const res = await this.request(`${this.apiBase}/storage/v1/b/${encodeURIComponent(this.bucket)}/o?${params}`);
      if (!res.ok) {
        await discardBody(res);
        throw statusError(res.status);
      }
      let page: { prefixes?: unknown[]; nextPageToken?: unknown };
      try {
        page = (await res.json()) as typeof page;
      } catch {
        throw new AuditStoreError('invalid-data', 'Cloud Storage returned an unreadable object list.');
      }
      for (const p of page.prefixes ?? []) {
        if (typeof p !== 'string') continue;
        const name = p.slice(folder.length).replace(/\/$/, '');
        if (name && !name.includes('/')) names.push(name);
      }
      pageToken = typeof page.nextPageToken === 'string' && page.nextPageToken ? page.nextPageToken : undefined;
    } while (pageToken);
    return names.sort();
  }

  private async deleteObject(key: string): Promise<void> {
    const res = await this.request(this.objectUrl(key), { method: 'DELETE' });
    await discardBody(res);
    // 404: already gone (deleted concurrently); the goal state holds.
    if (!res.ok && res.status !== 404) throw statusError(res.status);
  }

  async deletePrefix(prefix: string, options: DeletePrefixOptions = {}): Promise<void> {
    const folder = normalizePrefix(prefix);
    if (options.last !== undefined) {
      assertKeyInFolder(folder, options.last);
    }
    const keys = await this.list(prefix);
    const toDelete = options.last !== undefined ? keys.filter((k) => k !== options.last) : keys;
    // A few at once: an audit has hundreds of objects and the audit lock is held while they go.
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const key = toDelete[next++];
        if (key === undefined) return;
        await this.deleteObject(key);
      }
    };
    await Promise.all(Array.from({ length: Math.min(DELETE_IN_FLIGHT, toDelete.length) }, () => worker()));
    if (options.last !== undefined) {
      // Only once everything else is gone: a failure above leaves the record, so the delete can be run again.
      await this.deleteObject(options.last);
    }
  }
}

export function invalidBucketMessage(): string {
  return (
    'AUDIT_STORE_BUCKET is not a valid Cloud Storage bucket name: use 3 to 63 lowercase letters, digits, ' +
    'dashes, underscores or dots, starting and ending with a letter or digit, not an IP address, ' +
    'not starting with "goog" and not containing "google".'
  );
}
