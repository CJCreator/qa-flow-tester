import { describe, it, expect } from 'vitest';
import type { RunSummary } from '@qa/types';
import { hasFinishedCheckup } from '../src/lib/onboarding';

describe('developer shortcuts for first-time visitors', () => {
  it('hasFinishedCheckup is false for null and []', () => {
    expect(hasFinishedCheckup(null)).toBe(false);
    expect(hasFinishedCheckup(undefined)).toBe(false);
    expect(hasFinishedCheckup([])).toBe(false);
  });
  it('is true once there is one past check-up', () => {
    expect(hasFinishedCheckup([{ runId: 'r1', host: 'example.com' } as unknown as RunSummary])).toBe(true);
  });
});
