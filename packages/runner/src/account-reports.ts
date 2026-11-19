import { promises as fs } from 'fs';
import path from 'path';
import type { AuditStoreBackend } from '@qa/core';
import { isRunSummary, type RunSummary } from '@qa/types';
import { accountHash } from './account-usage.js';

/**
 * Check-up reports kept in the audit store bucket for 30 days (ADR 0050, T-437). When a run ends, its run folder
 * is copied to `reports/<account hash>/<runId>/…`; a bucket lifecycle rule (`scripts/bucket-lifecycle.json`)
 * deletes the objects after 30 days. Only that account, or the owner, may read them. The hash is of the
 * lower-cased email, never the email.
 */

export const REPORTS_PREFIX = 'reports';
/** A single file larger than this stays out of the bucket (the local copy still has it while the instance is up). */
export const MAX_ARCHIVED_FILE_BYTES = 25 * 1024 * 1024;
/** A run's files in total. */
export const MAX_ARCHIVED_RUN_BYTES = 200 * 1024 * 1024;

type Backend = Pick<AuditStoreBackend, 'getJson' | 'putBytes' | 'getBytes' | 'list'> &
  Partial<Pick<AuditStoreBackend, 'listFolders'>>;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function reportKey(hash: string, runId: string, rel: string): string {
  return `${REPORTS_PREFIX}/${hash}/${runId}/${rel}`;
}

async function filesUnder(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(full, base)));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

export class AccountReports {
  constructor(private readonly backend: Backend) {}

  /**
   * Copies a finished run's folder into the bucket for this account. A file the store refuses (a name outside its
   * key alphabet), one over the size cap, or one `skip` names (saved sign-ins) is left out. Never throws.
   */
  async archive(
    email: string,
    runId: string,
    dir: string,
    skip: (rel: string) => boolean = () => false
  ): Promise<number> {
    if (!SAFE_ID.test(runId)) return 0;
    const hash = accountHash(email);
    let total = 0;
    let copied = 0;
    try {
      // summary.json goes last: a run is listed only once every other file is in.
      const files = (await filesUnder(dir)).sort((a, b) => Number(a === 'summary.json') - Number(b === 'summary.json'));
      for (const rel of files) {
        if (skip(rel)) continue;
        try {
          const data = await fs.readFile(path.join(dir, rel));
          if (data.length > MAX_ARCHIVED_FILE_BYTES || total + data.length > MAX_ARCHIVED_RUN_BYTES) continue;
          await this.backend.putBytes(reportKey(hash, runId, rel), data);
          total += data.length;
          copied++;
        } catch {
          // this file only
        }
      }
    } catch {
      console.error('[Release check-up] Couldn’t save a check-up report to the store.');
    }
    return copied;
  }

  private async runIdsOf(hash: string): Promise<string[]> {
    const folder = `${REPORTS_PREFIX}/${hash}`;
    if (this.backend.listFolders) return (await this.backend.listFolders(folder)).filter((id) => SAFE_ID.test(id));
    const ids = new Set<string>();
    for (const key of await this.backend.list(folder)) {
      const id = key.slice(folder.length + 1).split('/')[0];
      if (id && SAFE_ID.test(id)) ids.add(id);
    }
    return [...ids];
  }

  /** The account's saved runs, newest first. Unreadable ones are left out. */
  async list(email: string): Promise<RunSummary[]> {
    const hash = accountHash(email);
    const out: RunSummary[] = [];
    try {
      for (const runId of await this.runIdsOf(hash)) {
        const summary = await this.backend.getJson<unknown>(reportKey(hash, runId, 'summary.json')).catch(() => null);
        if (isRunSummary(summary)) out.push(summary);
      }
    } catch {
      // an unreadable store lists nothing
    }
    return out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  /** Does this account hold this run? */
  async has(email: string, runId: string): Promise<boolean> {
    if (!SAFE_ID.test(runId)) return false;
    return (
      (await this.backend.getJson(reportKey(accountHash(email), runId, 'summary.json')).catch(() => null)) !== null
    );
  }

  /** The owner's lookup: the account hash that holds this run, from any account. */
  async locate(runId: string): Promise<string | null> {
    if (!SAFE_ID.test(runId)) return null;
    try {
      const hashes = this.backend.listFolders
        ? await this.backend.listFolders(REPORTS_PREFIX)
        : [...new Set((await this.backend.list(REPORTS_PREFIX)).map((k) => k.split('/')[1]).filter(Boolean))];
      for (const hash of hashes) {
        if ((await this.backend.getJson(reportKey(hash, runId, 'summary.json')).catch(() => null)) !== null)
          return hash;
      }
    } catch {
      // not found
    }
    return null;
  }

  /** One saved file, or null. */
  async read(hash: string, runId: string, rel: string): Promise<Uint8Array | null> {
    if (!SAFE_ID.test(runId) || !/^[A-Za-z0-9]+$/.test(hash)) return null;
    try {
      return await this.backend.getBytes(reportKey(hash, runId, rel));
    } catch {
      return null;
    }
  }
}
