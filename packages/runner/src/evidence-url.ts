import path from 'path';
import { isInside } from '@qa/core';

/**
 * The address (`/api/evidence/...`) of a file a report points at. An absolute path must be inside the output
 * folder; a relative path is relative to the run's own folder (`runs/<runId>/`), as saved reports store it.
 * Undefined when there is no path, or it leaves the output folder.
 */
export function evidenceUrl(outputDir: string, runId: string, file: string | undefined): string | undefined {
  if (!file) return undefined;
  let rel: string;
  if (path.isAbsolute(file)) {
    if (!isInside(outputDir, file)) return undefined;
    rel = path.relative(outputDir, file);
  } else {
    rel = `runs/${runId}/${file}`;
  }
  const parts = rel.split(/[\\/]+/).filter((part) => part !== '');
  if (parts.some((part) => part === '..' || part === '.')) return undefined;
  return `/api/evidence/${parts.map(encodeURIComponent).join('/')}`;
}
