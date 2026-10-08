import { describe, it, expect } from 'vitest';
import { computeStructuralFingerprint, findingFingerprint } from '../src/fingerprint.js';
import { isActiveFinding } from '../src/findings-contract.js';
import type { Finding } from '../src/index.js';

type FpInput = Pick<Finding, 'checker' | 'title' | 'where'>;

const base: FpInput = {
  checker: 'bug-detection',
  title: 'Button does nothing',
  where: { urlPath: '/checkout', role: 'admin', breakpoint: '1440px', cssSelector: '#pay' },
};

describe('findingFingerprint', () => {
  it('findingFingerprint ignores runId, timestamp, host and breakpoint', () => {
    const a = findingFingerprint(base, 'shop');
    const other = {
      ...base,
      runId: 'run-2',
      timestamp: '2030-01-01',
      where: { ...base.where, urlPath: 'http://other-host:9999/checkout?x=1', breakpoint: '375px', role: 'guest' },
    } as unknown as FpInput;
    expect(findingFingerprint(other, 'shop')).toBe(a);
    expect(a).toMatch(/^fp_[0-9a-f]{16}$/);
  });

  it('findingFingerprint equals computeStructuralFingerprint with title as ruleCode and cssSelector over dataTestId', () => {
    const f: FpInput = { ...base, where: { ...base.where, dataTestId: 'pay-btn' } };
    expect(findingFingerprint(f, 'shop')).toBe(
      computeStructuralFingerprint({
        productId: 'shop',
        route: '/checkout',
        checkerId: 'bug-detection',
        ruleCode: 'Button does nothing',
        selector: '#pay',
      })
    );
  });

  it('findingFingerprint differs when title, route, checker or selector differ', () => {
    const a = findingFingerprint(base, 'shop');
    expect(findingFingerprint({ ...base, title: 'Other' }, 'shop')).not.toBe(a);
    expect(findingFingerprint({ ...base, where: { ...base.where, urlPath: '/cart' } }, 'shop')).not.toBe(a);
    expect(findingFingerprint({ ...base, checker: 'security' }, 'shop')).not.toBe(a);
    expect(findingFingerprint({ ...base, where: { ...base.where, cssSelector: '#other' } }, 'shop')).not.toBe(a);
  });
});

describe('isActiveFinding', () => {
  it('isActiveFinding excludes needsConfirmation, Intended and False Positive', () => {
    expect(isActiveFinding({})).toBe(true);
    expect(isActiveFinding({ needsConfirmation: true })).toBe(false);
    expect(isActiveFinding({ triageStatus: 'Intended' })).toBe(false);
    expect(isActiveFinding({ triageStatus: 'False Positive' })).toBe(false);
  });
});
