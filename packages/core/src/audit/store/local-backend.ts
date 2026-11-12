import { promises as fs } from 'fs';
import path from 'path';
import { writeJsonAtomic } from '../../atomic-write.js';
import {
  assertKeyInFolder,
  assertValidKey,
  AuditStoreError,
  normalizePrefix,
  type AuditStoreBackend,
  type DeletePrefixOptions,
} from './backend.js';

/** Folder under the runner data folder that holds the local audit store (ADR 0036). */
export const LOCAL_AUDIT_STORE_DIR = 'audit-store';

/** Temp files left by writeJsonAtomic or putBytes mid-write; never listed as keys. */
const TEMP_FILE = /\.tmp-\d+-\d+-[a-z0-9]+$/;

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Local file backend: plain files under `<dataDir>/audit-store/`. Needs no cloud account. */
export class LocalAuditStoreBackend implements AuditStoreBackend {
  readonly kind = 'local' as const;
  readonly root: string;

  constructor(dataDir: string) {
    this.root = path.resolve(dataDir, LOCAL_AUDIT_STORE_DIR);
  }

  /** Maps a checked key to a path, and confirms the path stays inside the root (defence in depth). */
  private resolve(key: string): string {
    const target = path.resolve(this.root, ...key.split('/'));
    const rel = path.relative(this.root, target);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new AuditStoreError('invalid-key', 'Audit store key refused: it names a path outside the store.');
    }
    return target;
  }

  async getJson<T = unknown>(key: string): Promise<T | null> {
    assertValidKey(key);
    let raw: string;
    try {
      raw = await fs.readFile(this.resolve(key), 'utf8');
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new AuditStoreError('invalid-data', 'Audit store object is not valid JSON.');
    }
  }

  async putJson(key: string, value: unknown): Promise<void> {
    assertValidKey(key);
    await writeJsonAtomic(this.resolve(key), value);
  }

  async getBytes(key: string): Promise<Uint8Array | null> {
    assertValidKey(key);
    try {
      return new Uint8Array(await fs.readFile(this.resolve(key)));
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async putBytes(key: string, data: Uint8Array): Promise<void> {
    assertValidKey(key);
    const filePath = this.resolve(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpFile = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await fs.writeFile(tmpFile, data);
      await fs.rename(tmpFile, filePath);
    } catch (err) {
      await fs.rm(tmpFile, { force: true }).catch(() => {});
      throw err;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const folder = normalizePrefix(prefix, { allowEmpty: true });
    const start = folder === '' ? this.root : this.resolve(folder.slice(0, -1));
    const keys: string[] = [];
    await this.walk(start, folder, keys);
    return keys.sort();
  }

  async listFolders(prefix: string): Promise<string[]> {
    const folder = normalizePrefix(prefix, { allowEmpty: true });
    const start = folder === '' ? this.root : this.resolve(folder.slice(0, -1));
    try {
      const entries = await fs.readdir(start, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => String(e.name))
        .sort();
    } catch (err) {
      if (isMissing(err)) return [];
      throw err;
    }
  }

  private async walk(dir: string, keyPrefix: string, out: string[]): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (isMissing(err)) return;
      throw err;
    }
    for (const entry of entries) {
      const name = String(entry.name);
      if (entry.isDirectory()) {
        await this.walk(path.join(dir, name), `${keyPrefix}${name}/`, out);
      } else if (entry.isFile() && !TEMP_FILE.test(name)) {
        out.push(`${keyPrefix}${name}`);
      }
    }
  }

  async deletePrefix(prefix: string, options: DeletePrefixOptions = {}): Promise<void> {
    const folder = normalizePrefix(prefix);
    const folderDir = this.resolve(folder.slice(0, -1));
    if (options.last !== undefined) {
      assertKeyInFolder(folder, options.last);
      const lastFileName = options.last.slice(folder.length);
      let entries: string[];
      try {
        entries = await fs.readdir(folderDir);
      } catch (err) {
        if (isMissing(err)) return;
        throw err;
      }
      for (const entry of entries) {
        if (entry !== lastFileName) {
          await fs.rm(path.join(folderDir, entry), { recursive: true, force: true });
        }
      }
    }
    await fs.rm(folderDir, { recursive: true, force: true });
  }
}

export function createLocalAuditStoreBackend(dataDir: string): LocalAuditStoreBackend {
  return new LocalAuditStoreBackend(dataDir);
}
