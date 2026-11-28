import path from 'node:path';

/**
 * Is `child` strictly inside the folder `parent` (not the folder itself, not a sibling, not above it)?
 * Pure path maths: no symlink lookups. A name that merely starts with two dots ("..notes") is inside;
 * only a real ".." step, an absolute result (another drive on Windows) or the folder itself is not.
 */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

/** `rel` resolved against `root`, or null when the result is not strictly inside `root`. */
export function resolveInside(root: string, rel: string): string | null {
  const abs = path.resolve(root, rel);
  return isInside(root, abs) ? abs : null;
}
