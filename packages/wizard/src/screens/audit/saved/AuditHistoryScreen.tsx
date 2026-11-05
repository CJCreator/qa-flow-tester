import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AuditGetReply, AuditSummary, AuditVersion, ShortlistEntry } from '@qa/types/src/browser.js';
import { useConfirm, type ConfirmOptions } from '../../../components/ConfirmDialog';
import { Notice, Spinner } from '../../../components/text';
import { Badge, Disclosure, LoadError, Page, PageHeader } from '../../../components/ui';
import { count, formatWhen } from '../../../lib/format';
import { Link } from '../../../lib/router';
import { useDocumentTitle } from '../../../lib/title';
import { AuditTabs } from '../AuditTabs';
import { loadCallerIsHelper } from './caller-access';
import {
  AUDIT_PATHS,
  STATUS_LABEL,
  deleteAudit,
  followRunningVersion,
  latestFinishedVersion,
  loadVersion,
  rerunAndReload,
  runningVersion,
  shortlistMarkText,
  versionCounts,
  versionsOldestFirst,
  type Fetch,
} from './saved-api';
import type { AuditEventSourceFactory } from '../start/audit-start-api';
import { ShortlistPanel } from './ShortlistPanel';

/** What a delete removes, said before it happens. */
export const DELETE_WARNING =
  'This removes every version, edit, Shortlist entry, Shared Link and Helper access of this Website Audit. It cannot be undone.';

/** The question asked before a Website Audit is deleted. */
export function deleteConfirmOptions(host: string): ConfirmOptions {
  return {
    title: `Delete the Website Audit of ${host}?`,
    body: DELETE_WARNING,
    confirmLabel: 'Delete the Website Audit',
    cancelLabel: 'Keep it',
    danger: true,
  };
}

/** One version opened through `GET /api/audits/:id?version=n`. */
export type OpenedVersion =
  | { status: 'loading'; version: number }
  | { status: 'failed'; version: number; message: string }
  | { status: 'loaded'; version: number; reply: AuditGetReply };

export interface AuditHistoryViewProps {
  summary: AuditSummary;
  opened: OpenedVersion | null;
  rerunning: boolean;
  deleting: boolean;
  /** The outcome of the last re-run or delete. */
  message: { tone: 'pass' | 'fail'; text: string } | null;
  /** Opens a version's details in place, or closes them when that version is already open. */
  onOpen: (version: number) => void;
  onRerun: () => void;
  /** Asks before deleting (the screen shows the confirm dialog). */
  onAskDelete: () => void;
  /** The Shortlist panel; a slot so the view renders without requests. Never shown to a Helper. */
  shortlist?: ReactNode;
  /** The caller is a Helper: the owner's actions (Audit again, Delete, Helpers, Share) are not shown (ADR 0037). */
  isHelper?: boolean | null;
}

/** Details of one opened version, shown in place under its row. */
function OpenedDetails({ auditId, opened }: { auditId: string; opened: OpenedVersion }) {
  const id = `version-${opened.version}-details`;
  return (
    <div id={id} className="mt-4 border-t border-rule pt-4">
      {opened.status === 'loading' && <Spinner label={`Opening version ${opened.version}…`} />}
      {opened.status === 'failed' && (
        <p role="alert" className="text-sm text-fail">
          {opened.message}
        </p>
      )}
      {opened.status === 'loaded' && (
        <>
          <p className="break-all font-mono text-sm text-ink-soft">{opened.reply.version.url}</p>
          <p className="text-sm text-ink">
            {`Status: ${STATUS_LABEL[opened.reply.version.status]} · ${versionCounts(opened.reply.version)}`}
            {opened.reply.version.finishedAt ? ` · Finished ${formatWhen(opened.reply.version.finishedAt)}` : ''}
          </p>
          {opened.reply.version.status === 'done' ? (
            <nav aria-label={`Screens of version ${opened.version}`} className="mt-3 flex flex-wrap gap-3">
              <Link to={AUDIT_PATHS.version(auditId, opened.version)} className="btn-quiet btn-sm">
                See the results
              </Link>
              <Link to={AUDIT_PATHS.review(auditId, opened.version)} className="btn-quiet btn-sm">
                Review the Audit Documents
              </Link>
              <Link to={AUDIT_PATHS.export(auditId, opened.version)} className="btn-quiet btn-sm">
                Download the Audit Documents
              </Link>
            </nav>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">This version has no results to open.</p>
          )}
        </>
      )}
    </div>
  );
}

