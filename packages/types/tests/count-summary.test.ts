import { describe, it, expect } from 'vitest';
import { countBreakdown, countSummary } from '../src/count-summary.js';
import { releaseVerdict } from '../src/verdict.js';
import type { Finding } from '../src/index.js';

type F = Pick<Finding, 'severity' | 'triageStatus' | 'needsConfirmation' | 'title'> & Partial<Finding>;

const finding = (title: string, extra: Partial<Finding> = {}): F => ({
  id: title,
  title,
  severity: 'Minor',
  checker: 'bug-detection',
  triageStatus: 'Open',
  needsConfirmation: false,
  where: { urlPath: '/', role: 'visitor', breakpoint: '1440px' },
  ...extra,
});

// Merged findings, as a report holds them: one per problem and place, with occurrences.
const FINDINGS: F[] = [
  finding('Step failed: "Sign in"', { severity: 'Blocker', issueKey: 'bug|sign-in', occurrences: 3 }),
  finding('Step failed: "Sign in"', {
    severity: 'Major',
    issueKey: 'bug|sign-in',
    where: { urlPath: '/login', role: 'visitor', breakpoint: '375px' },
  }),
  finding('Dead End Page', { issueKey: 'bug|dead-end', occurrences: 2 }),
  finding('Console Error', { issueKey: 'bug|console', triageStatus: 'Intended' }),
  finding('Console Error 2', { issueKey: 'bug|console2', triageStatus: 'False Positive' }),
  finding('[AI Review] Hero text is hard to read', { checker: 'ai-review', issueKey: 'ai|hero' }),
  finding('Spacing looks off', { checker: 'design-standards', advisory: true, issueKey: 'design|spacing' }),
  finding('Expected a cart total', { needsConfirmation: true, issueKey: 'spec|cart', occurrences: 3 }),
];

describe('countSummary (T-389)', () => {
  it('counts raw, merged, dismissed, AI notes, to confirm and problems', () => {
    expect(countSummary(FINDINGS)).toEqual({
      raw: 3 + 1 + 2 + 1 + 1 + 1 + 1 + 3,
      merged: 8,
      dismissed: 2,
      advisory: 2,
      toConfirm: 1,
      problems: 2,
      findings: 3,
    });
  });

  it('gives the same numbers as releaseVerdict for one set of findings', () => {
    const summary = countSummary(FINDINGS);
    const verdict = releaseVerdict(FINDINGS);
    expect(verdict.total).toBe(summary.problems);
    expect(verdict.toConfirm).toBe(summary.toConfirm);
    expect(verdict.findings).toBe(summary.findings);
    expect(Object.values(verdict.counts).reduce((a, b) => a + b, 0)).toBe(summary.problems);
  });

  it('nothing found: all zero', () => {
    expect(countSummary([])).toEqual({
      raw: 0,
      merged: 0,
      dismissed: 0,
      advisory: 0,
      toConfirm: 0,
      problems: 0,
      findings: 0,
    });
    expect(countSummary(null).problems).toBe(releaseVerdict(null).total);
  });

  it('writes the breakdown line, live and final', () => {
    const s = { raw: 142, merged: 61, dismissed: 9, advisory: 4, toConfirm: 3, problems: 45, findings: 45 };
    expect(countBreakdown(s)).toBe('142 raw → 61 merged → 9 dismissed, 4 AI notes, 3 to confirm → 45');
    expect(countBreakdown(s, { live: true })).toBe(
      '142 raw → 61 merged → dismissed after the run, 4 AI notes, 3 to confirm → 45'
    );
  });
});
