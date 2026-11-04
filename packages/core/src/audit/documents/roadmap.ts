/**
 * The Improvement Roadmap items (REQ-026, CONTEXT.md "Improvement Roadmap"): a Website Audit's ranked
 * findings turned into ordered work. It is never called a Plan: a Plan is what a Check-up run does.
 *
 * Fixed rules:
 * - One item per rule: every finding with the same `rule` goes into one item, which lists all of them and
 *   every page they are on. Each finding id is in exactly one item.
 * - Priority is the highest impact of the item's findings; effort is the highest effort of its findings.
 * - Items are ordered by priority (high, medium, low), then lower effort, then the rank of their first finding.
 * - Phase follows priority: high is phase 1, medium is phase 2, low is phase 3. So phases never go down
 *   along the list.
 *
 * Pure: no I/O, no clock.
 */

import type { AuditFinding, AuditScale, RoadmapItem } from '@qa/types';

/** Lower is more: high 0, medium 1, low 2. */
const RANK: Record<AuditScale, number> = { high: 0, medium: 1, low: 2 };

/** The phase an item of each priority goes in. */
export const ROADMAP_PHASE: Record<AuditScale, number> = { high: 1, medium: 2, low: 3 };

const highest = (a: AuditScale, b: AuditScale): AuditScale => (RANK[a] <= RANK[b] ? a : b);

interface Group {
  firstRank: number;
  title: string;
  priority: AuditScale;
  effort: AuditScale;
  findingIds: string[];
  pages: string[];
}

/**
 * The Improvement Roadmap for ranked findings (impact, then lower effort). The audit pipeline stores it as
 * `AuditResult.roadmap`. Empty findings give an empty roadmap. A repeated finding id is counted once.
 */
export function buildRoadmap(rankedFindings: readonly AuditFinding[]): RoadmapItem[] {
  const groups = new Map<string, Group>();
  const seen = new Set<string>();
  rankedFindings.forEach((finding, index) => {
    if (seen.has(finding.id)) return;
    seen.add(finding.id);
    let group = groups.get(finding.rule);
    if (!group) {
      group = {
        firstRank: index,
        // The first (highest ranked) finding names the item.
        title: finding.title,
        priority: finding.impact,
        effort: finding.effort,
        findingIds: [],
        pages: [],
      };
      groups.set(finding.rule, group);
    }
    group.priority = highest(group.priority, finding.impact);
    group.effort = highest(group.effort, finding.effort);
    group.findingIds.push(finding.id);
    for (const page of finding.pages && finding.pages.length > 0 ? finding.pages : [finding.urlPath]) {
      if (!group.pages.includes(page)) group.pages.push(page);
    }
  });

  return [...groups.values()]
    .sort(
      (a, b) =>
        RANK[a.priority] - RANK[b.priority] ||
        // Lower effort first: low (2) before high (0).
        RANK[b.effort] - RANK[a.effort] ||
        a.firstRank - b.firstRank,
    )
    .map((g, i) => ({
      id: `RM-${i + 1}`,
      title: g.title,
      priority: g.priority,
      phase: ROADMAP_PHASE[g.priority],
      effort: g.effort,
      findingIds: g.findingIds,
      pages: g.pages,
    }));
}