function VersionItem({
  auditId,
  version,
  opened,
  onOpen,
}: {
  auditId: string;
  version: AuditVersion;
  opened: OpenedVersion | null;
  onOpen: (n: number) => void;
}) {
  const isOpen = opened?.version === version.version;
  return (
    <li className="rounded-card border border-rule bg-surface p-4" data-version={version.version}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-ink">{`Version ${version.version}`}</h3>
          <p className="text-sm text-ink">{`Started ${formatWhen(version.startedAt)} · Status: ${STATUS_LABEL[version.status]}`}</p>
          <p className="text-sm text-ink-soft">{versionCounts(version)}</p>
          {version.edited && <p className="text-sm text-ink-soft">Has edits</p>}
          {version.status === 'failed' && (
            <p className="mt-1 text-sm text-fail">This version stopped before it finished.</p>
          )}
        </div>
        <button
          type="button"
          className="btn-quiet btn-sm"
          aria-label={`${isOpen ? 'Close' : 'Open'} version ${version.version}`}
          aria-expanded={isOpen}
          aria-controls={isOpen ? `version-${version.version}-details` : undefined}
          onClick={() => onOpen(version.version)}
        >
          {isOpen ? 'Close' : 'Open'}
        </button>
      </div>
      {isOpen && opened && <OpenedDetails auditId={auditId} opened={opened} />}
      {version.status === 'failed' && version.error && (
        <Disclosure summary="Details for developers" className="mt-3">
          <p className="break-all font-mono text-sm text-ink-soft">{version.error}</p>
          <p className="mt-1 font-mono text-sm text-ink-soft">{`Audit ${auditId}, version ${version.version}`}</p>
        </Disclosure>
      )}
    </li>
  );
}

/** The history of one Website Audit as shown; no requests of its own (REQ-028 AC-1..AC-3). */
export function AuditHistoryView({
  summary,
  opened,
  rerunning,
  deleting,
  message,
  onOpen,
  onRerun,
  onAskDelete,
  shortlist,
  isHelper = false,
}: AuditHistoryViewProps) {
  // Newest first; owner actions show only once the check has said the caller is not a Helper.
  const versions = versionsOldestFirst(summary).reverse();
  const owner = isHelper === false;
  const latestDone = latestFinishedVersion(summary);
  const running = runningVersion(summary);
  return (
    <div className="grid gap-8">
      <AuditTabs
        auditId={summary.auditId}
        version={latestDone?.version}
        current="history"
        hide={owner ? [] : ['share', 'helpers']}
      />

      <div className="-mt-4 grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {latestDone && (
            <Link to={AUDIT_PATHS.version(summary.auditId, latestDone.version)} className="btn-primary btn-sm">
              Open the results
            </Link>
          )}
          {owner && (
            <>
              <button type="button" className="btn-quiet btn-sm" disabled={rerunning} onClick={onRerun}>
                {rerunning ? 'Starting…' : 'Audit again'}
              </button>
              <button
                type="button"
                className="btn-quiet btn-sm border-fail text-fail hover:border-fail hover:bg-fail-tint"
                aria-label={`Delete the Website Audit of ${summary.host}`}
                disabled={deleting}
                onClick={onAskDelete}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </>
          )}
          {owner && (
            <Badge tone={summary.shortlist?.mark === 'pitch' ? 'stamp' : 'neutral'}>
              {shortlistMarkText(summary.shortlist)}
            </Badge>
          )}
        </div>
        <p className="max-w-prose text-sm text-ink-soft">
          {latestDone && `Version ${latestDone.version} is the latest finished. `}
          {owner && 'Audit again makes a new version with the same address and limits.'}
        </p>
        {message && (
          <Notice tone={message.tone} title={message.tone === 'pass' ? 'Done' : 'That did not work'}>
            {message.text}
          </Notice>
        )}
      </div>

      {running && (
        <Notice tone="stamp" title={`Version ${running.version} is running`}>
          This page updates by itself when it ends.
        </Notice>
      )}

      <section aria-labelledby="versions-title">
        <h2 id="versions-title" className="mb-3 text-xl font-bold">
          {`Versions (${count(versions.length, 'version', 'versions')}, newest first)`}
        </h2>
        {versions.length === 0 ? (
          <p className="text-sm text-ink-soft">This Website Audit has no versions.</p>
        ) : (
          <ol className="grid gap-3">
            {versions.map((version) => (
              <VersionItem
                key={version.version}
                auditId={summary.auditId}
                version={version}
                opened={opened}
                onOpen={onOpen}
              />
            ))}
          </ol>
        )}
      </section>

      {owner && shortlist}
    </div>
  );
}

export interface AuditHistoryScreenProps {
  auditId: string;
  /** For tests; the browser's fetch otherwise. */
  fetchImpl?: Fetch;
  /** For tests: the progress stream. */
  openSource?: AuditEventSourceFactory;
}

type Loaded =
  { status: 'loading' } | { status: 'failed'; message: string } | { status: 'loaded'; summary: AuditSummary };

