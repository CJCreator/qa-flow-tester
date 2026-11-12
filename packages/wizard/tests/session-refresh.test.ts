import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_CHANGED_EVENT, announceSessionChange } from '../src/lib/session-event';
import { endHelperSession, startHelperSession, type Fetch } from '../src/screens/audit/saved/helper-api';

function fakeFetch(reply: { status: number; body: unknown }): Fetch {
  return async () =>
    new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
}

describe('session-refresh event signaling', () => {
  let win: EventTarget;

  beforeEach(() => {
    win = new EventTarget();
    vi.stubGlobal('window', win);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('startHelperSession dispatches SESSION_CHANGED_EVENT on window when ok: true, but not when ok: false', async () => {
    const handler = vi.fn();
    win.addEventListener(SESSION_CHANGED_EVENT, handler);

    // Success outcome
    const successFetch = fakeFetch({
      status: 200,
      body: { email: 'helper@example.com', grants: [] },
    });
    const success = await startHelperSession('valid-token', successFetch);
    expect(success.ok).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    // Failure outcome
    const failFetch = fakeFetch({
      status: 401,
      body: { code: 'ERR_SIGN_IN_FAILED', error: 'Invalid token' },
    });
    const failure = await startHelperSession('invalid-token', failFetch);
    expect(failure.ok).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1); // still 1, not called again
  });

  it('endHelperSession dispatches SESSION_CHANGED_EVENT on window when ok: true, but not when ok: false', async () => {
    const handler = vi.fn();
    win.addEventListener(SESSION_CHANGED_EVENT, handler);

    // Success outcome
    const successFetch = fakeFetch({
      status: 200,
      body: { signedOut: true },
    });
    const success = await endHelperSession(successFetch);
    expect(success.ok).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    // Failure outcome
    const failFetch = fakeFetch({
      status: 500,
      body: { error: 'Server error' },
    });
    const failure = await endHelperSession(failFetch);
    expect(failure.ok).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1); // still 1, not called again
  });

  it('event listener cleans up without error', () => {
    const handler = vi.fn();
    win.addEventListener(SESSION_CHANGED_EVENT, handler);

    announceSessionChange();
    expect(handler).toHaveBeenCalledTimes(1);

    // Clean up listener
    expect(() => {
      win.removeEventListener(SESSION_CHANGED_EVENT, handler);
    }).not.toThrow();

    // Verify it no longer receives events
    announceSessionChange();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('announceSessionChange is safe when window is undefined', () => {
    vi.stubGlobal('window', undefined);
    expect(() => announceSessionChange(undefined)).not.toThrow();
  });
});
