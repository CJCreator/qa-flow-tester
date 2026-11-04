/**
 * Website Audit store (ADR 0036, REQ-028): saved audits and their versions, on any AuditStoreBackend.
 *
 * Holds no cache: every read goes to the backend, so a new store opened on the same backend (a restart)
 * sees everything, and a removal is visible on the very next read. Writes to one audit run one at a time.
 * Stored records hold only the fields named here, copied one by one, so stray input (tokens, keys)
 * never reaches the store.
 */
import { randomBytes } from 'crypto';
import {
  isDocumentLanguage,
  MAX_AUDIT_URL_CHARS,
  type AuditLimits,
  type AuditRequest,
  type AuditResult,
  type AuditStatus,
  type AuditSummary,
  type AuditVersion,
  type HelperGrant,
  type HelperPermission,
  type ShareLink,
  type ShareLinkKind,
  type DocumentLanguage,
  type ShortlistEntry,
  type ShortlistListItem,
  type ShortlistUpdate,
} from '@qa/types';
import type { AuditStoreBackend } from './backend.js';
import {
  AUDITS_FOLDER,
  assertAuditId,
  assertVersion,
  auditFolder,
  auditRecordKey,
  invalidInput,
  notFound,
  resultKey,
  versionFileKey,
  versionJsonKey,
  versionRecordKey,
} from './keys.js';
import { getShortlist, listShortlist, putShortlist, type ShortlistFilter } from './shortlist.js';
import { createShare, listShares, resolveShare, revokeShare, tombstoneShares, type ShareResolution } from './shares.js';
import { grantHelper, grantsFor, listHelpers, removeHelper, removeHelperIndexEntries } from './helper-grants.js';

/** The saved-audit record (`audits/<auditId>/audit.json`). Versions live in their own folders. */
export interface AuditRecord {
  auditId: string;
  createdAt: string;
  /** Highest version number written; versions are 1..latestVersion. */
  latestVersion: number;
}

/** What `updateVersion` may change. Only the fields sent change. */
export interface AuditVersionUpdate {
  status?: AuditStatus;
  finishedAt?: string;
  /** Short fixed wording, never page text or a stack trace. */
  error?: string;
  pagesRecorded?: number;
  pagesSkipped?: number;
  findings?: number;
  edited?: boolean;
}

export interface AuditStoreOptions {
  /** Injected clock for tests; defaults to the system clock. */
  now?: () => Date;
}

/** What the Shortlist, Shared Link and Helper modules use from the store. */
export interface AuditStoreContext {
  readonly backend: AuditStoreBackend;
  now(): Date;
  /** Runs `fn` after every earlier write to the same audit has finished. Not re-entrant. */
  withAuditLock<T>(auditId: string, fn: () => Promise<T>): Promise<T>;
  readAuditRecord(auditId: string): Promise<AuditRecord | null>;
  readVersion(auditId: string, version: number): Promise<AuditVersion | null>;
  getAudit(auditId: string): Promise<AuditSummary | null>;
  listAudits(): Promise<AuditSummary[]>;
}

const AUDIT_STATUSES: readonly AuditStatus[] = ['running', 'done', 'failed', 'stopped'];
const MAX_LIMIT_VALUE = 1_000_000;
const MAX_PATH_RULES = 200;
const MAX_PATH_RULE_CHARS = 2048;
/** Longest stored version error: short fixed wording only. */
export const MAX_VERSION_ERROR_CHARS = 300;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const AUDIT_RECORD_KEY = /^audits\/([A-Za-z0-9_-]{8,64})\/audit\.json$/;

/** Per backend, per audit: the tail of the queue of writes. Shared by every store on the same backend. */
const auditLocks = new WeakMap<AuditStoreBackend, Map<string, Promise<void>>>();

function runSerialised<T>(backend: AuditStoreBackend, auditId: string, fn: () => Promise<T>): Promise<T> {
  let queue = auditLocks.get(backend);
  if (!queue) {
    queue = new Map();
    auditLocks.set(backend, queue);
  }
  const previous = queue.get(auditId) ?? Promise.resolve();
  const run = previous.then(() => fn());
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  queue.set(auditId, tail);
  void tail.then(() => {
    if (queue.get(auditId) === tail) queue.delete(auditId);
  });
  return run;
}

/** A fresh random audit id: 128 random bits, base64url (22 characters), matching AUDIT_ID_PATTERN. */
export function newAuditId(): string {
  return randomBytes(16).toString('base64url');
}