/** One saved Website Audit: every version, re-run, delete and its Shortlist entry (REQ-028, REQ-023). */
export function AuditHistoryScreen({ auditId, fetchImpl, openSource }: AuditHistoryScreenProps) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [opened, setOpened] = useState<OpenedVersion | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [message, setMessage] = useState<AuditHistoryViewProps['message']>(null);
  const [isHelper, setIsHelper] = useState<boolean | null>(null);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    let live = true;
    void loadCallerIsHelper(fetchImpl).then((helper) => live && setIsHelper(helper));
    return () => {
      live = false;
    };
  }, [fetchImpl]);

  const reload = useCallback(
    (quiet: boolean) => {
      if (!quiet) setLoaded({ status: 'loading' });
      void loadVersion(auditId, undefined, fetchImpl).then((outcome) =>
        setLoaded(
          outcome.ok
            ? { status: 'loaded', summary: outcome.value.summary }
            : { status: 'failed', message: outcome.message }
        )
      );
    },
    [auditId, fetchImpl]
  );
  const refresh = useCallback(() => reload(false), [reload]);
  useEffect(refresh, [refresh]);

  // While a version runs, follow its stream and re-read the history when it ends. The stream closes on unmount.
  const watching = loaded.status === 'loaded' ? runningVersion(loaded.summary)?.version : undefined;
  useEffect(() => {
    if (loaded.status !== 'loaded' || watching === undefined) return;
    return followRunningVersion(loaded.summary, { onEnd: () => reload(true) }, openSource);
    // Re-open only when the running version changes, not on every re-read.
  }, [watching, auditId, openSource, reload]);

  const open = (version: number) => {
    // A second press on the open version closes its details.
    if (opened?.version === version) {
      setOpened(null);
      return;
    }
    setOpened({ status: 'loading', version });
    void loadVersion(auditId, version, fetchImpl).then((outcome) =>
      setOpened((now) =>
        now?.version !== version
          ? now
          : outcome.ok
            ? { status: 'loaded', version, reply: outcome.value }
            : { status: 'failed', version, message: outcome.message }
      )
    );
  };

  const rerun = async () => {
    setRerunning(true);
    setMessage(null);
    const outcome = await rerunAndReload(auditId, fetchImpl);
    if (outcome.ok) {
      const summary = outcome.value.summary;
      if (summary) setLoaded({ status: 'loaded', summary });
      setMessage({ tone: 'pass', text: `Version ${outcome.value.started.version} started. It is listed below.` });
    } else {
      setMessage({ tone: 'fail', text: outcome.message });
    }
    setRerunning(false);
  };

  const remove = async () => {
    setDeleting(true);
    setMessage(null);
    const outcome = await deleteAudit(auditId, fetchImpl);
    setDeleting(false);
    if (outcome.ok) setDeleted(true);
    else setMessage({ tone: 'fail', text: outcome.message });
  };

  const askDelete = async (host: string) => {
    if (await confirm(deleteConfirmOptions(host))) await remove();
  };

  const setShortlist = (entry: ShortlistEntry) =>
    setLoaded((now) =>
      now.status === 'loaded' ? { status: 'loaded', summary: { ...now.summary, shortlist: entry } } : now
    );

  const summary = loaded.status === 'loaded' ? loaded.summary : null;
  useDocumentTitle(summary ? `Website Audit of ${summary.host}` : 'Website Audit');

  return (
    <Page width="workspace">
      <PageHeader
        back={{ to: AUDIT_PATHS.list, label: 'All Website Audits' }}
        meta={summary && <span className="break-all font-mono">{summary.url}</span>}
        title={<span className="break-words">{summary ? `Website Audit of ${summary.host}` : 'Website Audit'}</span>}
      />

      {deleted ? (
        <Notice tone="pass" title="Website Audit deleted">
          Every version, edit, Shortlist entry, Shared Link and Helper access of it is gone.
        </Notice>
      ) : (
        <>
          {loaded.status === 'loading' && <Spinner label="Loading the Website Audit…" />}
          {loaded.status === 'failed' && (
            <LoadError title="This Website Audit could not be loaded" onRetry={refresh}>
              {loaded.message}
            </LoadError>
          )}
          {summary && (
            <AuditHistoryView
              summary={summary}
              opened={opened}
              rerunning={rerunning}
              deleting={deleting}
              message={message}
              onOpen={open}
              onRerun={() => void rerun()}
              onAskDelete={() => void askDelete(summary.host)}
              isHelper={isHelper}
              shortlist={
                <ShortlistPanel
                  auditId={auditId}
                  entry={summary.shortlist ?? null}
                  onSaved={setShortlist}
                  fetchImpl={fetchImpl}
                />
              }
            />
          )}
        </>
      )}
      {dialog}
    </Page>
  );
}
