/**
 * Website Audit store backend contract (ADR 0036).
 *
 * Every backend takes relative object keys only, such as `audits/a1/v1/page.json`.
 * Keys are checked before any I/O, so no key can name a path outside the store root.
 */

export interface AuditStoreBackend {
  /** `local` stores files under `<dataDir>/audit-store/`; `gcs` stores objects in a Cloud Storage bucket. */
  readonly kind: 'local' | 'gcs';
  /** Reads a JSON object; a missing key reads as null. */
  getJson<T = unknown>(key: string): Promise<T | null>;
  /** Writes a JSON object, replacing any earlier value. */
  putJson(key: string, value: unknown): Promise<void>;
  /** Reads raw bytes; a missing key reads as null. */
  getBytes(key: string): Promise<Uint8Array | null>;
  /** Writes raw bytes, replacing any earlier value. */
  putBytes(key: string, data: Uint8Array): Promise<void>;
  /**
   * Lists every key under a folder prefix (`audits/a1` or `audits/a1/` both mean the folder `audits/a1/`),
   * sorted. An empty prefix lists the whole store.
   */
  list(prefix: string): Promise<string[]>;
  /** Removes every key under a folder prefix. The prefix must not be empty. */
  deletePrefix(prefix: string): Promise<void>;
}

export type AuditStoreErrorCode =
  | 'invalid-key'
  | 'invalid-bucket'
  | 'invalid-data'
  | 'unauthorized'
  | 'forbidden'
  | 'rate-limited'
  | 'unavailable'
  | 'failed';

/** Store failure with fixed wording: never carries tokens, response bodies or object contents. */
export class AuditStoreError extends Error {
  readonly code: AuditStoreErrorCode;
  constructor(code: AuditStoreErrorCode, message: string) {
    super(message);
    this.name = 'AuditStoreError';
    this.code = code;
  }
}

/** Longest key Cloud Storage accepts (object names are at most 1024 bytes; keys here are ASCII). */
export const MAX_AUDIT_STORE_KEY_LENGTH = 1024;

const KEY_CHARS = /^[A-Za-z0-9._\-/]+$/;

function invalidKey(): AuditStoreError {
  return new AuditStoreError(
    'invalid-key',
    'Audit store key refused: use a relative path of letters, digits, dots, dashes, underscores and slashes, with no empty, "." or ".." parts.'
  );
}

/** Throws unless `key` is a safe relative object key. */
export function assertValidKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_AUDIT_STORE_KEY_LENGTH) {
    throw invalidKey();
  }
  // The character set excludes backslashes, colons, NUL and every other path or drive syntax.
  if (!KEY_CHARS.test(key)) throw invalidKey();
  for (const segment of key.split('/')) {
    // Empty segments cover a leading '/', a trailing '/' and '//'.
    // Dot-only segments cover '.', '..' and Windows names such as '...' that normalize to the parent.
    if (segment.length === 0 || /^\.+$/.test(segment)) throw invalidKey();
  }
}

/**
 * Turns a folder prefix into its canonical form ending in '/', after the same checks as a key.
 * An empty prefix returns '' only when `allowEmpty` is set (listing the whole store).
 */
export function normalizePrefix(prefix: string, options: { allowEmpty?: boolean } = {}): string {
  if (prefix === '' && options.allowEmpty) return '';
  if (typeof prefix !== 'string') throw invalidKey();
  const folder = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  assertValidKey(folder);
  return `${folder}/`;
}
