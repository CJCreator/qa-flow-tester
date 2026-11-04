import type { FirebaseWebConfig } from './helper-api';

/**
 * Google sign-in for a Helper through Firebase Authentication (REQ-033). The firebase SDK is loaded by
 * dynamic import here only, so no other wizard screen carries it, and only its app and auth modules are used.
 * Auth persistence is in memory: nothing goes to localStorage, sessionStorage, IndexedDB or the URL. The ID
 * token is returned to the caller, which hands it to `POST /api/helper/session` once; Firebase is signed out
 * right after, so the token is not kept in the page either.
 */

/** The few firebase calls the sign-in uses, typed loosely so tests can hand in a stand-in. */
export interface FirebaseAuthSdk {
  initializeApp: (config: FirebaseWebConfig, name: string) => unknown;
  getApps: () => ReadonlyArray<{ name: string }>;
  getApp: (name: string) => unknown;
  initializeAuth: (app: never, deps: { persistence: unknown; popupRedirectResolver: unknown }) => unknown;
  inMemoryPersistence: unknown;
  browserPopupRedirectResolver: unknown;
  GoogleAuthProvider: new () => unknown;
  signInWithPopup: (auth: never, provider: never) => Promise<{ user: { getIdToken: () => Promise<string> } }>;
  signOut: (auth: never) => Promise<void>;
}

export type GoogleSignInResult = { status: 'token'; idToken: string } | { status: 'cancelled' } | { status: 'failed' };

/** The name of the firebase app this page makes, apart from any other. */
export const HELPER_APP_NAME = 'qa-helper-sign-in';

/** Loads the firebase app and auth modules on demand. */
export async function loadFirebaseAuth(): Promise<FirebaseAuthSdk> {
  const [app, auth] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  return {
    initializeApp: app.initializeApp,
    getApps: app.getApps,
    getApp: app.getApp,
    initializeAuth: auth.initializeAuth,
    inMemoryPersistence: auth.inMemoryPersistence,
    browserPopupRedirectResolver: auth.browserPopupRedirectResolver,
    GoogleAuthProvider: auth.GoogleAuthProvider,
    signInWithPopup: auth.signInWithPopup,
    signOut: auth.signOut,
  } as unknown as FirebaseAuthSdk;
}

/** The auth instance per loaded SDK: `initializeAuth` may be called once per app. */
const authFor = new WeakMap<FirebaseAuthSdk, unknown>();

function helperAuth(sdk: FirebaseAuthSdk, config: FirebaseWebConfig): unknown {
  const known = authFor.get(sdk);
  if (known !== undefined) return known;
  const app = sdk.getApps().some((existing) => existing.name === HELPER_APP_NAME)
    ? sdk.getApp(HELPER_APP_NAME)
    : sdk.initializeApp(config, HELPER_APP_NAME);
  const auth = sdk.initializeAuth(app as never, {
    persistence: sdk.inMemoryPersistence,
    popupRedirectResolver: sdk.browserPopupRedirectResolver,
  });
  authFor.set(sdk, auth);
  return auth;
}

/** Codes Firebase uses when the person closed or replaced the Google window themselves. */
const CANCELLED_CODES = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);

function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;
}

/** Opens the Google sign-in window and returns the Google ID token; nothing is stored. */
export async function signInWithGoogle(
  config: FirebaseWebConfig,
  load: () => Promise<FirebaseAuthSdk> = loadFirebaseAuth
): Promise<GoogleSignInResult> {
  let sdk: FirebaseAuthSdk;
  let auth: unknown;
  try {
    sdk = await load();
    auth = helperAuth(sdk, config);
  } catch {
    return { status: 'failed' };
  }
  try {
    const credential = await sdk.signInWithPopup(auth as never, new sdk.GoogleAuthProvider() as never);
    const idToken = await credential.user.getIdToken();
    return idToken ? { status: 'token', idToken } : { status: 'failed' };
  } catch (error) {
    const code = errorCode(error);
    return code && CANCELLED_CODES.has(code) ? { status: 'cancelled' } : { status: 'failed' };
  } finally {
    // The runner's session cookie is the sign-in from here on; the Firebase user is not kept.
    await sdk.signOut(auth as never).catch(() => undefined);
  }
}
