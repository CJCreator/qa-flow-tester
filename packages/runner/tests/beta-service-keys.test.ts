import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { OsKeychainStore } from '@qa/core';
import { SessionKeyResolver, enterSession, sessionFor } from '../src/beta.js';

// REQ-012 / ADR 0034: a beta visitor's service keys live in their session only, and the owner's
// PAGESPEED_API_KEY is never used for them.
const SAVED = 'visitor-pagespeed-key-0123456789';

/** A new beta session, as sessionFor makes one for a first visit. */
function newSession(address: string): string {
  const headers: Record<string, unknown> = {};
  const req = { headers: {}, socket: { remoteAddress: address } };
  const res = {
    getHeader: (name: string) => headers[name],
    setHeader: (name: string, value: unknown) => {
      headers[name] = value;
    },
  };
  return sessionFor(req as never, res as never, false);
}

/** Runs fn as part of that session, without the session leaking into the test's own context. */
function inSession<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) =>
    setImmediate(() => {
      enterSession(sessionId);
      fn().then(resolve, reject);
    })
  );
}

describe('SessionKeyResolver service keys (beta)', () => {
  let savedEnv: string | undefined;
  let writes: ReturnType<typeof vi.fn>[];
  let keychain: ReturnType<typeof vi.spyOn>[];

  beforeEach(() => {
    savedEnv = process.env.PAGESPEED_API_KEY;
    process.env.PAGESPEED_API_KEY = 'owner-pagespeed-key-from-env';
    writes = [
      vi.spyOn(fs, 'writeFile'),
      vi.spyOn(fs, 'rename'),
      vi.spyOn(fs, 'mkdir'),
      vi.spyOn(fs, 'appendFile'),
    ] as never;
    keychain = [
      vi.spyOn(OsKeychainStore.prototype, 'get'),
      vi.spyOn(OsKeychainStore.prototype, 'set'),
    ] as never;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedEnv === undefined) delete process.env.PAGESPEED_API_KEY;
    else process.env.PAGESPEED_API_KEY = savedEnv;
  });

  const expectNothingWritten = () => {
    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
    for (const spy of keychain) expect(spy).not.toHaveBeenCalled();
  };

  it('outside a session, saving a service key throws and writes nothing', async () => {
    const keys = new SessionKeyResolver();
    await expect(keys.saveServiceKey('pagespeed', SAVED)).rejects.toThrow(/No session/);
    await expect(keys.removeServiceKey('pagespeed')).rejects.toThrow(/No session/);
    expect(await keys.resolveServiceKey('pagespeed')).toBeNull();
    expectNothingWritten();
  });

  it('a session that was forgotten (unknown id) cannot save either', async () => {
    const keys = new SessionKeyResolver();
    await expect(inSession('no-such-session', () => keys.saveServiceKey('pagespeed', SAVED))).rejects.toThrow(
      /No session/
    );
    expectNothingWritten();
  });

  it('with no saved PageSpeed key, the owner PAGESPEED_API_KEY is not used', async () => {
    const keys = new SessionKeyResolver();
    const id = newSession('198.51.100.21');
    expect(await inSession(id, () => keys.resolveServiceKey('pagespeed'))).toBeNull();
    expectNothingWritten();
  });

  it('a saved key resolves in its own session only and writes no file', async () => {
    const keys = new SessionKeyResolver();
    const mine = newSession('198.51.100.22');
    const theirs = newSession('198.51.100.23');

    expect(await inSession(mine, () => keys.saveServiceKey('pagespeed', `  ${SAVED}  `))).toBe('keychain');
    expect(await inSession(mine, () => keys.resolveServiceKey('pagespeed'))).toEqual({
      service: 'pagespeed',
      apiKey: SAVED,
      source: 'keychain',
    });
    // Another resolver instance in the same session sees it too: it lives in the session, not the object.
    expect((await inSession(mine, () => new SessionKeyResolver().resolveServiceKey('pagespeed')))?.apiKey).toBe(
      SAVED
    );

    expect(await inSession(theirs, () => keys.resolveServiceKey('pagespeed'))).toBeNull();
    expect(await keys.resolveServiceKey('pagespeed')).toBeNull();

    await inSession(mine, () => keys.removeServiceKey('pagespeed'));
    expect(await inSession(mine, () => keys.resolveServiceKey('pagespeed'))).toBeNull();

    expectNothingWritten();
  });

  it('rejects an empty key and an unknown service name', async () => {
    const keys = new SessionKeyResolver();
    const id = newSession('198.51.100.24');
    await expect(inSession(id, () => keys.saveServiceKey('pagespeed', '   '))).rejects.toThrow(/must not be empty/);
    await expect(inSession(id, () => keys.saveServiceKey('nope' as never, SAVED))).rejects.toThrow(
      /Unknown service key name/
    );
    expectNothingWritten();
  });
});
