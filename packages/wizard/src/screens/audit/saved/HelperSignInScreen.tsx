import { useCallback, useEffect, useState } from 'react';
import type { HelperSession } from '@qa/types/src/browser.js';
import { ErrorMessage, FocusHeading, Spinner } from '../../../components/text';
import { signInWithGoogle, type GoogleSignInResult } from './firebase-sign-in';
import {
  HELPERS_OFF_MESSAGE,
  SIGN_IN_FAILED_MESSAGE,
  endHelperSession,
  loadHelperSession,
  loadHelperStatus,
  permissionText,
  startHelperSession,
  type Fetch,
  type FirebaseWebConfig,
} from './helper-api';
import { HelperRules } from './HelpersScreen';

/** The Firebase web settings baked in at build time (public values), used when the runner sends none. */
export function buildTimeFirebaseConfig(
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>
): FirebaseWebConfig | null {
  const apiKey = env.VITE_FIREBASE_WEB_API_KEY?.trim();
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = env.VITE_FIREBASE_PROJECT_ID?.trim();
  return apiKey && authDomain && projectId ? { apiKey, authDomain, projectId } : null;
}

export type HelperSignInState =
  | { status: 'loading' }
  | { status: 'off' }
  | { status: 'failed'; message: string }
  | { status: 'signed-out'; message: string | null }
  | { status: 'signing-in' }
  | { status: 'signed-in'; session: HelperSession; message: string | null };

/**
 * Google sign-in, then the ID token to `POST /api/helper/session`: the state that follows. The token lives
 * only in this call; it is never stored or put in the URL.
 */
export async function helperSignIn(
  config: FirebaseWebConfig,
  signIn: (config: FirebaseWebConfig) => Promise<GoogleSignInResult>,
  fetchImpl?: Fetch
): Promise<HelperSignInState> {
  const google = await signIn(config);
  if (google.status === 'cancelled') return { status: 'signed-out', message: null };
  if (google.status === 'failed') return { status: 'signed-out', message: SIGN_IN_FAILED_MESSAGE };
  const session = await startHelperSession(google.idToken, fetchImpl);
  if (session.ok) return { status: 'signed-in', session: session.value, message: null };
  return {
    status: 'signed-out',
    message: session.code === 'ERR_SIGN_IN_FAILED' ? SIGN_IN_FAILED_MESSAGE : session.message,
  };
}

export interface HelperSignInViewProps {
  state: HelperSignInState;
  onSignIn: () => void;
  onSignOut: () => void;
  /** Opens one of the Helper's Website Audits; the list shows ids only when not given. */
  onOpenAudit?: (auditId: string) => void;
}

/** The Helper sign-in panel without state. */
export function HelperSignInView({ state, onSignIn, onSignOut, onOpenAudit }: HelperSignInViewProps) {
  if (state.status === 'loading') return <Spinner label="Checking Helper sign-in…" />;
  if (state.status === 'off') return <p className="max-w-prose text-ink-soft">{HELPERS_OFF_MESSAGE}</p>;
  if (state.status === 'failed') return <ErrorMessage>{state.message}</ErrorMessage>;
  if (state.status === 'signed-in') {
    const { session } = state;
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <p className="break-words">{`Signed in as ${session.email}`}</p>
          <button type="button" className="btn-quiet" onClick={onSignOut}>
            Sign out
          </button>
        </div>
        {state.message && <ErrorMessage>{state.message}</ErrorMessage>}
        <section aria-labelledby="helper-audits-title" className="rounded border border-rule p-4">
          <h2 id="helper-audits-title" className="text-xl font-bold">
            Website Audits given to you
          </h2>
          {session.grants.length === 0 ? (
            <p className="mt-2 text-ink-soft">
              No Website Audit has been given to you yet. Ask the person who invited you.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-rule">
              {session.grants.map((grant) => (
                <li key={grant.auditId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="break-words font-semibold">{`Website Audit ${grant.auditId}`}</p>
                    <p className="text-sm text-ink-soft">{`You can: ${permissionText(grant.permissions)}`}</p>
                  </div>
                  {onOpenAudit && (
                    <button type="button" className="btn-secondary" onClick={() => onOpenAudit(grant.auditId)}>
                      Open
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }
  const busy = state.status === 'signing-in';
  return (
    <div className="space-y-4">
      <button type="button" className="btn-primary px-6 font-bold" disabled={busy} onClick={onSignIn}>
        {busy ? <Spinner label="Signing in…" /> : 'Sign in with Google'}
      </button>
      {state.status === 'signed-out' && state.message && <ErrorMessage>{state.message}</ErrorMessage>}
    </div>
  );
}

export interface HelperSignInScreenProps {
  onOpenAudit?: (auditId: string) => void;
  /** For tests: the requests. */
  fetchImpl?: Fetch;
  /** For tests: the Google sign-in. Default: Firebase Authentication, loaded on demand. */
  signIn?: (config: FirebaseWebConfig) => Promise<GoogleSignInResult>;
  /** For tests: the Firebase web settings when the runner sends none. */
  fallbackConfig?: FirebaseWebConfig | null;
}

/** A Helper signs in with Google and sees only the Website Audits given to them (REQ-033). */
export function HelperSignInScreen({
  onOpenAudit,
  fetchImpl,
  signIn = signInWithGoogle,
  fallbackConfig,
}: HelperSignInScreenProps) {
  const [state, setState] = useState<HelperSignInState>({ status: 'loading' });
  const [config, setConfig] = useState<FirebaseWebConfig | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const status = await loadHelperStatus(fetchImpl);
      if (!live) return;
      if (!status.ok) return setState({ status: 'failed', message: status.message });
      const settings =
        status.value.firebase ?? (fallbackConfig === undefined ? buildTimeFirebaseConfig() : fallbackConfig);
      if (!status.value.enabled || settings === null) return setState({ status: 'off' });
      setConfig(settings);
      const session = await loadHelperSession(fetchImpl);
      if (!live) return;
      setState(
        session.ok
          ? { status: 'signed-in', session: session.value, message: null }
          : { status: 'signed-out', message: null }
      );
    })();
    return () => {
      live = false;
    };
  }, [fetchImpl, fallbackConfig]);

  const start = useCallback(async () => {
    if (config === null) return;
    setState({ status: 'signing-in' });
    setState(await helperSignIn(config, signIn, fetchImpl));
  }, [config, signIn, fetchImpl]);

  const stop = useCallback(async () => {
    const outcome = await endHelperSession(fetchImpl);
    setState((current) =>
      outcome.ok
        ? { status: 'signed-out', message: null }
        : current.status === 'signed-in'
          ? { ...current, message: outcome.message }
          : current
    );
  }, [fetchImpl]);

  return (
    <div className="mx-auto max-w-[64rem] px-4 py-10 sm:px-6 sm:py-14">
      <FocusHeading className="mb-2 break-words text-question font-bold">Helper sign-in</FocusHeading>
      {state.status !== 'off' && (
        <div className="mb-6">
          <HelperRules />
        </div>
      )}
      <HelperSignInView
        state={state}
        onSignIn={() => void start()}
        onSignOut={() => void stop()}
        onOpenAudit={onOpenAudit}
      />
    </div>
  );
}
