import path from 'path';
import { promises as fs } from 'fs';

/** The steps of a test point failed. Thrown inside a retry attempt so the runner can try again. */
export class StepsFailed extends Error {
  constructor(message?: string) {
    super(message ?? 'A step failed');
  }
}

/**
 * Deletes every `.webm` in one test point's folder except `keep`. The speed check opens an extra
 * tab in the same recorded context, so a point can hold more than one clip. Best effort: never throws.
 */
export async function removeVideosExcept(dir: string, keep?: string): Promise<void> {
  try {
    const keepPath = keep ? path.resolve(keep) : undefined;
    const names = await fs.readdir(dir);
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.webm')) continue;
      const full = path.resolve(dir, name);
      if (full === keepPath) continue;
      await fs.rm(full, { force: true }).catch(() => {});
    }
  } catch {
    // Missing folder or unreadable: nothing to clean.
  }
}
