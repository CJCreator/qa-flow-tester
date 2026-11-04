import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HelperGrant, HelperSession } from '@qa/types/src/browser.js';
import {
  HELPERS_OFF_MESSAGE,
  SIGN_IN_FAILED_MESSAGE,
  endHelperSession,
  grantHelper,
  listHelpers,
  loadHelperSession,
  loadHelperStatus,
  normalEmail,
  permissionText,
  removeHelper,
  startHelperSession,
  type Fetch,
  type FirebaseWebConfig,
} from '../src/screens/audit/saved/helper-api';
import { HELPER_APP_NAME, signInWithGoogle, type FirebaseAuthSdk } from '../src/screens/audit/saved/firebase-sign-in';
import {
  HelperRules,
  HelpersBody,
  HelpersScreen,
  HelpersView,
  type HelpersViewProps,
} from '../src/screens/audit/saved/HelpersScreen';
import {
  HelperSignInScreen,
  HelperSignInView,
  buildTimeFirebaseConfig,
  helperSignIn,
  type HelperSignInState,
} from '../src/screens/audit/saved/HelperSignInScreen';

// ---------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------

const AUDIT_ID = 'abcd1234';
const CONFIG: FirebaseWebConfig = { apiKey: 'public-web-key', authDomain: 'demo.firebaseapp.com', projectId: 'demo' };

const helpers: HelperGrant[] = [
  { auditId: AUDIT_ID, email: 'asha@gmail.com', permissions: ['view'], grantedAt: '2026-11-01T00:00:00Z' },
  {
    auditId: AUDIT_ID,
    email: 'ravi@gmail.com',
    permissions: ['view', 'edit', 'export'],
    grantedAt: '2026-11-02T00:00:00Z',
  },
];

const session: HelperSession = {
  email: 'asha@gmail.com',
  grants: [
    {
      auditId: 'audit001',
      email: 'asha@gmail.com',
      permissions: ['view', 'export'],
      grantedAt: '2026-11-01T00:00:00Z',
    },
  ],
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** A fetch stand-in: each reply in turn, and every call recorded. */
function fakeFetch(...replies: Array<{ status: number; body: unknown }>): { fetchImpl: Fetch; calls: Call[] } {
  const calls: Call[] = [];
  let next = 0;
  const fetchImpl: Fetch = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const reply = replies[Math.min(next++, replies.length - 1)]!;
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetchImpl, calls };
}

function viewProps(over: Partial<HelpersViewProps> = {}): HelpersViewProps {
  return {
    helpers,
    email: '',
    permissions: ['view'],
    busy: false,
    message: null,
    onEmail: () => undefined,
    onPermissions: () => undefined,
    onGive: () => undefined,
    onRemove: () => undefined,
    ...over,
  };
}

