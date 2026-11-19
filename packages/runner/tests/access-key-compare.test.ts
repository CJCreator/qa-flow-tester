/**
 * The access key is compared through SHA-256 digests with timingSafeEqual, so keys of any length take one code path.
 */
import { describe, it, expect } from 'vitest';
import { matchesSecret } from '../src/server.js';

describe('matchesSecret', () => {
  const secret = 'fake-access-key-for-tests-0123456789';

  it('accepts the exact key, ignoring surrounding whitespace', () => {
    expect(matchesSecret(secret, secret)).toBe(true);
    expect(matchesSecret(`  ${secret}\n`, secret)).toBe(true);
  });

  it('refuses a wrong key of the same length', () => {
    expect(matchesSecret('x'.repeat(secret.length), secret)).toBe(false);
  });

  it.each(['a', 'x'.repeat(secret.length - 1), secret + 'x', 'x'.repeat(5000)])(
    'refuses a key of a different length without throwing (%#)',
    (given) => {
      expect(matchesSecret(given, secret)).toBe(false);
    }
  );

  it('refuses a missing or empty key', () => {
    expect(matchesSecret(null, secret)).toBe(false);
    expect(matchesSecret(undefined, secret)).toBe(false);
    expect(matchesSecret('', secret)).toBe(false);
  });
});
