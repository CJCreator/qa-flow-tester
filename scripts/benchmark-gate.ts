/**
 * Pure helpers for the planted-defect benchmark (scripts/benchmark.ts): rates, threshold check,
 * summary text. No runner or browser imports, so a unit test can load it.
 */

export interface RateInput {
  reported: number;
  real: number;
  plantedFound: number;
  plantedMissed: number;
}

export interface Thresholds {
  sites: Record<string, { minDetectionRate?: number; maxFalsePositiveRate?: number }>;
}

export interface GateScore extends RateInput {
  site: string;
  error?: string;
  plantedMissedIds?: string[];
}

export interface SummaryRow extends GateScore {
  name?: string;
  pagesReached?: number;
  minutes?: number;
  detectionRate: number | null;
  falsePositiveRate: number | null;
  unlabelled?: string[];
}

/** Planted found over planted due. Null when nothing was due. */
export function detectionRate(i: RateInput): number | null {
  const due = i.plantedFound + i.plantedMissed;
  return due === 0 ? null : i.plantedFound / due;
}

/** One minus real over reported (same as unlabelled plus known false, over reported). Null when nothing was reported. */
export function falsePositiveRate(i: RateInput): number | null {
  return i.reported === 0 ? null : 1 - i.real / i.reported;
}

export function round3(n: number | null): number | null {
  return n === null ? null : Math.round(n * 1000) / 1000;
}

const show = (n: number | null) => (n === null ? 'n/a' : String(round3(n)));

/** Only sites with an entry in the thresholds are gated. A site error fails a gated site and warns for the rest. */
export function checkThresholds(scores: GateScore[], t: Thresholds): { failures: string[]; warnings: string[] } {
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const s of scores) {
    const limit = t.sites[s.site];
    if (s.error) {
      if (limit) failures.push(`${s.site}: the run did not finish: ${s.error}`);
      else warnings.push(`${s.site}: the run did not finish: ${s.error}`);
      continue;
    }
    if (!limit) continue;
    const missed = s.plantedMissedIds?.length ? ` (missed: ${s.plantedMissedIds.join(', ')})` : '';
    if (limit.minDetectionRate !== undefined) {
      const d = detectionRate(s);
      if (d === null) failures.push(`${s.site}: no data for the detection rate (no planted defects were due)`);
      else if (d < limit.minDetectionRate)
        failures.push(`${s.site}: detection rate ${show(d)} is below the minimum ${limit.minDetectionRate}${missed}`);
    }
    if (limit.maxFalsePositiveRate !== undefined) {
      const f = falsePositiveRate(s);
      if (f === null) failures.push(`${s.site}: no data for the false positive rate (no issues were reported)`);
      else if (f > limit.maxFalsePositiveRate)
        failures.push(`${s.site}: false positive rate ${show(f)} is above the maximum ${limit.maxFalsePositiveRate}`);
    }
  }
  return { failures, warnings };
}

export function renderSummary(rows: SummaryRow[], failures: string[], warnings: string[]): string {
  const failedSites = new Set(failures.map((f) => f.split(':')[0]));
  const lines = [
    '# Planted-defect benchmark',
    '',
    '| Site | Pages | Reported | Real | False positive rate | Planted found | Detection rate | Minutes | Result |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const due = r.plantedFound + r.plantedMissed;
    const result = r.error ? 'error' : failedSites.has(r.site) ? 'fail' : 'ok';
    lines.push(
      `| ${r.site} | ${r.pagesReached ?? 0} | ${r.reported} | ${r.real} | ${show(r.falsePositiveRate)} | ${r.plantedFound}/${due} | ${show(r.detectionRate)} | ${(r.minutes ?? 0).toFixed(1)} | ${result} |`
    );
  }
  lines.push('');
  if (failures.length) lines.push('## Failures', '', ...failures.map((f) => `- ${f}`), '');
  if (warnings.length) lines.push('## Warnings', '', ...warnings.map((w) => `- ${w}`), '');
  if (!failures.length) lines.push('All thresholds met.', '');
  for (const r of rows) {
    if (r.plantedMissedIds?.length) lines.push(`Missed on ${r.site}: ${r.plantedMissedIds.join(', ')}`, '');
    if (r.unlabelled?.length) {
      lines.push(`Unlabelled on ${r.site} (counted as not real):`, '', ...r.unlabelled.map((u) => `- ${u}`), '');
    }
  }
  return lines.join('\n');
}
