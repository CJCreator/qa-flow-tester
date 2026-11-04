import type { AuditStoreBackend } from './backend.js';
import { AuditStoreError } from './backend.js';
import {
  createMetadataTokenProvider,
  GcsAuditStoreBackend,
  invalidBucketMessage,
  isValidBucketName,
  type AccessTokenProvider,
  type FetchLike,
} from './gcs-backend.js';
import { LocalAuditStoreBackend } from './local-backend.js';

export interface SelectAuditStoreOptions {
  /** Runner data folder (`RUNNER_DATA_DIR`); the local store lives in `<dataDir>/audit-store/`. */
  dataDir: string;
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
  /** Defaults to the Cloud Run metadata server token provider. */
  tokenProvider?: AccessTokenProvider;
}

/**
 * Picks the audit store (ADR 0036, REQ-029): local files unless `AUDIT_STORE_BUCKET` is set.
 * Makes no network call: the Cloud Storage backend fetches its token on first use.
 */
export function selectAuditStoreBackend(options: SelectAuditStoreOptions): AuditStoreBackend {
  const env = options.env ?? process.env;
  const bucket = (env.AUDIT_STORE_BUCKET ?? '').trim();
  if (!bucket) return new LocalAuditStoreBackend(options.dataDir);

  if (!isValidBucketName(bucket)) {
    throw new AuditStoreError('invalid-bucket', invalidBucketMessage());
  }
  const fetchFn: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const tokenProvider = options.tokenProvider ?? createMetadataTokenProvider({ fetch: fetchFn });
  return new GcsAuditStoreBackend({ bucket, fetch: fetchFn, tokenProvider });
}
