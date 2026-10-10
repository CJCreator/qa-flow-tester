import { describe, expect, it } from 'vitest';
import { SIGN_IN_FAILURE_REASONS, signInReasonText } from '@qa/types/src/signin.js';
import {
  afterStart,
  consentRequestOf,
  EMPTY_FORM,
  EMPTY_SIGN_IN,
  hasSignInDetails,
  lookOnly,
  settleConsent,
  signInConsentGiven,
  withAddress,
  type CheckupForm,
} from '../src/lib/form';
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

const hostFor = (a: string) => (a.trim() ? a.replace(/^https?:\/\//, '').split('/')[0] : null);
const consented = (patch: Partial<CheckupForm> = {}) =>
  filled({ address: 'a.example.com', signInConsent: true, reviewFirst: true, ...patch });

describe('consent cannot go stale or leak', () => {
  it('a host change resets consent and plan-first; a path change keeps them', () => {
    const moved = withAddress(consented(), 'b.example.com', hostFor);
    expect(moved.signInConsent).toBe(false);
    expect(moved.reviewFirst).toBe(false);
    expect(withAddress(consented(), 'a.example.com/pricing', hostFor).signInConsent).toBe(true);
  });
  it('emptying the username or password resets consent', () => {
    const noPassword = filled({ signInConsent: true, signIns: [{ ...EMPTY_SIGN_IN, username: 'a@b.c' }] });
    expect(settleConsent(noPassword).signInConsent).toBe(false);
    expect(settleConsent(consented()).signInConsent).toBe(true);
  });
  it('a second role alone does not keep the notice or the consent', () => {
    const second = consented({ signIns: [{ ...EMPTY_SIGN_IN }, { ...EMPTY_SIGN_IN, role: 'admin', username: 'x', password: 'y' }] });
    expect(hasSignInDetails(second)).toBe(false);
    expect(settleConsent(second).signInConsent).toBe(false);
  });
  it('never sends stagingHost under consent, even for a marked test copy', () => {
    const req = consentRequestOf(consented({ markedTestCopy: true }), true);
    expect(req.signInConsent).toBe(true);
    expect(req.owner).toBe(true);
    expect(req.stagingHost).toBeUndefined();
  });
  it('keeps stagingHost without consent', () => {
    expect(consentRequestOf(filled({ owner: true, markedTestCopy: true }), true).stagingHost).toBe(true);
  });
  it('is reset after a run starts', () => {
    const next = afterStart(consented({ rememberTouched: true }));
    expect(next.signInConsent).toBe(false);
    expect(next.reviewFirst).toBe(false);
    expect(next.rememberTouched).toBe(false);
  });
  it('"Only look at it" clears consent and the quick fields, keeps a second role', () => {
    const second = { ...EMPTY_SIGN_IN, role: 'admin', username: 'x', password: 'y' };
    const next = lookOnly(consented({ signIns: [{ ...EMPTY_SIGN_IN, username: 'a', password: 'b' }, second] }));
    expect(next.signInConsent).toBe(false);
    expect(next.signIns[0]).toMatchObject({ username: '', password: '' });
    expect(next.signIns[1]).toEqual(second);
    expect(consentRequestOf(next, undefined).owner).toBe(false);
  });
  it('stores the password in the keychain under consent only when remember was ticked', () => {
    expect(consentRequestOf(consented(), undefined).rememberSignIns).toBe(false);
    expect(consentRequestOf(consented({ rememberTouched: true }), undefined).rememberSignIns).toBe(true);
    expect(consentRequestOf(consented({ rememberTouched: true, rememberSignIns: false }), undefined).rememberSignIns).toBe(false);
    expect(consentRequestOf(filled(), undefined).rememberSignIns).toBe(true);
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