/** The visible text of some markup: tags (and their attributes, like role="status") removed. */
function textOf(markup: string): string {
  return markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

const BANNED_PERSON_WORDS = /\b(roles?|users?|team members?|collaborators?)\b/i;

// ---------------------------------------------------------------------------------------------------
// The runner calls
// ---------------------------------------------------------------------------------------------------

describe('Helper API calls', () => {
  it('reads whether Helper sign-in is set up, with the public Firebase settings when sent', async () => {
    const on = fakeFetch({ status: 200, body: { enabled: true, firebase: CONFIG } });
    expect(await loadHelperStatus(on.fetchImpl)).toEqual({ ok: true, value: { enabled: true, firebase: CONFIG } });
    expect(on.calls[0]).toMatchObject({ url: '/api/helper/status', method: 'GET' });

    const disabled = fakeFetch({ status: 200, body: { enabled: false } });
    expect(await loadHelperStatus(disabled.fetchImpl)).toEqual({ ok: true, value: { enabled: false, firebase: null } });

    const off = fakeFetch({ status: 404, body: { error: 'off', code: 'ERR_HELPERS_OFF' } });
    expect(await loadHelperStatus(off.fetchImpl)).toEqual({ ok: true, value: { enabled: false, firebase: null } });
  });

  it('lists, gives and removes Helper access on one Website Audit', async () => {
    const list = fakeFetch({ status: 200, body: { helpers } });
    expect(await listHelpers(AUDIT_ID, list.fetchImpl)).toEqual({ ok: true, value: helpers });
    expect(list.calls[0]).toMatchObject({ url: `/api/audits/${AUDIT_ID}/helpers`, method: 'GET' });

    const give = fakeFetch({ status: 200, body: { helper: helpers[1] } });
    const given = await grantHelper(
      AUDIT_ID,
      { email: 'ravi@gmail.com', permissions: ['export', 'edit'] },
      give.fetchImpl
    );
    expect(given).toEqual({ ok: true, value: helpers[1] });
    expect(give.calls[0]).toEqual({
      url: `/api/audits/${AUDIT_ID}/helpers`,
      method: 'PUT',
      body: { email: 'ravi@gmail.com', permissions: ['view', 'edit', 'export'] },
    });

    const remove = fakeFetch({ status: 200, body: { removed: true } });
    expect(await removeHelper(AUDIT_ID, 'asha+test@gmail.com', remove.fetchImpl)).toEqual({ ok: true, value: true });
    expect(remove.calls[0]).toMatchObject({
      url: `/api/audits/${AUDIT_ID}/helpers?email=asha%2Btest%40gmail.com`,
      method: 'DELETE',
    });
  });

  it('turns refusals into plain sentences', async () => {
    const forbidden = fakeFetch({ status: 403, body: { error: 'Forbidden: owner route', code: 'ERR_FORBIDDEN' } });
    const outcome = await listHelpers(AUDIT_ID, forbidden.fetchImpl);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).not.toMatch(/403|owner route/);

    const down: Fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const unreachable = await listHelpers(AUDIT_ID, down);
    expect(unreachable).toEqual({ ok: false, message: expect.stringMatching(/not answering/) });
  });

  it('posts the ID token once in the body of POST /api/helper/session', async () => {
    const post = fakeFetch({ status: 200, body: session });
    expect(await startHelperSession('id-token-123', post.fetchImpl)).toEqual({ ok: true, value: session });
    expect(post.calls).toEqual([{ url: '/api/helper/session', method: 'POST', body: { idToken: 'id-token-123' } }]);
    expect(post.calls[0]!.url).not.toContain('id-token-123');
  });

  it('shows a plain message for ERR_SIGN_IN_FAILED', async () => {
    const refused = fakeFetch({
      status: 401,
      body: { error: 'Token audience mismatch: aud=xyz', code: 'ERR_SIGN_IN_FAILED' },
    });
    expect(await startHelperSession('bad', refused.fetchImpl)).toEqual({
      ok: false,
      message: SIGN_IN_FAILED_MESSAGE,
      code: 'ERR_SIGN_IN_FAILED',
    });
  });

  it('reads the open session and signs out with DELETE /api/helper/session', async () => {
    const get = fakeFetch({ status: 200, body: session });
    expect(await loadHelperSession(get.fetchImpl)).toEqual({ ok: true, value: session });
    expect(get.calls[0]).toMatchObject({ url: '/api/helper/session', method: 'GET' });

    const out = fakeFetch({ status: 200, body: { signedOut: true } });
    expect(await endHelperSession(out.fetchImpl)).toEqual({ ok: true, value: true });
    expect(out.calls[0]).toMatchObject({ url: '/api/helper/session', method: 'DELETE' });
  });

  it('checks the email and names the permissions with view always in', () => {
    expect(normalEmail('  Asha@Gmail.com ')).toBe('asha@gmail.com');
    expect(normalEmail('asha')).toBeNull();
    expect(normalEmail('')).toBeNull();
    expect(permissionText(['export'])).toBe('View, Export');
    expect(permissionText(['edit', 'view'])).toBe('View, Edit');
  });
});

// ---------------------------------------------------------------------------------------------------
// The Helpers screen
// ---------------------------------------------------------------------------------------------------

