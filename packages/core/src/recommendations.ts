import type { AspectType, Finding, FindingSeverity, RankedRecommendation } from '@qa/types';
import { aspectOfFinding, problemKey, SEVERITY_ORDER } from '@qa/types';

interface EffortImpactMapping {
  category: 'quick-win' | 'bigger-change';
  effort: 'Low' | 'Medium' | 'High';
  impact: 'Low' | 'Medium' | 'High';
  suggestedFix: string;
}

const EFFORT_ORDER = { Low: 0, Medium: 1, High: 2 };

function classifyFinding(finding: Finding): EffortImpactMapping {
  const title = finding.title.toLowerCase();

  // Quick wins: headers, metadata, simple attributes, cookie flags, small fixes
  if (
    title.includes('header') ||
    title.includes('meta description') ||
    title.includes('title tag') ||
    title.includes('lang attribute') ||
    title.includes('cookie') ||
    title.includes('opengraph') ||
    title.includes('touch') ||
    title.includes('alt')
  ) {
    return {
      category: 'quick-win',
      effort: 'Low',
      impact: finding.severity === 'Major' || finding.severity === 'Blocker' ? 'High' : 'Medium',
      suggestedFix: finding.resolution,
    };
  }

  // Bigger changes: form restructuring, responsive refactors, slow performance, overlapping controls
  if (
    title.includes('form sends passwords') ||
    title.includes('overflows the screen') ||
    title.includes('overlap') ||
    title.includes('largest contentful paint') ||
    title.includes('broken link') ||
    title.includes('dead end')
  ) {
    return {
      category: 'bigger-change',
      effort: 'Medium',
      impact: 'High',
      suggestedFix: finding.resolution,
    };
  }

  // Default mapping
  const isHighSeverity = finding.severity === 'Blocker' || finding.severity === 'Major';
  return {
    category: isHighSeverity ? 'bigger-change' : 'quick-win',
    effort: isHighSeverity ? 'Medium' : 'Low',
    impact: isHighSeverity ? 'High' : 'Medium',
    suggestedFix: finding.resolution,
  };
}

/** Recommendations from one area among the top ones, so one noisy area can't crowd out the rest. */
const PER_ASPECT_IN_TOP = 2;
const TOP = 5;

/**
 * Groups findings into recommendations, one per problem (see problemKey), ranked by what matters
 * most: how serious it is first, so a Blocker always leads; then how many pages it's on; then the
 * least effort. Among the first five, no area has more than two, so the most serious problem of
 * each area gets seen.
 */
export function generateRankedRecommendations(findings: Finding[]): RankedRecommendation[] {
  const activeFindings = findings.filter(
    (f) => !f.needsConfirmation && f.triageStatus !== 'False Positive' && f.triageStatus !== 'Intended'
  );

  const grouped = new Map<
    string,
    {
      title: string;
      aspect: AspectType;
      severity: FindingSeverity;
      pages: Set<string>;
      findingIds: string[];
      screenshotPath?: string;
      summary: string;
      classification: EffortImpactMapping;
    }
  >();

  for (const f of activeFindings) {
    const key = problemKey(f);
    const entry = grouped.get(key);
    if (!entry) {
      grouped.set(key, {
        title: f.title,
        aspect: aspectOfFinding(f),
        severity: f.severity,
        pages: new Set([f.where.urlPath]),
        findingIds: [f.id],
        screenshotPath: f.evidence?.screenshotPath,
        summary: f.expectedVsActual?.actual || f.title,
        classification: classifyFinding(f),
      });
      continue;
    }
    entry.pages.add(f.where.urlPath);
    entry.findingIds.push(f.id);
    entry.screenshotPath ??= f.evidence?.screenshotPath;
    if (SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(entry.severity)) {
      entry.severity = f.severity;
      entry.classification = classifyFinding(f);
    }
  }

  const ranked = [...grouped.values()].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      b.pages.size - a.pages.size ||
      EFFORT_ORDER[a.classification.effort] - EFFORT_ORDER[b.classification.effort] ||
      a.title.localeCompare(b.title)
  );

  // The top five: in rank order, at most two per area while other areas have something to show.
  const top: typeof ranked = [];
  const rest: typeof ranked = [];
  const perAspect = new Map<AspectType, number>();
  for (const item of ranked) {
    const n = perAspect.get(item.aspect) ?? 0;
    if (top.length < TOP && (n < PER_ASPECT_IN_TOP || item.severity === 'Blocker')) {
      top.push(item);
      perAspect.set(item.aspect, n + 1);
    } else rest.push(item);
  }
  // Too few areas to fill the top five: the next ones in rank order fill it.
  while (top.length < TOP && rest.length > 0) top.push(rest.shift()!);

  return [...top, ...rest].map((item, i) => ({
    id: `REC-${String(i + 1).padStart(3, '0')}`,
    category: item.classification.category,
    title: item.title,
    aspect: item.aspect,
    severity: item.severity,
    effort: item.classification.effort,
    impact: item.classification.impact,
    affectedPages: Array.from(item.pages),
    findingIds: item.findingIds,
    screenshotPath: item.screenshotPath,
    summary: item.summary,
    suggestedFix: item.classification.suggestedFix,
  }));
}
