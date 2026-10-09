import { describe, it, expect } from 'vitest';
import { SIGN_IN_FAILURE_REASONS, signInReasonText, isSignInFailureReason } from '../src/signin.js';

describe('sign-in failure reasons', () => {
  it('has five reasons, each with plain words', () => {
    expect(SIGN_IN_FAILURE_REASONS).toHaveLength(5);
    for (const reason of SIGN_IN_FAILURE_REASONS) {
      const text = signInReasonText(reason);
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/[{}$<>]/);
    }
  });

  it('recognises only the four reasons', () => {
    expect(isSignInFailureReason('wrong-details')).toBe(true);
    expect(isSignInFailureReason('boom')).toBe(false);
    expect(isSignInFailureReason(undefined)).toBe(false);
  });
});
