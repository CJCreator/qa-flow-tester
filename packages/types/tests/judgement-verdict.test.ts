import { describe, it, expect } from 'vitest';
import { countsTowardVerdict } from '../src/verdict.js';
import { isActiveFinding } from '../src/findings-contract.js';

describe('judgement items stay out of the verdict until accepted', () => {
  const held = { needsConfirmation: true, needsJudgement: true } as const;
  it('does not count while held', () => {
    expect(countsTowardVerdict(held)).toBe(false);
    expect(isActiveFinding(held)).toBe(false);
  });
  it('counts after accept (needsConfirmation cleared)', () => {
    const accepted = { needsConfirmation: false, needsJudgement: true, judgementAccepted: true };
    expect(countsTowardVerdict(accepted)).toBe(true);
    expect(isActiveFinding(accepted)).toBe(true);
  });
});
