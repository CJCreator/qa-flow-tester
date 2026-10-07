import type { PageCoverage, PageInventoryItem, PlanLayoutGroup } from '@qa/types';
import { pathOf } from './site-graph.js';

/** Sample Pages tested on behalf of a Layout Group. */
export const SAMPLES_PER_GROUP = 3;

/**
 * An address with the parts that name one item replaced by "*": /products/blue-cotton-shirt-12
 * becomes /products/*. A part names an item when it has a digit, is long, or is a slug of three or
 * more words. Addresses with no such part (/about, /pricing) are pages in their own right.
 */
export function itemShape(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) =>
      seg && (/\d/.test(seg) || seg.length > 24 || /^[a-z0-9]+(?:[-_][a-z0-9]+){2,}$/i.test(seg)) ? '*' : seg
    )
    .join('/');
}

export interface PageCoverageInfo {
  coverage: PageCoverage;
  coveredBy?: string[];
  layoutGroup?: string;
}

/**
 * Groups pages built from one template at addresses that differ only by the item they show, and
 * picks Sample Pages for groups of more than three. Pages with a fixed address are always tested:
 * sharing a layout doesn't make /about and /pricing the same page.
 */
export function sampleLayoutGroups(pages: PageInventoryItem[]): {
  groups: PlanLayoutGroup[];
  coverage: Map<string, PageCoverageInfo>;
} {
  const byKey = new Map<string, PageInventoryItem[]>();
  for (const page of pages) {
    const shape = itemShape(pathOf(page.urlPath));
    if (!page.layoutGroup || !shape.includes('*')) continue;
    const key = `${page.layoutGroup}|${shape}`;
    byKey.set(key, [...(byKey.get(key) ?? []), page]);
  }

  const groups: PlanLayoutGroup[] = [];
  const coverage = new Map<string, PageCoverageInfo>();
  for (const page of pages) coverage.set(page.urlPath, { coverage: 'tested' });

  let n = 0;
  for (const [key, members] of byKey) {
    if (members.length < 2) continue;
    const id = `group-${++n}`;
    const shape = key.slice(key.indexOf('|') + 1);
    const paths = members.map((p) => p.urlPath);
    // Spread across the group (first, middle, last found) rather than three neighbours.
    const samples =
      members.length > SAMPLES_PER_GROUP
        ? [...new Set([0, Math.floor((members.length - 1) / 2), members.length - 1].map((i) => paths[i]))]
        : paths;
    groups.push({ id, name: `Pages like ${shape.replace(/\*/g, '…')}`, pages: paths, samples });
    for (const path of paths) {
      coverage.set(path, {
        coverage: members.length <= SAMPLES_PER_GROUP ? 'tested' : samples.includes(path) ? 'sample' : 'covered',
        coveredBy: members.length > SAMPLES_PER_GROUP && !samples.includes(path) ? samples : undefined,
        layoutGroup: id,
      });
    }
  }
  return { groups, coverage };
}
