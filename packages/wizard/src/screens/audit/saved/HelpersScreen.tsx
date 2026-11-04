import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { HELPER_PERMISSIONS, type HelperGrant, type HelperPermission } from '@qa/types/src/browser.js';
import { useConfirm } from '../../../components/ConfirmDialog';
import { ErrorMessage, FocusHeading, Spinner } from '../../../components/text';
import { Link, PATHS } from '../../../lib/router';
import { useDocumentTitle } from '../../../lib/title';
import {
  HELPERS_OFF_MESSAGE,
  PERMISSION_LABEL,
  grantHelper,
  listHelpers,
  loadHelperStatus,
  normalEmail,
  permissionText,
  removeHelper,
  withView,
  type Fetch,
} from './helper-api';

const PERMISSION_HINT: Readonly<Record<HelperPermission, string>> = {
  view: 'Open the Website Audit and read its documents.',
  edit: 'Change findings, Sections and recommendations.',
  export: 'Download the Audit Documents, the Pitch Glimpse and the Owner Audit.',
};

/** What every Helper can and cannot do, shown on both Helper screens. */
export function HelperRules() {
  return (
    <div className="max-w-prose text-sm text-ink-soft">
      <p>A Helper signs in with a Google account and can view, edit or export only the Website Audits given to them.</p>
      <p className="mt-1">A Helper cannot see or use the AI keys, delete a Website Audit, or add Helpers.</p>
    </div>
  );
}

export type HelpersMessage = { tone: 'pass' | 'fail'; text: string } | null;

export interface HelpersViewProps {
  helpers: HelperGrant[];
  email: string;
  permissions: HelperPermission[];
  busy: boolean;
  message: HelpersMessage;
  onEmail: (email: string) => void;
  onPermissions: (permissions: HelperPermission[]) => void;
  onGive: () => void;
  onRemove: (helper: HelperGrant) => void;
  /** The full address a Helper opens to sign in; shown with a copy button when given. */
  signInAddress?: string;
  copied?: 'copied' | 'failed' | null;
  onCopy?: (address: string) => void;
}

