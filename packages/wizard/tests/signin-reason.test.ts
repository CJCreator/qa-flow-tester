import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIGN_IN_FAILURE_REASONS, signInReasonText } from '@qa/types/src/signin.js';
import { addSiteSignIn, testSiteSignIn, RunnerError } from '../src/api';

function stubRunner(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status }))
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('sign-in failure reasons in the wizard', () => {
  it('shows plain words for each of the four reasons when testing a saved sign-in', async () => {
    for (const reason of SIGN_IN_FAILURE_REASONS) {
      stubRunner(200, { verified: false, reason, error: 'server text that should not be shown' });
      const r = await testSiteSignIn('example.com', 'member');
      expect(r.verified).toBe(false);
      expect(r.reason).toBe(reason);
      expect(r.error).toBe(signInReasonText(reason));
    }
  });

  it('shows plain words for each of the four reasons when adding a sign-in', async () => {
    for (const reason of SIGN_IN_FAILURE_REASONS) {
      stubRunner(422, { verified: false, reason, error: 'server text that should not be shown' });
      const failure = await addSiteSignIn('example.com', { role: 'member', username: 'u', password: 'p' }).catch(
        (e: unknown) => e
      );
      expect(failure).toBeInstanceOf(RunnerError);
      expect((failure as RunnerError).message).toBe(signInReasonText(reason));
    }
  });

  it('text never contains the typed username or password', async () => {
    const username = 'typed-user@example.com';
    const password = 'typed-secret-pw';
    stubRunner(422, { verified: false, reason: 'wrong-details', error: 'x' });
    const failure = await addSiteSignIn('example.com', { role: 'member', username, password }).catch((e: unknown) => e);
    const message = (failure as RunnerError).message;
    expect(message).not.toContain(username);
    expect(message).not.toContain(password);
    for (const reason of SIGN_IN_FAILURE_REASONS) {
      expect(signInReasonText(reason)).not.toContain(username);
      expect(signInReasonText(reason)).not.toContain(password);
    }
  });

  it('a success has no reason', async () => {
    stubRunner(200, { verified: true, saved: false, landingPath: '/account' });
    const r = await testSiteSignIn('example.com', 'member');
    expect(r).toMatchObject({ verified: true, landingPath: '/account' });
    expect(r.reason).toBeUndefined();
  });
});
