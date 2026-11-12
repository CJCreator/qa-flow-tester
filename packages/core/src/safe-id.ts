import path from 'node:path';

/** Letters, digits, `_` and `-` only (anything else becomes `_`), at most 80 characters: a file name part on every system. */
export function safeIdPart(text: string): string {
  return text.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || '_';
}

/** `dir/name` resolved, when it stays inside `dir`; throws otherwise. */
export function pathInside(dir: string, name: string): string {
  const root = path.resolve(dir);
  const full = path.resolve(root, name);
  const rel = path.relative(root, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('A test file name would leave its folder.');
  return full;
}

/** One Test point's evidence folder: always a direct child of `evidenceDir`. */
export function testPointDir(evidenceDir: string, testCaseId: string, breakpoint: string): string {
  return pathInside(evidenceDir, `${safeIdPart(testCaseId)}-${safeIdPart(breakpoint)}`);
}