/** The Helper list and the "give access" form, without state. */
export function HelpersView({
  helpers,
  email,
  permissions,
  busy,
  message,
  onEmail,
  onPermissions,
  onGive,
  onRemove,
  signInAddress,
  copied = null,
  onCopy,
}: HelpersViewProps) {
  const chosen = withView(permissions);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onGive();
  };
  return (
    <div className="space-y-10">
      <section aria-labelledby="helpers-list-title" className="card-1 bg-surface p-4">
        <h2 id="helpers-list-title" className="text-xl font-bold">
          Helpers of this Website Audit
        </h2>
        {helpers.length === 0 ? (
          <p className="mt-2 text-ink-soft">No Helper has access to this Website Audit yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-rule">
            {helpers.map((helper) => (
              <li key={helper.email} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="break-words font-semibold">{helper.email}</p>
                  <p className="text-sm text-ink-soft">{`Can: ${permissionText(helper.permissions)}`}</p>
                </div>
                <button
                  type="button"
                  className="btn-quiet"
                  disabled={busy}
                  aria-label={`Remove access for ${helper.email}`}
                  onClick={() => onRemove(helper)}
                >
                  Remove access
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="helpers-give-title" className="card-1 bg-surface p-4">
        <h2 id="helpers-give-title" className="text-xl font-bold">
          Give access
        </h2>
        <form className="mt-3 space-y-4" onSubmit={submit} noValidate>
          <div>
            <label htmlFor="helper-email" className="label text-ink">
              Google account email
            </label>
            <input
              id="helper-email"
              type="email"
              autoComplete="off"
              className="field mt-1 w-full max-w-md text-sm"
              value={email}
              onChange={(e) => onEmail(e.target.value)}
            />
          </div>
          <fieldset>
            <legend className="label text-ink">The Helper can</legend>
            <ul className="mt-1 space-y-2">
              {HELPER_PERMISSIONS.map((permission) => {
                const id = `helper-permission-${permission}`;
                return (
                  <li key={permission} className="flex flex-wrap items-center gap-2">
                    <input
                      id={id}
                      type="checkbox"
                      checked={chosen.includes(permission)}
                      disabled={permission === 'view'}
                      aria-describedby={`${id}-hint`}
                      onChange={(e) =>
                        onPermissions(
                          e.target.checked ? [...chosen, permission] : chosen.filter((other) => other !== permission)
                        )
                      }
                    />
                    <label htmlFor={id} className="font-semibold">
                      {PERMISSION_LABEL[permission]}
                    </label>
                    <span id={`${id}-hint`} className="text-sm text-ink-soft">
                      {permission === 'view' ? `${PERMISSION_HINT.view} Always included.` : PERMISSION_HINT[permission]}
                    </span>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <button type="submit" className="btn-primary px-6 font-bold" disabled={busy}>
            {busy ? <Spinner label="Saving…" /> : 'Give access'}
          </button>
        </form>
      </section>

      {signInAddress && (
        <section aria-labelledby="helpers-address-title" className="card-1 bg-surface p-4">
          <h2 id="helpers-address-title" className="text-xl font-bold">
            Where a Helper signs in
          </h2>
          <p className="mt-1 max-w-prose text-sm text-ink-soft">
            Send this address to the Helper. They sign in there with the Google account you gave access to.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="helper-sign-in-address" className="sr-only">
              Helper sign-in address
            </label>
            <input
              id="helper-sign-in-address"
              type="text"
              readOnly
              className="field w-full max-w-md font-mono text-sm"
              value={signInAddress}
              onFocus={(e) => e.target.select()}
            />
            {onCopy && (
              <button type="button" className="btn-quiet min-h-[44px]" onClick={() => onCopy(signInAddress)}>
                Copy address
              </button>
            )}
          </div>
          {copied === 'copied' && (
            <p role="status" className="mt-1 text-sm font-semibold text-pass">
              Copied.
            </p>
          )}
          {copied === 'failed' && (
            <p role="status" className="mt-1 text-sm text-ink-soft">
              Copying was blocked. Select the address above and copy it by hand.
            </p>
          )}
        </section>
      )}

      {message &&
        (message.tone === 'fail' ? (
          <ErrorMessage>{message.text}</ErrorMessage>
        ) : (
          <p role="status" className="text-sm font-semibold text-pass">
            {message.text}
          </p>
        ))}
    </div>
  );
}

export interface HelpersScreenProps {
  auditId: string;
  /** For tests: the requests. */
  fetchImpl?: Fetch;
}

export type HelpersLoaded =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'off' }
  | { status: 'loaded'; helpers: HelperGrant[] };

type Loaded = HelpersLoaded;

/**
 * The screen below its heading, without state. When Helper sign-in is not set up on this copy it says so
 * and offers nothing else.
 */
export function HelpersBody({ loaded, ...view }: { loaded: HelpersLoaded } & Omit<HelpersViewProps, 'helpers'>) {
  if (loaded.status === 'off') return <p className="max-w-prose text-ink-soft">{HELPERS_OFF_MESSAGE}</p>;
  return (
    <>
      <div className="mb-6">
        <HelperRules />
      </div>
      {loaded.status === 'loading' && <Spinner label="Loading the Helpers…" />}
      {loaded.status === 'failed' && <ErrorMessage>{loaded.message}</ErrorMessage>}
      {loaded.status === 'loaded' && <HelpersView helpers={loaded.helpers} {...view} />}
    </>
  );
}

/** The tool user gives and removes Helper access to one Website Audit (REQ-033). */
export function HelpersScreen({ auditId, fetchImpl }: HelpersScreenProps) {
  const { confirm, dialog } = useConfirm();
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [email, setEmail] = useState('');
  const [permissions, setPermissions] = useState<HelperPermission[]>(['view']);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<HelpersMessage>(null);
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null);
  useDocumentTitle('Helpers');

  useEffect(() => {
    let live = true;
    void (async () => {
      const status = await loadHelperStatus(fetchImpl);
      if (!live) return;
      if (!status.ok) return setLoaded({ status: 'failed', message: status.message });
      if (!status.value.enabled) return setLoaded({ status: 'off' });
      const list = await listHelpers(auditId, fetchImpl);
      if (!live) return;
      setLoaded(list.ok ? { status: 'loaded', helpers: list.value } : { status: 'failed', message: list.message });
    })();
    return () => {
      live = false;
    };
  }, [auditId, fetchImpl]);

  const give = useCallback(async () => {
    const address = normalEmail(email);
    if (address === null) {
      setMessage({ tone: 'fail', text: 'Enter the Google account email of the Helper, like name@gmail.com.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    const outcome = await grantHelper(auditId, { email: address, permissions }, fetchImpl);
    if (outcome.ok) {
      const grant = outcome.value;
      setLoaded((current) =>
        current.status === 'loaded'
          ? { status: 'loaded', helpers: [...current.helpers.filter((h) => h.email !== grant.email), grant] }
          : current
      );
      setEmail('');
      setPermissions(['view']);
      setMessage({
        tone: 'pass',
        text: `${grant.email} can now ${permissionText(grant.permissions).toLowerCase()} this Website Audit.`,
      });
    } else {
      setMessage({ tone: 'fail', text: outcome.message });
    }
    setBusy(false);
  }, [auditId, email, permissions, fetchImpl]);

  const copy = useCallback(async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  }, []);

  const remove = useCallback(
    async (helper: HelperGrant) => {
      const ok = await confirm({
        title: 'Remove this Helper’s access?',
        body: (
          <p>
            {helper.email} can no longer open this Website Audit. Their other Website Audits are not changed. You can
            give access again later.
          </p>
        ),
        confirmLabel: 'Remove access',
        danger: true,
      });
      if (!ok) return;
      setBusy(true);
      setMessage(null);
      const outcome = await removeHelper(auditId, helper.email, fetchImpl);
      if (outcome.ok) {
        setLoaded((current) =>
          current.status === 'loaded'
            ? { status: 'loaded', helpers: current.helpers.filter((h) => h.email !== helper.email) }
            : current
        );
        setMessage({ tone: 'pass', text: `${helper.email} no longer has access.` });
      } else {
        setMessage({ tone: 'fail', text: outcome.message });
      }
      setBusy(false);
    },
    [auditId, confirm, fetchImpl]
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <FocusHeading className="mb-2 break-words text-question font-bold">Helpers</FocusHeading>
      <p className="mb-6">
        <Link to={PATHS.audit(auditId)} className="btn-link text-sm">
          Back to this Website Audit
        </Link>
      </p>
      <HelpersBody
        loaded={loaded}
        email={email}
        permissions={permissions}
        busy={busy}
        message={message}
        onEmail={(next) => {
          setEmail(next);
          setMessage(null);
        }}
        onPermissions={(next) => setPermissions(withView(next))}
        onGive={() => void give()}
        onRemove={(helper) => void remove(helper)}
        signInAddress={`${typeof window === 'undefined' ? '' : window.location.origin}${PATHS.helperSignIn}`}
        copied={copied}
        onCopy={(address) => void copy(address)}
      />
      {dialog}
    </div>
  );
}
