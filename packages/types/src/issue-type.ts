/**
 * Issue types for the issues document (ADR 0020). Browser-safe: the wizard imports this file directly.
 * A finding belongs to exactly one type; the order here is the order the document lists them.
 */
import type { Finding } from './evidence-finding.js';
import type { PlanIntent } from './plan.js';

export const ISSUE_TYPES = [
  'UI/UX',
  'Logical flow',
  'Broken flow',
  'Access',
  'Accessibility',
  'Security',
  'Performance',
  'Other',
] as const;

export type IssueType = (typeof ISSUE_TYPES)[number];

type IssueTypeInput = Pick<Finding, 'checker'> &
  Partial<Pick<Finding, 'needsJudgement' | 'aspect' | 'categoryTag' | 'issueKey' | 'title'>> & {
    intent?: PlanIntent;
  };

/** Which issue type a finding is listed under. Judgement items and spec mismatches are Logical flow. */
export function issueTypeOf(f: IssueTypeInput): IssueType {
  if (f.needsJudgement) return 'Logical flow';
  if (f.intent === 'denied') return 'Access';
  if (f.categoryTag) return 'Other';
  switch (f.checker) {
    case 'spec-conformance':
      return 'Logical flow';
    case 'permission-matrix':
      return 'Access';
    case 'security':
      return 'Security';
    case 'performance':
      return 'Performance';
    case 'design-standards':
      return 'UI/UX';
    case 'ux-quality':
      // ux-quality findings count toward the Accessible area unless they name another one
      // (a touch target is about phones): only those others are UI/UX.
      return f.aspect === undefined || f.aspect === 'Accessible' ? 'Accessibility' : 'UI/UX';
    case 'seo':
      return 'Other';
    case 'bug-detection':
      return f.aspect === 'Accessible' ? 'Accessibility' : 'Broken flow';
    default:
      return f.aspect === 'Accessible' ? 'Accessibility' : f.aspect === 'Looks and reads well' ? 'UI/UX' : 'Other';
  }
}
