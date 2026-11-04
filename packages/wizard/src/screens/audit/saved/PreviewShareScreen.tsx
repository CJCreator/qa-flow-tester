import { useCallback, useEffect, useState } from 'react';
import type { AuditVersion, ShareLink, ShareLinkKind } from '@qa/types/src/browser.js';
import { useConfirm } from '../../../components/ConfirmDialog';
import { ErrorMessage, FocusHeading, Notice, Spinner } from '../../../components/text';
import { formatDay, formatWhen } from '../../../lib/format';
import { Link, PATHS } from '../../../lib/router';
import { useDocumentTitle } from '../../../lib/title';
import { AUDIT_PATHS, loadVersion, versionsOldestFirst } from './saved-api';
import {
  KIND_LABEL,
  LINK_STATE_LABEL,
  SHARED_LINK_WARNING,
  SHARE_KINDS,
  SHARE_LANGUAGES,
  createPreview,
  createSharedLink,
  expiryText,
  languageName,
  linkState,
  listSharedLinks,
  previewUrl,
  revokeAfterConfirm,
  sharedLinkAddress,
  withLink,
  type Fetch,
  type ShareLanguage,
} from './share-api';

/** The preview panel: idle, being written, written, or refused. */
export type PreviewState =
  | { status: 'idle' }
  | { status: 'making' }
  | { status: 'made'; createdAt: string }
  | { status: 'failed'; message: string; noAiKey: boolean };

export type LinksState =
  { status: 'loading' } | { status: 'failed'; message: string } | { status: 'loaded'; links: ShareLink[] };

export type ShareMessage = { tone: 'pass' | 'fail'; text: string } | null;

export interface PreviewShareViewProps {
  auditId: string;
  /** Finished versions, oldest first. */
  versions: AuditVersion[];
  version: number;
  previewLanguage: ShareLanguage;
  preview: PreviewState;
  kind: ShareLinkKind;
  shareLanguage: ShareLanguage;
  /** The Shared Link just made, shown in full with its copy button. */
  created: ShareLink | null;
  copied: 'idle' | 'copied' | 'failed';
  links: LinksState;
  busy: boolean;
  message: ShareMessage;
  /** The tool's own address, e.g. https://qa.example.com; Shared Links start with it. */
  origin: string;
  now?: Date;
  onVersion: (version: number) => void;
  onPreviewLanguage: (language: ShareLanguage) => void;
  onMakePreview: () => void;
  onKind: (kind: ShareLinkKind) => void;
  onShareLanguage: (language: ShareLanguage) => void;
  onCreateLink: () => void;
  onCopy: (address: string) => void;
  onRevoke: (link: ShareLink) => void;
}

function readLanguage(value: string): ShareLanguage {
  return (SHARE_LANGUAGES as readonly string[]).includes(value) ? (value as ShareLanguage) : 'en';
}

function LanguageSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: ShareLanguage;
  onChange: (value: ShareLanguage) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="label text-ink">
        Language
      </label>
      <select
        id={id}
        className="field mt-1 text-sm"
        value={value}
        onChange={(e) => onChange(readLanguage(e.target.value))}
      >
        {SHARE_LANGUAGES.map((language) => (
          <option key={language} value={language}>
            {languageName(language)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The Shared Link just made: the full address, a copy button, the expiry and who can open it. */
function CreatedLink({
  link,
  origin,
  copied,
  onCopy,
}: {
  link: ShareLink;
  origin: string;
  copied: PreviewShareViewProps['copied'];
  onCopy: (address: string) => void;
}) {
  const address = sharedLinkAddress(origin, link);
  return (
    <div className="card-1 bg-surface mt-4 p-3">
      <label htmlFor="shared-link-address" className="label text-ink">
        {`Shared Link to the ${KIND_LABEL[link.kind]} (${languageName(link.language)})`}
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          id="shared-link-address"
          type="text"
          readOnly
          className="field w-full max-w-xl font-mono text-sm"
          value={address}
          onFocus={(e) => e.target.select()}
        />
        <button type="button" className="btn-quiet" onClick={() => onCopy(address)}>
          Copy Shared Link
        </button>
      </div>
      {copied === 'copied' && (
        <p role="status" className="mt-1 text-sm font-semibold text-pass">
          Copied.
        </p>
      )}
      {copied === 'failed' && (
        <p role="status" className="mt-1 text-sm text-ink-soft">
          Copying was blocked. Select the Shared Link above and copy it by hand.
        </p>
      )}
      <p className="mt-2 text-sm">{expiryText(formatDay(link.expiresAt))}</p>
      <div className="mt-2">
        <Notice tone="warn" title="Anyone holding this Shared Link can open it">
          {SHARED_LINK_WARNING}
        </Notice>
      </div>
    </div>
  );
}

function LinkList({
  links,
  busy,
  now,
  onRevoke,
}: {
  links: ShareLink[];
  busy: boolean;
  now?: Date;
  onRevoke: (link: ShareLink) => void;
}) {
  if (links.length === 0)
    return <p className="mt-2 text-ink-soft">No Shared Link has been made for this Website Audit yet.</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Shared Links of this Website Audit</caption>
        <thead>
          <tr>
            <th scope="col" className="py-2 pr-3">
              Kind
            </th>
            <th scope="col" className="py-2 pr-3">
              Version
            </th>
            <th scope="col" className="py-2 pr-3">
              Language
            </th>
            <th scope="col" className="py-2 pr-3">
              Created
            </th>
            <th scope="col" className="py-2 pr-3">
              Expires
            </th>
            <th scope="col" className="py-2 pr-3">
              State
            </th>
            <th scope="col" className="py-2">
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {links.map((link) => {
            const state = linkState(link, now);
            const name = `${KIND_LABEL[link.kind]}, version ${link.version}, ${languageName(link.language)}, created ${formatWhen(link.createdAt)}`;
            return (
              <tr key={link.id}>
                <td className="py-2 pr-3 font-semibold">{KIND_LABEL[link.kind]}</td>
                <td className="py-2 pr-3">{link.version}</td>
                <td className="py-2 pr-3">{languageName(link.language)}</td>
                <td className="py-2 pr-3">{formatWhen(link.createdAt)}</td>
                <td className="py-2 pr-3">{formatDay(link.expiresAt)}</td>
                <td className="py-2 pr-3">
                  {state === 'revoked' && link.revokedAt
                    ? `Revoked ${formatWhen(link.revokedAt)}`
                    : LINK_STATE_LABEL[state]}
                </td>
                <td className="py-2">
                  {state === 'open' && (
                    <button
                      type="button"
                      className="btn-quiet"
                      disabled={busy}
                      aria-label={`Revoke Shared Link: ${name}`}
                      onClick={() => onRevoke(link)}
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The preview and Shared Link panels, without state. */
export function PreviewShareView(props: PreviewShareViewProps) {
  const { auditId, versions, version, preview, busy, message, links } = props;
  if (versions.length === 0) {
    return (
      <p className="max-w-prose text-ink-soft">
        This Website Audit has no finished version yet. Come back when a version has finished.
      </p>
    );
  }
  return (
    <div className="space-y-10">
      <div>
        <label htmlFor="share-version" className="label text-ink">
          Version
        </label>
        <select
          id="share-version"
          className="field mt-1 text-sm"
          value={String(version)}
          onChange={(e) => props.onVersion(Number(e.target.value))}
        >
          {versions.map((v) => (
            <option key={v.version} value={v.version}>
              {`Version ${v.version}, ${formatWhen(v.startedAt)}`}
            </option>
          ))}
        </select>
      </div>

      <section aria-labelledby="preview-title" className="card-1 bg-surface p-4">
        <h2 id="preview-title" className="text-xl font-bold">
          Improved homepage preview
        </h2>
        <p className="mt-1 max-w-prose text-sm text-ink-soft">
          The AI writes an improved homepage from this version's findings. It is a preview for the site owner: nothing
          on the site changes.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <LanguageSelect id="preview-language" value={props.previewLanguage} onChange={props.onPreviewLanguage} />
          <button
            type="button"
            className="btn-primary px-6 font-bold"
            disabled={busy || preview.status === 'making'}
            onClick={props.onMakePreview}
          >
            {preview.status === 'making' ? <Spinner label="Making the preview…" /> : 'Make preview'}
          </button>
          <a
            href={previewUrl(auditId, version)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-quiet"
            aria-label={`Open preview of version ${version} (opens in a new tab)`}
          >
            Open preview
          </a>
        </div>
        {preview.status === 'made' && (
          <p role="status" className="mt-3 text-sm font-semibold text-pass">
            {`The preview is ready (${formatWhen(preview.createdAt)}). Open it to check it.`}
          </p>
        )}
        {preview.status === 'failed' && (
          <div className="mt-3">
            {preview.noAiKey ? (
              <Notice
                title="An AI key is needed"
                actions={
                  <Link to={PATHS.settings} className="btn-link">
                    Add an AI key in Settings
                  </Link>
                }
              >
                {preview.message}
              </Notice>
            ) : (
              <ErrorMessage>{preview.message}</ErrorMessage>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="new-link-title" className="card-1 bg-surface p-4">
        <h2 id="new-link-title" className="text-xl font-bold">
          Make a Shared Link
        </h2>
        <p className="mt-1 max-w-prose text-sm text-ink-soft">{SHARED_LINK_WARNING}</p>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <fieldset>
            <legend className="label text-ink">Shared Link to</legend>
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2">
              {SHARE_KINDS.map((kind) => (
                <span key={kind} className="inline-flex items-center gap-1.5">
                  <input
                    id={`share-kind-${kind}`}
                    type="radio"
                    name="share-kind"
                    value={kind}
                    checked={props.kind === kind}
                    onChange={() => props.onKind(kind)}
                  />
                  <label htmlFor={`share-kind-${kind}`}>{KIND_LABEL[kind]}</label>
                </span>
              ))}
            </div>
          </fieldset>
          <LanguageSelect id="share-language" value={props.shareLanguage} onChange={props.onShareLanguage} />
          <button type="button" className="btn-primary px-6 font-bold" disabled={busy} onClick={props.onCreateLink}>
            {busy ? <Spinner label="Working…" /> : 'Make Shared Link'}
          </button>
        </div>
        {props.created && (
          <CreatedLink link={props.created} origin={props.origin} copied={props.copied} onCopy={props.onCopy} />
        )}
      </section>

      <section aria-labelledby="links-title" className="card-1 bg-surface p-4">
        <h2 id="links-title" className="text-xl font-bold">
          Shared Links
        </h2>
        {links.status === 'loading' && <Spinner label="Loading the Shared Links…" />}
        {links.status === 'failed' && <ErrorMessage>{links.message}</ErrorMessage>}
        {links.status === 'loaded' && (
          <LinkList links={links.links} busy={busy} now={props.now} onRevoke={props.onRevoke} />
        )}
      </section>

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

export interface PreviewShareScreenProps {
  auditId: string;
  /** The version to start on; the newest finished one when not given. */
  version?: number;
  /** For tests: the requests. */
  fetchImpl?: Fetch;
  /** For tests: the tool's own address. */
  origin?: string;
}

type Versions =
  { status: 'loading' } | { status: 'failed'; message: string } | { status: 'loaded'; versions: AuditVersion[] };

function browserOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

/** Make and open the improved-homepage preview, and make, list and revoke Shared Links (REQ-024). */
export function PreviewShareScreen({
  auditId,
  version: initialVersion,
  fetchImpl,
  origin = browserOrigin(),
}: PreviewShareScreenProps) {
  const { confirm, dialog } = useConfirm();
  const [versions, setVersions] = useState<Versions>({ status: 'loading' });
  const [version, setVersion] = useState<number>(initialVersion ?? 0);
  const [previewLanguage, setPreviewLanguage] = useState<ShareLanguage>('en');
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [kind, setKind] = useState<ShareLinkKind>('pitch');
  const [shareLanguage, setShareLanguage] = useState<ShareLanguage>('en');
  const [created, setCreated] = useState<ShareLink | null>(null);
  const [copied, setCopied] = useState<PreviewShareViewProps['copied']>('idle');
  const [links, setLinks] = useState<LinksState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ShareMessage>(null);
  useDocumentTitle('Preview and Shared Links');

  useEffect(() => {
    let live = true;
    void (async () => {
      const [loaded, listed] = await Promise.all([
        loadVersion(auditId, undefined, fetchImpl),
        listSharedLinks(auditId, fetchImpl),
      ]);
      if (!live) return;
      if (loaded.ok) {
        const done = versionsOldestFirst(loaded.value.summary).filter((v) => v.status === 'done');
        setVersions({ status: 'loaded', versions: done });
        setVersion((current) =>
          done.some((v) => v.version === current) ? current : (done[done.length - 1]?.version ?? 0)
        );
      } else {
        setVersions({ status: 'failed', message: loaded.message });
      }
      setLinks(
        listed.ok
          ? { status: 'loaded', links: listed.value.reduce<ShareLink[]>(withLink, []) }
          : { status: 'failed', message: listed.message }
      );
    })();
    return () => {
      live = false;
    };
  }, [auditId, fetchImpl]);

  const makePreview = useCallback(async () => {
    setPreview({ status: 'making' });
    const outcome = await createPreview(auditId, version, previewLanguage, fetchImpl);
    setPreview(
      outcome.ok
        ? { status: 'made', createdAt: outcome.value.createdAt }
        : { status: 'failed', message: outcome.message, noAiKey: outcome.code === 'ERR_NO_AI_KEY' }
    );
  }, [auditId, version, previewLanguage, fetchImpl]);

  const createLink = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    setCopied('idle');
    const outcome = await createSharedLink(auditId, { version, kind, language: shareLanguage }, fetchImpl);
    if (outcome.ok) {
      setCreated(outcome.value);
      setLinks((current) =>
        current.status === 'loaded' ? { status: 'loaded', links: withLink(current.links, outcome.value) } : current
      );
    } else {
      setMessage({ tone: 'fail', text: outcome.message });
    }
    setBusy(false);
  }, [auditId, version, kind, shareLanguage, fetchImpl]);

  const copy = useCallback(async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied('copied');
    } catch {
      // Clipboard blocked: the address is in the field to select by hand.
      setCopied('failed');
    }
  }, []);

  const revoke = useCallback(
    async (link: ShareLink) => {
      const outcome = await revokeAfterConfirm(
        () =>
          confirm({
            title: 'Revoke this Shared Link?',
            body: (
              <p>
                {`The Shared Link to the ${KIND_LABEL[link.kind]} stops working at once for anyone holding it. This cannot be undone; you can make a new Shared Link later.`}
              </p>
            ),
            confirmLabel: 'Revoke',
            danger: true,
          }),
        auditId,
        link.id,
        fetchImpl
      );
      if (outcome === null) return;
      if (outcome.ok) {
        setLinks((current) =>
          current.status === 'loaded' ? { status: 'loaded', links: withLink(current.links, outcome.value) } : current
        );
        setCreated((current) => (current?.id === link.id ? null : current));
        setMessage({ tone: 'pass', text: `The Shared Link to the ${KIND_LABEL[link.kind]} is revoked.` });
      } else {
        setMessage({ tone: 'fail', text: outcome.message });
      }
    },
    [auditId, confirm, fetchImpl]
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <FocusHeading className="mb-2 break-words text-question font-bold">Preview and Shared Links</FocusHeading>
      <p className="mb-6">
        <Link to={AUDIT_PATHS.history(auditId)} className="btn-link text-sm">
          Back to this Website Audit
        </Link>
      </p>
      {versions.status === 'loading' && <Spinner label="Loading the Website Audit…" />}
      {versions.status === 'failed' && <ErrorMessage>{versions.message}</ErrorMessage>}
      {versions.status === 'loaded' && (
        <PreviewShareView
          auditId={auditId}
          versions={versions.versions}
          version={version}
          previewLanguage={previewLanguage}
          preview={preview}
          kind={kind}
          shareLanguage={shareLanguage}
          created={created}
          copied={copied}
          links={links}
          busy={busy}
          message={message}
          origin={origin}
          onVersion={(next) => {
            setVersion(next);
            setPreview({ status: 'idle' });
          }}
          onPreviewLanguage={setPreviewLanguage}
          onMakePreview={() => void makePreview()}
          onKind={setKind}
          onShareLanguage={setShareLanguage}
          onCreateLink={() => void createLink()}
          onCopy={(address) => void copy(address)}
          onRevoke={(link) => void revoke(link)}
        />
      )}
      {dialog}
    </div>
  );
}
