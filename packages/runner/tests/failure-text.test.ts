import { describe, it, expect } from 'vitest';
import { failureText, RUN_FAILED_TEXT } from '../src/session/checkup-run.js';

describe('failureText: what a person sees when a run fails', () => {
  it('keeps the sentence of a typed ERR_ error', () => {
    const typed = Object.assign(new Error('Sign-in failed for admin: wrong password.'), { code: 'ERR_SIGN_IN_FAILED' });
    expect(failureText(typed, typed.message, RUN_FAILED_TEXT)).toBe('Sign-in failed for admin: wrong password.');
  });

  it('replaces internal errors, the browser-launch error and empty text with the fixed sentence', () => {
    const internal = new TypeError("Cannot read properties of undefined (reading 'click') at C:\\app\\x.js:12");
    expect(failureText(internal, internal.message, RUN_FAILED_TEXT)).toBe(RUN_FAILED_TEXT);
    const launch = Object.assign(new Error('spawn /usr/lib/chrome ENOENT'), { code: 'ERR_BROWSER_LAUNCH' });
    expect(failureText(launch, launch.message, RUN_FAILED_TEXT)).toBe(RUN_FAILED_TEXT);
    expect(failureText(Object.assign(new Error(''), { code: 'ERR_X' }), '', RUN_FAILED_TEXT)).toBe(RUN_FAILED_TEXT);
    expect(failureText(undefined, '', RUN_FAILED_TEXT)).toBe(RUN_FAILED_TEXT);
  });
});
