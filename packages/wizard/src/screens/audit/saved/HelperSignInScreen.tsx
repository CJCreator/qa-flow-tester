import { useCallback, useEffect, useState } from 'react';
import type { HelperSession } from '@qa/types/src/browser.js';
import { ErrorMessage, Spinner } from '../../../components/text';
import { Page, PageHeader } from '../../../components/ui';
import { Link, PATHS } from '../../../lib/router';
import { useDocumentTitle } from '../../../lib/title';
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
import { loadVersion } from './saved-api';

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
  /** The site host of each Website Audit by id; the list shows the id for one that is missing. */
  hosts?: Readonly<Record<string, string>>;
}

/** The Helper sign-in panel without state. */
export function HelperSignInView({ state, onSignIn, onSignOut, onOpenAudit, hosts = {} }: HelperSignInViewProps) {
  if (state.status === 'loading') return <Spinner label="Checking Helper sign-in…" />;
  if (state.status === 'off')
    return (
      <div className="max-w-prose space-y-4">
        <p className="text-ink-soft">{HELPERS_OFF_MESSAGE}</p>
        <Link to={PATHS.landing} className="btn-link">
          Back to the home page
        </Link>
      </div>
    );
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
        <section aria-labelledby="helper-audits-title" className="card-1 bg-surface p-4">
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
                    <p className="break-words font-semibold">
                      {hosts[grant.auditId]
                        ? `Website Audit of ${hosts[grant.auditId]}`
                        : 'A Website Audit given to you (loading its name…)'}
                    </p>
                    <p className="text-sm text-ink-soft">{`You can: ${permissionText(grant.permissions)}`}</p>
                  </div>
                  {onOpenAudit && (
                    <button type="button" className="btn-quiet" onClick={() => onOpenAudit(grant.auditId)}>
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
        {busy ? <Spinner label="Signing in…" announce={false} /> : 'Sign in with Google'}
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
  const [hosts, setHosts] = useState<Record<string, string>>({});
  useDocumentTitle('Helper sign-in');

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

  // The grants hold no host, so each Website Audit's host is read from the audit itself.
  const grantIds = state.status === 'signed-in' ? state.session.grants.map((grant) => grant.auditId).join(',') : '';
  useEffect(() => {
    if (grantIds === '') return;
    let live = true;
    for (const auditId of grantIds.split(',')) {
      void loadVersion(auditId, undefined, fetchImpl).then((outcome) => {
        if (live && outcome.ok) setHosts((now) => ({ ...now, [auditId]: outcome.value.summary.host }));
      });
    }
    return () => {
      live = false;
    };
  }, [grantIds, fetchImpl]);

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
    <Page width="form">
      <PageHeader
        title="Helper sign-in"
        lede={state.status !== 'off' ? <HelperRules /> : undefined}
      />
      <HelperSignInView
        state={state}
        onSignIn={() => void start()}
        onSignOut={() => void stop()}
        onOpenAudit={onOpenAudit}
        hosts={hosts}
      />
    </Page>
  );
}
