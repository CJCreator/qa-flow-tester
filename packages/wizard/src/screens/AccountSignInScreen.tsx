import { useCallback, useEffect, useState } from 'react';
import { WorkingLine, workingId } from '../components/DisabledReason';
import { ErrorMessage, Spinner } from '../components/text';
import { Page, PageHeader } from '../components/ui';
import { useDocumentTitle } from '../lib/title';
import { signInWithGoogle, type GoogleSignInResult } from './audit/saved/firebase-sign-in';
import { buildTimeFirebaseConfig, helperSignIn } from './audit/saved/HelperSignInScreen';
import { loadHelperStatus, type Fetch, type FirebaseWebConfig } from './audit/saved/helper-api';

export const ACCOUNT_SIGN_IN_TEXT =
  'Sign in with your Google account to run a check-up. Your account keeps your daily limit and your reports, and nobody else can open them.';
export const ACCOUNT_SIGN_IN_OFF = 'Sign-in is not set up on this copy yet. Ask the person who invited you.';

export interface AccountSignInScreenProps {
  /** For tests: the requests. */
  fetchImpl?: Fetch;
  /** For tests: the Google sign-in. Default: Firebase Authentication, loaded on demand. */
  signIn?: (config: FirebaseWebConfig) => Promise<GoogleSignInResult>;
  /** For tests: the Firebase web settings when the runner sends none. */
  fallbackConfig?: FirebaseWebConfig | null;
}

/**
 * Shown on the hosted copy instead of the new check-up form while nobody is signed in (ADR 0050). A good
 * sign-in announces a session change, which makes the page read the status again and show the form.
 */
export function AccountSignInScreen({
  fetchImpl,
  signIn = signInWithGoogle,
  fallbackConfig,
}: AccountSignInScreenProps) {
  const [config, setConfig] = useState<FirebaseWebConfig | null | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useDocumentTitle('Sign in');

  useEffect(() => {
    let live = true;
    void loadHelperStatus(fetchImpl).then((status) => {
      if (!live) return;
      const settings = status.ok
        ? (status.value.firebase ?? (fallbackConfig === undefined ? buildTimeFirebaseConfig() : fallbackConfig))
        : null;
      setConfig(status.ok && status.value.enabled ? settings : null);
    });
    return () => {
      live = false;
    };
  }, [fetchImpl, fallbackConfig]);

  const start = useCallback(async () => {
    if (config === null || config === 'loading') return;
    setBusy(true);
    setMessage(null);
    const next = await helperSignIn(config, signIn, fetchImpl);
    setBusy(false);
    if (next.status === 'signed-out') setMessage(next.message);
  }, [config, signIn, fetchImpl]);

  return (
    <Page width="form">
      <PageHeader title="Sign in to run a check-up" />
      {config === 'loading' ? (
        <Spinner label="Checking sign-in…" />
      ) : config === null ? (
        <p className="max-w-prose text-ink-soft">{ACCOUNT_SIGN_IN_OFF}</p>
      ) : (
        <div className="space-y-4">
          <p className="max-w-prose text-ink-soft">{ACCOUNT_SIGN_IN_TEXT}</p>
          <button
            type="button"
            className="btn-primary px-6 font-bold"
            disabled={busy}
            aria-describedby={workingId(busy)}
            onClick={() => void start()}
          >
            {busy ? <Spinner label="Signing in…" /> : 'Sign in with Google'}
          </button>
          <WorkingLine busy={busy} />
          {message && <ErrorMessage>{message}</ErrorMessage>}
        </div>
      )}
    </Page>
  );
}
