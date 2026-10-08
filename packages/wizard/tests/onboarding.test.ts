import { describe, it, expect } from 'vitest';
import type { RunSummary } from '@qa/types';
import { EMPTY_FORM, EMPTY_SIGN_IN, type CheckupForm } from '../src/lib/form';
import { hasFinishedCheckup, hasNonDefaultOptions } from '../src/lib/onboarding';

const changed = (patch: Partial<CheckupForm>): CheckupForm => ({ ...EMPTY_FORM, ...patch });

describe('More options on the new check-up screen', () => {
  it('hasNonDefaultOptions is false for EMPTY_FORM', () => {
    expect(hasNonDefaultOptions(EMPTY_FORM)).toBe(false);
  });
  it('is false for an address alone and for blank text', () => {
    expect(hasNonDefaultOptions(changed({ address: 'shop.example.com', specs: '  ', journeys: '\n' }))).toBe(false);
    expect(hasNonDefaultOptions(changed({ signIns: [{ ...EMPTY_SIGN_IN }] }))).toBe(false);
  });
  it('is true for each changed field', () => {
    expect(hasNonDefaultOptions(changed({ maxPages: 20 }))).toBe(true);
    expect(hasNonDefaultOptions(changed({ signIns: [{ ...EMPTY_SIGN_IN, username: 'a@b.c' }] }))).toBe(true);
    expect(hasNonDefaultOptions(changed({ signIns: [{ ...EMPTY_SIGN_IN, password: 'x' }] }))).toBe(true);
    expect(hasNonDefaultOptions(changed({ specs: 'Only managers see reports' }))).toBe(true);
    expect(hasNonDefaultOptions(changed({ designNotes: 'Blue' }))).toBe(true);
    expect(hasNonDefaultOptions(changed({ journeys: 'Sign in' }))).toBe(true);
    expect(hasNonDefaultOptions(changed({ searchChecks: false }))).toBe(true);
    expect(
      hasNonDefaultOptions(changed({ visibility: { search: true, answers: false, aiSearch: true, marketing: true } }))
    ).toBe(true);
  });
});

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
