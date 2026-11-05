import { promises as fs } from 'fs';
import path from 'path';

/** A visitor's folder is purged once nothing in it has changed for this long (ADR 0039 cleanup, M3). */
export const VISITOR_FOLDER_IDLE_MS = 24 * 3_600_000;

/**
 * Deletes the visitor session folders under `sessionsDir` (`<dataDir>/sessions/<id>`) that have been idle for
 * VISITOR_FOLDER_IDLE_MS, judged by the newest modification time of the folder or of anything directly in it.
 * Folders named in `keep` (sessions still in memory) are left alone. Returns how many were deleted. A folder that
 * cannot be read or deleted is skipped; nothing outside `sessionsDir` is ever touched.
 */
export async function purgeVisitorFolders(
  sessionsDir: string,
  now: number,
  keep: ReadonlySet<string>
): Promise<number> {
  const entries = await fs.readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
  let purged = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || keep.has(entry.name)) continue;
    const folder = path.join(sessionsDir, entry.name);
    const newest = await newestModified(folder).catch(() => null);
    if (newest === null || now - newest < VISITOR_FOLDER_IDLE_MS) continue;
    const removed = await fs.rm(folder, { recursive: true, force: true }).then(
      () => true,
      () => false
    );
    if (removed) purged += 1;
  }
  return purged;
}

/** The newest modification time (ms) of a folder and of its direct entries. */
async function newestModified(folder: string): Promise<number> {
  let newest = (await fs.stat(folder)).mtimeMs;
  const names = await fs.readdir(folder).catch(() => [] as string[]);
  for (const name of names) {
    const stat = await fs.stat(path.join(folder, name)).catch(() => null);
    if (stat && stat.mtimeMs > newest) newest = stat.mtimeMs;
  }
  return newest;
}
