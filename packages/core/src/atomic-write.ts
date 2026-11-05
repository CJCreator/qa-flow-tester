import { promises as fs } from 'fs';
import path from 'path';

export interface SafeReadResult<T = unknown> {
  data: T | null;
  corrupt?: boolean;
  readOnly?: boolean;
  version?: number;
}

/** A temp file older than this is left by a crashed write, not by one in progress. */
export const STALE_TEMP_MS = 60 * 60 * 1000;

function tempPattern(baseName: string): RegExp {
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Same shape writeJsonAtomic writes: `<name>.tmp-<pid>-<epoch ms>-<6 chars>`.
  return new RegExp('^' + escaped + '\\.tmp-\\d+-(\\d+)-[a-z0-9]{1,6}$');
}

/**
 * Removes temp files that a crashed writeJsonAtomic left next to `filePath`. Only names in the atomic-write
 * pattern for this file, and only when older than STALE_TEMP_MS. Best effort: never throws.
 */
export async function purgeStaleTempFiles(filePath: string, now: number = Date.now()): Promise<number> {
  const dir = path.dirname(filePath);
  const pattern = tempPattern(path.basename(filePath));
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  let removed = 0;
  for (const name of names) {
    const match = pattern.exec(name);
    if (!match) continue;
    const createdAt = Number(match[1]);
    if (!Number.isFinite(createdAt) || now - createdAt < STALE_TEMP_MS) continue;
    await fs.rm(path.join(dir, name), { force: true }).then(
      () => removed++,
      () => {}
    );
  }
  return removed;
}

/**
 * Atomically writes a JSON value to disk:
 * Writes to a temporary file in the same directory, flushes it to disk (fsync), then renames over the target path.
 * Cleans up temp file on failure. Temp files a crashed earlier write left behind are purged first.
 */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await purgeStaleTempFiles(filePath);
  const tmpFile = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const fh = await fs.open(tmpFile, 'w');
    try {
      await fh.writeFile(JSON.stringify(value, null, 2), 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.rename(tmpFile, filePath);
  } catch (err) {
    await fs.rm(tmpFile, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Safely reads a JSON file from disk:
 * - If file does not exist, returns { data: null }
 * - If file is invalid JSON (corrupted / truncated), copies it to `<filePath>.corrupt-<timestamp>` and returns { data: null, corrupt: true }
 * - Checks `schemaVersion`: if version > currentVersion, marks readOnly: true
 */
export async function readJsonSafe<T = any>(
  filePath: string,
  options?: {
    currentVersion?: number;
    logWarning?: (msg: string) => void;
  }
): Promise<SafeReadResult<T>> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { data: null };
    }
    throw err;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt file: copy aside so evidence is not lost
    const corruptPath = `${filePath}.corrupt-${Date.now()}`;
    await fs.copyFile(filePath, corruptPath).catch(() => {});
    options?.logWarning?.(`Corrupted JSON file ${filePath} backed up to ${corruptPath}`);
    return { data: null, corrupt: true };
  }

  const currentVersion = options?.currentVersion ?? 1;
  const version = typeof parsed?.schemaVersion === 'number' ? parsed.schemaVersion : 0;
  if (version > currentVersion) {
    options?.logWarning?.(
      `File ${filePath} has schemaVersion ${version} (newer than supported ${currentVersion}); loaded read-only.`
    );
    return { data: parsed as T, readOnly: true, version };
  }

  return { data: parsed as T, readOnly: false, version };
}
