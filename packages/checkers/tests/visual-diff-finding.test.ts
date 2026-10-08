import { describe, it, expect } from 'vitest';
import { DesignStandardsChecker, type VisualDiffResult } from '../src/design-standards.js';

const checker = new DesignStandardsChecker();
const result: VisualDiffResult = {
  match: false,
  diffPercent: 0.05,
  diffPixels: 500,
  sizeMismatch: false,
  diffImagePath: '/out/visual-diff.png',
};
const base = { testCaseId: 'TC-1', role: 'guest', breakpoint: 'desktop' as const, urlPath: '/', baselinePath: 'b.png' };

describe('visual diff finding', () => {
  it('visual finding carries baseline and current paths when given', () => {
    const f = checker.visualDiffFinding(result, {
      ...base,
      baselineImagePath: '/out/visual-baseline.png',
      currentImagePath: '/out/visual-current.png',
    });
    expect(f.evidence).toEqual({
      screenshotPath: '/out/visual-diff.png',
      baselineScreenshotPath: '/out/visual-baseline.png',
      currentScreenshotPath: '/out/visual-current.png',
    });
  });

  it('visual finding evidence is only the diff path when none are given', () => {
    const f = checker.visualDiffFinding(result, base);
    expect(f.evidence).toEqual({ screenshotPath: '/out/visual-diff.png' });
    expect('baselineScreenshotPath' in f.evidence).toBe(false);
  });
});
