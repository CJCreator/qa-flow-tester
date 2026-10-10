import { describe, expect, it } from 'vitest';
import { SIGN_IN_FAILURE_REASONS, signInReasonText } from '@qa/types/src/signin.js';
import { EMPTY_FORM, EMPTY_SIGN_IN, hasSignInDetails, signInConsentGiven, type CheckupForm } from '../src/lib/form';
import { initialFeed, reduceFeed } from '../src/lib/translate';

const filled = (patch: Partial<CheckupForm> = {}): CheckupForm => ({
  ...EMPTY_FORM,
  signIns: [{ ...EMPTY_SIGN_IN, username: 'a@b.c', password: 'pw' }],
  ...patch,
});

describe('sign-in consent in the form', () => {
  it('starts without consent and without reviewing first', () => {
    expect(EMPTY_FORM.signInConsent).toBe(false);
    expect(EMPTY_FORM.reviewFirst).toBe(false);
  });
  it('needs both username and password', () => {
    expect(hasSignInDetails(EMPTY_FORM)).toBe(false);
    expect(hasSignInDetails({ signIns: [{ ...EMPTY_SIGN_IN, username: 'a' }] })).toBe(false);
    expect(hasSignInDetails(filled())).toBe(true);
  });
  it('consent counts only when ticked and the details are there', () => {
    expect(signInConsentGiven(filled())).toBe(false);
    expect(signInConsentGiven(filled({ signInConsent: true }))).toBe(true);
    expect(signInConsentGiven({ ...EMPTY_FORM, signInConsent: true })).toBe(false);
  });
});

describe('a failed sign-in in the live feed', () => {
  it('shows the fixed wording for each reason, never the raw error', () => {
    for (const reason of SIGN_IN_FAILURE_REASONS) {
      const next = reduceFeed(
        initialFeed('product'),
        { type: 'RUN_FAILED', error: 'raw error with secret-pw', signInReason: reason },
        'product'
      );
      expect(next.status).toBe('failed');
      expect(next.failure).toBe(signInReasonText(reason));
    }
  });
  it('falls back to the usual wording without a known reason', () => {
    const next = reduceFeed(initialFeed('product'), { type: 'RUN_FAILED', error: 'ECONNREFUSED', signInReason: 'bogus' }, 'product');
    expect(next.failure).toMatch(/couldn’t be reached/);
  });
});
