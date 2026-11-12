import { describe, it, expect } from 'vitest';
import { resolveTargetUrl, signInAccount, hasCompleteSignIn } from '../src/session/checkup-session.js';

describe('session helpers', () => {
  it('resolveTargetUrl maps a host alias', () => {
    expect(resolveTargetUrl('http://shop.test:3000/a', { 'shop.test': 'host.docker.internal' })).toBe(
      'http://host.docker.internal:3000/a'
    );
  });

  it('resolveTargetUrl maps localhost to the host machine when told to', () => {
    expect(resolveTargetUrl('http://localhost:3050/', {}, 'host.docker.internal')).toBe(
      'http://host.docker.internal:3050/'
    );
  });

  it('resolveTargetUrl leaves other addresses and bad input as typed', () => {
    expect(resolveTargetUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(resolveTargetUrl('not a url')).toBe('not a url');
  });

  it('signInAccount lower-cases the host', () => {
    expect(signInAccount('Shop.Test:3000', 'admin')).toBe('signin:shop.test:3000:admin');
  });

  it('hasCompleteSignIn needs a username and a password on one role', () => {
    expect(hasCompleteSignIn(undefined)).toBe(false);
    expect(hasCompleteSignIn([])).toBe(false);
    expect(hasCompleteSignIn([{ username: 'a' }])).toBe(false);
    expect(hasCompleteSignIn([{ username: 'a' }, { password: 'b' }])).toBe(false);
    expect(hasCompleteSignIn([{ username: 'a', password: 'b' }])).toBe(true);
  });
});