describe('Helpers screen', () => {
  it('lists each Helper with their permissions and a labelled Remove access button', () => {
    const html = renderToStaticMarkup(createElement(HelpersView, viewProps()));
    expect(html).toContain('asha@gmail.com');
    expect(html).toContain('Can: View');
    expect(html).toContain('ravi@gmail.com');
    expect(html).toContain('Can: View, Edit, Export');
    expect(html).toContain('aria-label="Remove access for asha@gmail.com"');
    expect(html).toContain('aria-label="Remove access for ravi@gmail.com"');
  });

  it('gives access by Google account email with view, edit and export choices', () => {
    const html = renderToStaticMarkup(createElement(HelpersView, viewProps({ permissions: ['view', 'edit'] })));
    expect(html).toMatch(/<label for="helper-email"[^>]*>Google account email<\/label>/);
    expect(html).toMatch(/<input id="helper-email" type="email"/);
    for (const [permission, label] of [
      ['view', 'View'],
      ['edit', 'Edit'],
      ['export', 'Export'],
    ] as const) {
      expect(html).toContain(`id="helper-permission-${permission}" type="checkbox"`);
      expect(html).toMatch(new RegExp(`<label for="helper-permission-${permission}"[^>]*>${label}</label>`));
    }
    // View is always included; Edit is ticked; Export is not.
    expect(html).toMatch(/id="helper-permission-view" type="checkbox"[^>]*checked=""/);
    expect(html).toMatch(/id="helper-permission-view" type="checkbox"[^>]*disabled=""/);
    expect(html).toMatch(/id="helper-permission-edit" type="checkbox"[^>]*checked=""/);
    expect(html).not.toMatch(/id="helper-permission-export" type="checkbox"[^>]*checked=""/);
    expect(html).toMatch(/<button type="submit"[^>]*>Give access<\/button>/);
  });

  it('says when no Helper has access yet', () => {
    const html = renderToStaticMarkup(createElement(HelpersView, viewProps({ helpers: [] })));
    expect(html).toContain('No Helper has access to this Website Audit yet.');
  });

  it('asks for confirmation before removing access', () => {
    // The screen confirms through the shared ConfirmDialog before it calls DELETE.
    const source = readFileSync(new URL('../src/screens/audit/saved/HelpersScreen.tsx', import.meta.url), 'utf8');
    const removeBody = source.slice(source.indexOf('const remove = useCallback'));
    const confirmAt = removeBody.indexOf('await confirm(');
    const guardAt = removeBody.indexOf('if (!ok) return;');
    const deleteAt = removeBody.indexOf('await removeHelper(');
    expect(confirmAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(confirmAt);
    expect(deleteAt).toBeGreaterThan(guardAt);
  });

  it('says Helper sign-in is not set up and offers nothing else when it is off', () => {
    const html = renderToStaticMarkup(createElement(HelpersBody, { ...viewProps(), loaded: { status: 'off' } }));
    expect(textOf(html).trim()).toBe(HELPERS_OFF_MESSAGE);
    expect(html).not.toMatch(/<(button|input|form|a)\b/);
  });

  it('shows the loading state first, then the list when loaded', () => {
    const loading = renderToStaticMarkup(createElement(HelpersScreen, { auditId: AUDIT_ID }));
    expect(loading).toContain('Loading the Helpers…');
    const loaded = renderToStaticMarkup(
      createElement(HelpersBody, { ...viewProps(), loaded: { status: 'loaded', helpers } })
    );
    expect(loaded).toContain('ravi@gmail.com');
    const failed = renderToStaticMarkup(
      createElement(HelpersBody, { ...viewProps(), loaded: { status: 'failed', message: 'Nope.' } })
    );
    expect(failed).toContain('role="alert"');
  });

  it('escapes Helper emails rendered from data', () => {
    const html = renderToStaticMarkup(
      createElement(
        HelpersView,
        viewProps({ helpers: [{ ...helpers[0]!, email: '<img src=x onerror=alert(1)>@x.io' }] })
      )
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

// ---------------------------------------------------------------------------------------------------
// The Helper sign-in screen
// ---------------------------------------------------------------------------------------------------

describe('Helper sign-in screen', () => {
  it('signs in with Google, posts the ID token, then lists only the Website Audits given to the Helper', async () => {
    const post = fakeFetch({ status: 200, body: session });
    const signIn = vi.fn(async () => ({ status: 'token' as const, idToken: 'google-id-token' }));
    const state = await helperSignIn(CONFIG, signIn, post.fetchImpl);
    expect(signIn).toHaveBeenCalledWith(CONFIG);
    expect(post.calls).toEqual([{ url: '/api/helper/session', method: 'POST', body: { idToken: 'google-id-token' } }]);
    expect(state).toEqual({ status: 'signed-in', session, message: null });

    const html = renderToStaticMarkup(
      createElement(HelperSignInView, {
        state,
        onSignIn: () => undefined,
        onSignOut: () => undefined,
        onOpenAudit: () => undefined,
      })
    );
    expect(html).toContain('Signed in as asha@gmail.com');
    expect(html).toContain('Website Audit audit001');
    expect(html).toContain('You can: View, Export');
    expect(html.match(/Website Audit audit/g)).toHaveLength(1);
    expect(html).toMatch(/<button type="button"[^>]*>Sign out<\/button>/);
  });

  it('shows a plain message when the runner refuses the token with ERR_SIGN_IN_FAILED', async () => {
    const refused = fakeFetch({ status: 401, body: { error: 'jwt expired at 12:00', code: 'ERR_SIGN_IN_FAILED' } });
    const state = await helperSignIn(CONFIG, async () => ({ status: 'token', idToken: 't' }), refused.fetchImpl);
    expect(state).toEqual({ status: 'signed-out', message: SIGN_IN_FAILED_MESSAGE });
    const html = renderToStaticMarkup(
      createElement(HelperSignInView, { state, onSignIn: () => undefined, onSignOut: () => undefined })
    );
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('jwt');
    expect(html).toContain('Sign in with Google');
  });

  it('stays signed out without a message when the Google window is closed, and never posts', async () => {
    const post = fakeFetch({ status: 200, body: session });
    expect(await helperSignIn(CONFIG, async () => ({ status: 'cancelled' }), post.fetchImpl)).toEqual({
      status: 'signed-out',
      message: null,
    });
    expect(await helperSignIn(CONFIG, async () => ({ status: 'failed' }), post.fetchImpl)).toEqual({
      status: 'signed-out',
      message: SIGN_IN_FAILED_MESSAGE,
    });
    expect(post.calls).toHaveLength(0);
  });

  it('shows the off, loading and empty states', () => {
    const render = (state: HelperSignInState) =>
      renderToStaticMarkup(
        createElement(HelperSignInView, { state, onSignIn: () => undefined, onSignOut: () => undefined })
      );
    const off = render({ status: 'off' });
    expect(textOf(off).trim()).toBe(HELPERS_OFF_MESSAGE);
    expect(off).not.toMatch(/<button\b/);
    expect(render({ status: 'loading' })).toContain('role="status"');
    expect(render({ status: 'signed-in', session: { email: 'a@b.co', grants: [] }, message: null })).toContain(
      'No Website Audit has been given to you yet.'
    );
    expect(renderToStaticMarkup(createElement(HelperSignInScreen, {}))).toContain('Checking Helper sign-in…');
  });

  it('reads the build-time Firebase settings only when all three are set', () => {
    expect(
      buildTimeFirebaseConfig({
        VITE_FIREBASE_WEB_API_KEY: 'k',
        VITE_FIREBASE_AUTH_DOMAIN: 'd.firebaseapp.com',
        VITE_FIREBASE_PROJECT_ID: 'p',
      })
    ).toEqual({ apiKey: 'k', authDomain: 'd.firebaseapp.com', projectId: 'p' });
    expect(buildTimeFirebaseConfig({ VITE_FIREBASE_WEB_API_KEY: 'k' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------
// Firebase Authentication: in-memory persistence, no stored token
// ---------------------------------------------------------------------------------------------------

const IN_MEMORY = { type: 'NONE' };
const RESOLVER = { resolver: true };

function fakeSdk(signInWithPopup: FirebaseAuthSdk['signInWithPopup']) {
  const initializeAuth = vi.fn((_app: never, _deps: { persistence: unknown; popupRedirectResolver: unknown }) => ({
    auth: true,
  }));
  const signOut = vi.fn(async () => undefined);
  const initializeApp = vi.fn((_config: FirebaseWebConfig, name: string) => ({ name }));
  const sdk: FirebaseAuthSdk = {
    initializeApp,
    getApps: () => [],
    getApp: (name) => ({ name }),
    initializeAuth,
    inMemoryPersistence: IN_MEMORY,
    browserPopupRedirectResolver: RESOLVER,
    GoogleAuthProvider: class {},
    signInWithPopup,
    signOut,
  };
  return { sdk, initializeAuth, initializeApp, signOut };
}

describe('Firebase sign-in', () => {
  const storageWrites = vi.fn();
  const originalLocal = (globalThis as { localStorage?: unknown }).localStorage;
  const originalSession = (globalThis as { sessionStorage?: unknown }).sessionStorage;

  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = originalLocal;
    (globalThis as { sessionStorage?: unknown }).sessionStorage = originalSession;
    storageWrites.mockReset();
  });

  it('uses in-memory persistence, returns the ID token and signs Firebase out without storing it', async () => {
    const spyStorage = { setItem: storageWrites, getItem: () => null, removeItem: () => undefined };
    (globalThis as { localStorage?: unknown }).localStorage = spyStorage;
    (globalThis as { sessionStorage?: unknown }).sessionStorage = spyStorage;

    const { sdk, initializeAuth, initializeApp, signOut } = fakeSdk(async () => ({
      user: { getIdToken: async () => 'google-id-token' },
    }));
    const result = await signInWithGoogle(CONFIG, async () => sdk);
    expect(result).toEqual({ status: 'token', idToken: 'google-id-token' });
    expect(initializeApp).toHaveBeenCalledWith(CONFIG, HELPER_APP_NAME);
    expect(initializeAuth).toHaveBeenCalledTimes(1);
    expect(initializeAuth.mock.calls[0]![1].persistence).toBe(IN_MEMORY);
    expect(initializeAuth.mock.calls[0]![1].popupRedirectResolver).toBe(RESOLVER);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(storageWrites).not.toHaveBeenCalled();

    // A second sign-in reuses the same auth instance.
    await signInWithGoogle(CONFIG, async () => sdk);
    expect(initializeAuth).toHaveBeenCalledTimes(1);
  });

  it('tells a closed Google window apart from a failure', async () => {
    const closed = fakeSdk(async () => {
      throw Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' });
    });
    expect(await signInWithGoogle(CONFIG, async () => closed.sdk)).toEqual({ status: 'cancelled' });
    const broken = fakeSdk(async () => {
      throw Object.assign(new Error('nope'), { code: 'auth/internal-error' });
    });
    expect(await signInWithGoogle(CONFIG, async () => broken.sdk)).toEqual({ status: 'failed' });
    expect(
      await signInWithGoogle(CONFIG, async () => {
        throw new Error('chunk failed to load');
      })
    ).toEqual({ status: 'failed' });
  });

  it('never writes the token to localStorage, sessionStorage or the URL', () => {
    for (const file of ['firebase-sign-in.ts', 'HelperSignInScreen.tsx', 'helper-api.ts']) {
      const source = readFileSync(new URL(`../src/screens/audit/saved/${file}`, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/\b(localStorage|sessionStorage|indexedDB)\s*\./);
      expect(source, file).not.toMatch(
        /\b(location|history)\s*\.\s*(href|hash|search|assign|replace|pushState|replaceState)\b/
      );
      expect(source, file).not.toMatch(
        /browserLocalPersistence|browserSessionPersistence|indexedDBLocalPersistence|signInWithRedirect/
      );
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// The firebase SDK stays on the sign-in screen
// ---------------------------------------------------------------------------------------------------

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('firebase bundle boundary', () => {
  const files = sourceFiles(SRC).map((path) => ({
    path: relative(SRC, path).replace(/\\/g, '/'),
    source: readFileSync(path, 'utf8'),
  }));

  it('loads the firebase SDK by dynamic import in firebase-sign-in.ts only, auth module only', () => {
    const withFirebase = files
      .filter((file) => /['"]firebase(\/[a-z-]+)?['"]/.test(file.source))
      .map((file) => file.path);
    expect(withFirebase).toEqual(['screens/audit/saved/firebase-sign-in.ts']);

    const source = files.find((file) => file.path === 'screens/audit/saved/firebase-sign-in.ts')!.source;
    expect(source).not.toMatch(/^\s*import\s[^;]*['"]firebase/m);
    expect(source).not.toMatch(/^\s*export\s[^;]*from\s+['"]firebase/m);
    const modules = [...source.matchAll(/import\(\s*['"](firebase[^'"]*)['"]\s*\)/g)].map((match) => match[1]).sort();
    expect(modules).toEqual(['firebase/app', 'firebase/auth']);
  });

  it('is reached only from the Helper sign-in screen', () => {
    const importers = files
      .filter((file) => /^\s*import\s+(?!type\b)[^;]*from\s+['"][^'"]*firebase-sign-in['"]/m.test(file.source))
      .map((file) => file.path);
    expect(importers).toEqual(['screens/audit/saved/HelperSignInScreen.tsx']);
  });
});

// ---------------------------------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------------------------------

describe('Helper wording', () => {
  it('calls the person a Helper, and says what a Helper can and cannot do', () => {
    const rules = textOf(renderToStaticMarkup(createElement(HelperRules)));
    expect(rules).toMatch(/view, edit or export/);
    expect(rules).toMatch(/cannot see or use the AI keys, delete a Website Audit, or add Helpers/);

    const screens = [
      renderToStaticMarkup(createElement(HelpersScreen, { auditId: AUDIT_ID })),
      renderToStaticMarkup(createElement(HelpersView, viewProps({ message: { tone: 'pass', text: 'Saved.' } }))),
      renderToStaticMarkup(createElement(HelpersBody, { ...viewProps(), loaded: { status: 'off' } })),
      renderToStaticMarkup(createElement(HelperSignInScreen, {})),
      renderToStaticMarkup(
        createElement(HelperSignInView, {
          state: { status: 'signed-in', session, message: null },
          onSignIn: () => undefined,
          onSignOut: () => undefined,
          onOpenAudit: () => undefined,
        })
      ),
      renderToStaticMarkup(
        createElement(HelperSignInView, {
          state: { status: 'signed-out', message: SIGN_IN_FAILED_MESSAGE },
          onSignIn: () => undefined,
          onSignOut: () => undefined,
        })
      ),
    ];
    for (const html of screens) expect(textOf(html)).not.toMatch(BANNED_PERSON_WORDS);
    expect(textOf(screens[0]!)).toContain('Helpers');
  });

  it('keeps the people words out of every message shown on the Helper screens', () => {
    for (const file of ['helper-api.ts', 'HelpersScreen.tsx', 'HelperSignInScreen.tsx']) {
      const source = readFileSync(new URL(`../src/screens/audit/saved/${file}`, import.meta.url), 'utf8');
      // String literals and JSX text only: comments and code identifiers are not shown.
      const shown = [
        ...source.matchAll(/'([^'\n]*)'/g),
        ...source.matchAll(/`([^`]*)`/g),
        ...source.matchAll(/>([^<>{}]+)</g),
      ]
        .map((match) => match[1]!)
        .filter(
          (text) =>
            !/^(view|edit|export|status|alert|button|submit|email|off|checkbox|loading|loaded|failed)$/.test(text)
        );
      for (const text of shown) expect(text, `${file}: ${text}`).not.toMatch(BANNED_PERSON_WORDS);
    }
  });
});
