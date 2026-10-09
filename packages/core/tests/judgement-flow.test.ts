import { describe, it, expect } from 'vitest';
import { releaseVerdict } from '@qa/types';
import { calculateSiteAspectGrades } from '../src/scoring.js';
import { finding } from './helpers/issues-fixtures.js';

const real = finding({ id: 'F-REAL', severity: 'Minor', checker: 'design-standards', title: 'Small UI' });
const held = finding({
  id: 'F-HELD',
  severity: 'Blocker',
  checker: 'spec-conformance',
  title: 'Could not verify: ended elsewhere',
  needsConfirmation: true,
  needsJudgement: true,
});

describe('judgement items and the verdict', () => {
  it('release verdict and grades are identical with and without judgement items', () => {
    const without = [real];
    const withHeld = [real, held];
    // Only the "to confirm" tally may differ: it is how held items are announced.
    const { toConfirm: held1, ...a } = releaseVerdict(withHeld);
    const { toConfirm: held0, ...b } = releaseVerdict(without);
    expect(a).toEqual({ ...b, total: a.total });
    expect(a.ready).toBe(b.ready);
    expect(a.stamp).toBe(b.stamp);
    expect(a.counts).toEqual(b.counts);
    expect([held0, held1]).toEqual([0, 1]);
    expect(calculateSiteAspectGrades(withHeld)).toEqual(calculateSiteAspectGrades(without));
  });

  it('after accept it counts', () => {
    const accepted = { ...held, needsConfirmation: false, judgementAccepted: true };
    expect(releaseVerdict([real, accepted]).ready).toBe(false);
    expect(releaseVerdict([real, accepted]).counts.Blocker).toBe(1);
    expect(releaseVerdict([real, held]).counts.Blocker).toBe(0);
  });
});
