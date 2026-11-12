import { describe, it, expect } from 'vitest';
import { stableRuleCode, findingFingerprint } from '../src/fingerprint.js';
import type { Finding } from '../src/evidence-finding.js';

describe('stableRuleCode & findingFingerprint', () => {
  it('normalizes counts in finding titles', () => {
    expect(stableRuleCode('Page has multiple <h1> headings (5 found)')).toBe(
      stableRuleCode('Page has multiple <h1> headings (4 found)')
    );
  });

  it('normalizes quoted strings in finding titles', () => {
    expect(stableRuleCode('Expected text not found: "A"')).toBe(stableRuleCode('Expected text not found: "B"'));
  });

  it('does not collide across different rules', () => {
    expect(stableRuleCode('Missing title')).not.toBe(stableRuleCode('Missing description'));
  });

  it('produces identical fingerprints when ruleCode is identical even if titles differ in count', () => {
    const f1: Pick<Finding, 'checker' | 'title' | 'where' | 'ruleCode'> = {
      checker: 'seo',
      title: 'Page has multiple <h1> headings (5 found)',
      ruleCode: 'seo-multiple-h1',
      where: {
        urlPath: '/about',
        role: 'visitor',
        breakpoint: '1440px',
      },
    };

    const f2: Pick<Finding, 'checker' | 'title' | 'where' | 'ruleCode'> = {
      checker: 'seo',
      title: 'Page has multiple <h1> headings (4 found)',
      ruleCode: 'seo-multiple-h1',
      where: {
        urlPath: '/about',
        role: 'visitor',
        breakpoint: '1440px',
      },
    };

    expect(findingFingerprint(f1, 'prod-1')).toBe(findingFingerprint(f2, 'prod-1'));
  });

  it('falls back to stableRuleCode when ruleCode is missing and gives same fingerprint for count changes', () => {
    const f1: Pick<Finding, 'checker' | 'title' | 'where'> = {
      checker: 'seo',
      title: 'Page has multiple <h1> headings (5 found)',
      where: {
        urlPath: '/about',
        role: 'visitor',
        breakpoint: '1440px',
      },
    };

    const f2: Pick<Finding, 'checker' | 'title' | 'where'> = {
      checker: 'seo',
      title: 'Page has multiple <h1> headings (4 found)',
      where: {
        urlPath: '/about',
        role: 'visitor',
        breakpoint: '1440px',
      },
    };

    expect(findingFingerprint(f1, 'prod-1')).toBe(findingFingerprint(f2, 'prod-1'));
  });

  it('produces different fingerprints for different ruleCode', () => {
    const f1: Pick<Finding, 'checker' | 'title' | 'where' | 'ruleCode'> = {
      checker: 'spec-conformance',
      title: 'Form error',
      ruleCode: 'spec-refusal-accepted',
      where: {
        urlPath: '/contact',
        role: 'visitor',
        breakpoint: '1440px',
      },
    };

    const f2: Pick<Finding, 'checker' | 'title' | 'where' | 'ruleCode'> = {
      checker: 'spec-conformance',
      title: 'Form error',
      ruleCode: 'spec-refusal-wording',
      where: {
        urlPath: '/contact',
        role: 'visitor',
        breakpoint: '1440px',
      },
    };

    expect(findingFingerprint(f1, 'prod-1')).not.toBe(findingFingerprint(f2, 'prod-1'));
  });
});
