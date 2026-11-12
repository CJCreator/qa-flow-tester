import path from 'path';

/** Is `file` strictly inside the folder `dir` (not the folder itself, not a sibling, not above it)? */
export function isInside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
