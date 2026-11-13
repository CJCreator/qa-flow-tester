import { createHash } from 'node:crypto';

/** File-name-safe text: letters, digits, `_` and `-` only. */
function safe(text: string): string {
  return text.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

/**
 * The file name (without `.png`) of a visual baseline: the site, the Plan Item and the role, so a baseline is
 * never compared with another site, nor with another page after a re-plan reordered the ids.
 * Only `[A-Za-z0-9_-]` is used, so the runner's existing id check (`/^[\w-]+$/`) still accepts it.
 */
export function baselineKey(args: {
  targetUrl: string;
  planItemId?: string;
  testCaseId: string;
  role: string;
}): string {
  const host = safe(new URL(args.targetUrl).host.toLowerCase());
  const item = args.planItemId ?? args.testCaseId;
  const hash = createHash('sha1').update(item).digest('hex').slice(0, 8);
  return `${host}__${safe(item).slice(0, 60)}-${hash}-${safe(args.role)}`;
}