function isNonNegativeInt(value: unknown, max = MAX_LIMIT_VALUE): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

function copyPathRules(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_PATH_RULES) throw invalidInput(`The ${field} list is not valid.`);
  return value.map((rule) => {
    if (typeof rule !== 'string' || rule.length > MAX_PATH_RULE_CHARS) {
      throw invalidInput(`The ${field} list is not valid.`);
    }
    return rule;
  });
}

function checkUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_AUDIT_URL_CHARS) {
    throw invalidInput('The address is not valid.');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidInput('The address is not valid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalidInput('The address is not valid.');
  // A user name or password in the address is a credential: never stored.
  if (url.username || url.password) throw invalidInput('The address is not valid.');
  return value;
}

/** Copies a validated AuditRequest field by field (nothing else from the input is kept). */
export function checkAuditRequest(input: unknown): AuditRequest {
  if (!input || typeof input !== 'object') throw invalidInput('The audit request is not valid.');
  const request = input as Partial<AuditRequest>;
  const url = checkUrl(request.url);
  const limits = request.limits as Partial<AuditLimits> | undefined;
  if (!limits || typeof limits !== 'object') throw invalidInput('The audit limits are not valid.');
  if (!isNonNegativeInt(limits.maxPages) || limits.maxPages < 1 || !isNonNegativeInt(limits.maxDepth)) {
    throw invalidInput('The audit limits are not valid.');
  }
  if (!isDocumentLanguage(request.language)) throw invalidInput('The audit language is not valid.');
  return {
    url,
    limits: {
      maxPages: limits.maxPages,
      maxDepth: limits.maxDepth,
      includePaths: copyPathRules(limits.includePaths, 'include'),
      excludePaths: copyPathRules(limits.excludePaths, 'exclude'),
    },
    language: request.language,
  };
}

function checkVersionUpdate(input: unknown): AuditVersionUpdate {
  if (!input || typeof input !== 'object') throw invalidInput('The version update is not valid.');
  const update = input as Record<string, unknown>;
  const out: AuditVersionUpdate = {};
  if (update.status !== undefined) {
    if (!AUDIT_STATUSES.includes(update.status as AuditStatus)) throw invalidInput('The version status is not valid.');
    out.status = update.status as AuditStatus;
  }
  if (update.finishedAt !== undefined) {
    if (typeof update.finishedAt !== 'string' || !ISO_TIME.test(update.finishedAt)) {
      throw invalidInput('The finish time is not valid.');
    }
    out.finishedAt = update.finishedAt;
  }
  if (update.error !== undefined) {
    if (typeof update.error !== 'string' || update.error.length > MAX_VERSION_ERROR_CHARS) {
      throw invalidInput('The version error is not valid.');
    }
    out.error = update.error;
  }
  for (const field of ['pagesRecorded', 'pagesSkipped', 'findings'] as const) {
    if (update[field] !== undefined) {
      if (!isNonNegativeInt(update[field])) throw invalidInput(`The ${field} count is not valid.`);
      out[field] = update[field] as number;
    }
  }
  if (update.edited !== undefined) {
    if (typeof update.edited !== 'boolean') throw invalidInput('The edited flag is not valid.');
    out.edited = update.edited;
  }
  return out;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export class AuditStore implements AuditStoreContext {
  readonly backend: AuditStoreBackend;
  private readonly clock: () => Date;

  constructor(backend: AuditStoreBackend, options: AuditStoreOptions = {}) {
    this.backend = backend;
    this.clock = options.now ?? (() => new Date());
  }

  now(): Date {
    return this.clock();
  }

  withAuditLock<T>(auditId: string, fn: () => Promise<T>): Promise<T> {
    assertAuditId(auditId);
    return runSerialised(this.backend, auditId, fn);
  }

  // -------------------------------------------------------------------------------------------------
  // Audits and versions (REQ-028)
  // -------------------------------------------------------------------------------------------------

  async readAuditRecord(auditId: string): Promise<AuditRecord | null> {
    return this.backend.getJson<AuditRecord>(auditRecordKey(auditId));
  }

  async readVersion(auditId: string, version: number): Promise<AuditVersion | null> {
    return this.backend.getJson<AuditVersion>(versionRecordKey(auditId, version));
  }

  /** Saves a new audit with version 1 running. Returns version 1. */
  async createAudit(request: AuditRequest): Promise<AuditVersion> {
    const checked = checkAuditRequest(request);
    const auditId = newAuditId();
    const startedAt = this.now().toISOString();
    return this.withAuditLock(auditId, async () => {
      const version: AuditVersion = {
        auditId,
        version: 1,
        url: checked.url,
        limits: checked.limits,
        language: checked.language,
        status: 'running',
        startedAt,
      };
      // The version first, then the record that makes the audit visible in listAudits.
      await this.backend.putJson(versionRecordKey(auditId, 1), version);
      const record: AuditRecord = { auditId, createdAt: startedAt, latestVersion: 1 };
      await this.backend.putJson(auditRecordKey(auditId), record);
      return version;
    });
  }

  /** Adds the next version, running, with the latest version's address, limits and language (REQ-028 AC-3). */
  async addVersion(auditId: string): Promise<AuditVersion> {
    assertAuditId(auditId);
    return this.withAuditLock(auditId, async () => {
      const record = await this.readAuditRecord(auditId);
      if (!record) throw notFound('audit');
      const latest = await this.readVersion(auditId, record.latestVersion);
      if (!latest) throw notFound('version');
      const next = record.latestVersion + 1;
      assertVersion(next);
      const version: AuditVersion = {
        auditId,
        version: next,
        url: latest.url,
        limits: {
          maxPages: latest.limits.maxPages,
          maxDepth: latest.limits.maxDepth,
          includePaths: [...latest.limits.includePaths],
          excludePaths: [...latest.limits.excludePaths],
        },
        language: latest.language,
        status: 'running',
        startedAt: this.now().toISOString(),
      };
      await this.backend.putJson(versionRecordKey(auditId, next), version);
      await this.backend.putJson(auditRecordKey(auditId), { ...record, latestVersion: next });
      return version;
    });
  }

  /** Records a version's status, finish time, error wording and counts. Only the fields sent change. */
  async updateVersion(auditId: string, version: number, update: AuditVersionUpdate): Promise<AuditVersion> {
    assertAuditId(auditId);
    assertVersion(version);
    const checked = checkVersionUpdate(update);
    return this.withAuditLock(auditId, async () => {
      const current = await this.readVersion(auditId, version);
      if (!current) throw notFound('version');
      const next: AuditVersion = { ...current, ...checked };
      await this.backend.putJson(versionRecordKey(auditId, version), next);
      return next;
    });
  }

  async getVersion(auditId: string, version: number): Promise<AuditVersion | null> {
    assertAuditId(auditId);
    assertVersion(version);
    return this.readVersion(auditId, version);
  }

  /** The audit with every version, oldest first, and its Shortlist entry; null when it does not exist. */
  async getAudit(auditId: string): Promise<AuditSummary | null> {
    assertAuditId(auditId);
    const record = await this.readAuditRecord(auditId);
    if (!record) return null;
    const numbers = Array.from({ length: Math.max(0, record.latestVersion) }, (_, i) => i + 1);
    const versions = (await Promise.all(numbers.map((n) => this.readVersion(auditId, n)))).filter(
      (v): v is AuditVersion => v !== null
    );
    const shortlist = await getShortlist(this, auditId);
    const url = versions.length > 0 ? versions[versions.length - 1].url : '';
    const summary: AuditSummary = { auditId, url, host: hostOf(url), createdAt: record.createdAt, versions };
    if (shortlist) summary.shortlist = shortlist;
    return summary;
  }

  /** Every saved audit, newest first, each with its versions (oldest first) and Shortlist entry. */
  async listAudits(): Promise<AuditSummary[]> {
    const keys = await this.backend.list(AUDITS_FOLDER);
    const ids = keys.map((key) => AUDIT_RECORD_KEY.exec(key)?.[1]).filter((id): id is string => !!id);
    const audits = (await Promise.all(ids.map((id) => this.getAudit(id)))).filter(
      (a): a is AuditSummary => a !== null
    );
    return audits.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.auditId.localeCompare(b.auditId));
  }

  /** Deletes everything the audit owns (Q-30): versions, files, edits, Shortlist, Shared Links, Helper grants. */
  async deleteAudit(auditId: string): Promise<boolean> {
    assertAuditId(auditId);
    return this.withAuditLock(auditId, async () => {
      const existed = (await this.readAuditRecord(auditId)) !== null;
      // Index entries first, so no index entry ever points at a removed folder.
      await tombstoneShares(this, auditId);
      await removeHelperIndexEntries(this, auditId);
      await this.backend.deletePrefix(auditFolder(auditId));
      return existed;
    });
  }

  // -------------------------------------------------------------------------------------------------
  // Per-version data: results, and generic JSON and files for other groups
  // -------------------------------------------------------------------------------------------------

  /** Writes under the audit lock, only while the version exists (so nothing outlives a deleted audit). */
  private async writeToVersion(auditId: string, version: number, write: () => Promise<void>): Promise<void> {
    await this.withAuditLock(auditId, async () => {
      if (!(await this.readVersion(auditId, version))) throw notFound('version');
      await write();
    });
  }

  async saveResult(auditId: string, version: number, result: AuditResult): Promise<void> {
    const key = resultKey(auditId, version);
    if (!result || typeof result !== 'object' || result.auditId !== auditId || result.version !== version) {
      throw invalidInput('The result does not belong to this audit version.');
    }
    await this.writeToVersion(auditId, version, () => this.backend.putJson(key, result));
  }

  async getResult(auditId: string, version: number): Promise<AuditResult | null> {
    return this.backend.getJson<AuditResult>(resultKey(auditId, version));
  }

  /** Reads `audits/<id>/v<n>/<name>.json` (edits, rewrites, Page Content...); null when missing. */
  async readVersionJson<T = unknown>(auditId: string, version: number, name: string): Promise<T | null> {
    return this.backend.getJson<T>(versionJsonKey(auditId, version, name));
  }

  async writeVersionJson(auditId: string, version: number, name: string, value: unknown): Promise<void> {
    const key = versionJsonKey(auditId, version, name);
    if (value === undefined) throw invalidInput('The version object is empty.');
    await this.writeToVersion(auditId, version, () => this.backend.putJson(key, value));
  }

  /** Writes `audits/<id>/v<n>/<name>` (preview.html, screenshots...). */
  async putVersionFile(auditId: string, version: number, name: string, data: Uint8Array): Promise<void> {
    const key = versionFileKey(auditId, version, name);
    if (!(data instanceof Uint8Array)) throw invalidInput('The version file is not valid.');
    await this.writeToVersion(auditId, version, () => this.backend.putBytes(key, data));
  }

  async getVersionFile(auditId: string, version: number, name: string): Promise<Uint8Array | null> {
    return this.backend.getBytes(versionFileKey(auditId, version, name));
  }

  // -------------------------------------------------------------------------------------------------
  // Shortlist (REQ-023)
  // -------------------------------------------------------------------------------------------------

  getShortlist(auditId: string): Promise<ShortlistEntry | null> {
    return getShortlist(this, auditId);
  }

  putShortlist(auditId: string, update: ShortlistUpdate): Promise<ShortlistEntry> {
    return putShortlist(this, auditId, update);
  }

  listShortlist(filter: ShortlistFilter = {}): Promise<ShortlistListItem[]> {
    return listShortlist(this, filter);
  }

  // -------------------------------------------------------------------------------------------------
  // Shared Links (REQ-019, REQ-024)
  // -------------------------------------------------------------------------------------------------

  createShare(
    auditId: string,
    input: { version: number; kind: ShareLinkKind; language: DocumentLanguage }
  ): Promise<ShareLink> {
    return createShare(this, auditId, input);
  }

  revokeShare(auditId: string, linkId: string): Promise<ShareLink> {
    return revokeShare(this, auditId, linkId);
  }

  listShares(auditId: string): Promise<ShareLink[]> {
    return listShares(this, auditId);
  }

  resolveShare(linkId: string): Promise<ShareResolution> {
    return resolveShare(this, linkId);
  }

  // -------------------------------------------------------------------------------------------------
  // Helper grants (REQ-033)
  // -------------------------------------------------------------------------------------------------

  grantHelper(auditId: string, email: string, permissions: HelperPermission[]): Promise<HelperGrant> {
    return grantHelper(this, auditId, email, permissions);
  }

  removeHelper(auditId: string, email: string): Promise<boolean> {
    return removeHelper(this, auditId, email);
  }

  listHelpers(auditId: string): Promise<HelperGrant[]> {
    return listHelpers(this, auditId);
  }

  grantsFor(email: string): Promise<HelperGrant[]> {
    return grantsFor(this, email);
  }
}

export function createAuditStore(backend: AuditStoreBackend, options: AuditStoreOptions = {}): AuditStore {
  return new AuditStore(backend, options);
}
