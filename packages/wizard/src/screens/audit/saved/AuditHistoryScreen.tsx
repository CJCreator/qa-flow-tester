import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AuditGetReply, AuditSummary, AuditVersion, ShortlistEntry } from '@qa/types/src/browser.js';
import { ErrorMessage, FocusHeading, Notice, Spinner } from '../../../components/text';
import { count, formatWhen } from '../../../lib/format';
import { Link } from '../../../lib/router';
import {
  AUDIT_PATHS,
  STATUS_LABEL,
  deleteAudit,
  loadVersion,
  rerunAndReload,
  versionCounts,
  versionsOldestFirst,
  type Fetch,
} from './saved-api';
import { ShortlistPanel } from './ShortlistPanel';

/** What a delete removes, said before it happens. */
export const DELETE_WARNING =
  'This removes every version, edit, Shortlist entry, Shared Link and Helper access of this Website Audit. It cannot be undone.';

/** One version opened through `GET /api/audits/:id?version=n`. */
export type OpenedVersion =
  | { status: 'loading'; version: number }
  | { status: 'failed'; version: number; message: string }
  | { status: 'loaded'; version: number; reply: AuditGetReply };

export interface AuditHistoryViewProps {
  summary: AuditSummary;
  opened: OpenedVersion | null;
  rerunning: boolean;
  confirmingDelete: boolean;
  deleting: boolean;
  /** The outcome of the last re-run or delete. */
  message: { tone: 'pass' | 'fail'; text: string } | null;
  onOpen: (version: number) => void;
  onRerun: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  /** The Shortlist panel; a slot so the view renders without requests. */
  shortlist?: ReactNode;
}

function VersionItem({
  version,
  isOpen,
  onOpen,
}: {
  version: AuditVersion;
  isOpen: boolean;
  onOpen: (n: number) => void;
}) {
  return (
    <li className="rounded-lg border border-edge bg-surface p-4" data-version={version.version}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="font-bold text-ink">{`Version ${version.version}`}</h3>
          <p className="text-sm text-ink">{`Started ${formatWhen(version.startedAt)} · Status: ${STATUS_LABEL[version.status]}`}</p>
          <p className="text-sm text-ink-soft">{versionCounts(version)}</p>
          {version.edited && <p className="text-sm text-ink-soft">Has edits</p>}
          {version.status === 'failed' && version.error && (
            <p className="text-sm text-fail">{`Failed: ${version.error}`}</p>
          )}
        </div>
        <button
          type="button"
          className="btn-quiet min-h-[44px] px-4 text-sm"
          aria-label={`Open version ${version.version}`}
          aria-pressed={isOpen}
          onClick={() => onOpen(version.version)}
        >
          Open
        </button>
      </div>
    </li>
  );
}

function OpenedPanel({ auditId, opened }: { auditId: string; opened: OpenedVersion }) {
  return (
    <section aria-labelledby="opened-version-title" className="rounded-lg border border-rule p-4">
      <h2 id="opened-version-title" className="text-xl font-bold">{`Version ${opened.version}`}</h2>
      {opened.status === 'loading' && <Spinner label={`Opening version ${opened.version}…`} />}
      {opened.status === 'failed' && <ErrorMessage>{opened.message}</ErrorMessage>}
      {opened.status === 'loaded' && (
        <>
          <p className="break-all text-sm text-ink-soft">{opened.reply.version.url}</p>
          <p className="text-sm text-ink">
            {`Status: ${STATUS_LABEL[opened.reply.version.status]} · ${versionCounts(opened.reply.version)}`}
            {opened.reply.version.finishedAt ? ` · Finished ${formatWhen(opened.reply.version.finishedAt)}` : ''}
          </p>
          {opened.reply.version.status === 'done' ? (
            <nav aria-label={`Screens of version ${opened.version}`} className="mt-3 flex flex-wrap gap-3">
              <Link to={AUDIT_PATHS.version(auditId, opened.version)} className="btn-primary min-h-[44px] px-4 text-sm">
                See the results
              </Link>
              <Link to={AUDIT_PATHS.review(auditId, opened.version)} className="btn-quiet min-h-[44px] px-4 text-sm">
                Review the Audit Documents
              </Link>
              <Link to={AUDIT_PATHS.export(auditId, opened.version)} className="btn-quiet min-h-[44px] px-4 text-sm">
                Export the Audit Documents
              </Link>
            </nav>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">This version has no results to open.</p>
          )}
        </>
      )}
    </section>
  );
}

/** The history of one Website Audit as shown; no requests of its own (REQ-028 AC-1..AC-3). */
export function AuditHistoryView({
  summary,
  opened,
  rerunning,
  confirmingDelete,
  deleting,
  message,
  onOpen,
  onRerun,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
  shortlist,
}: AuditHistoryViewProps) {
  const versions = versionsOldestFirst(summary);
  return (
    <div className="space-y-8">
      <div>
        <p className="break-all text-ink-soft">{summary.url}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-primary min-h-[44px] px-4 text-sm"
            disabled={rerunning}
            onClick={onRerun}
          >
            {rerunning ? 'Starting…' : 'Re-run'}
          </button>
          <Link to={AUDIT_PATHS.previewShare(summary.auditId)} className="btn-quiet min-h-[44px] px-4 text-sm">
            Preview and Shared Links
          </Link>
          <Link to={AUDIT_PATHS.helpers(summary.auditId)} className="btn-quiet min-h-[44px] px-4 text-sm">
            Helpers
          </Link>
          <button
            type="button"
            className="btn-quiet min-h-[44px] border-fail px-4 text-sm text-fail hover:border-fail hover:bg-fail-tint"
            aria-label={`Delete the Website Audit of ${summary.host}`}
            onClick={onAskDelete}
          >
            Delete
          </button>
        </div>
        <p className="mt-2 max-w-prose text-sm text-ink-soft">
          Re-run makes a new version with the same address and limits.
        </p>
      </div>

      {confirmingDelete && (
        <section
          role="alertdialog"
          aria-labelledby="delete-audit-title"
          aria-describedby="delete-audit-body"
          className="rounded-md border-l-4 border-fail bg-fail-tint px-4 py-3"
        >
          <h2 id="delete-audit-title" className="font-bold text-fail">
            {`Delete the Website Audit of ${summary.host}?`}
          </h2>
          <p id="delete-audit-body" className="mt-1 text-sm text-ink">
            {DELETE_WARNING}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              className="btn-quiet min-h-[44px] border-fail px-4 text-sm text-fail"
              disabled={deleting}
              onClick={onConfirmDelete}
            >
              {deleting ? 'Deleting…' : 'Delete the Website Audit'}
            </button>
            <button
              type="button"
              className="btn-quiet min-h-[44px] px-4 text-sm"
              disabled={deleting}
              onClick={onCancelDelete}
            >
              Keep it
            </button>
          </div>
        </section>
      )}

      {message && (
        <Notice tone={message.tone} title={message.tone === 'pass' ? 'Done' : 'That did not work'}>
          {message.text}
        </Notice>
      )}

      <section aria-labelledby="versions-title">
        <h2 id="versions-title" className="mb-3 text-xl font-bold">
          {`Versions (${count(versions.length, 'version', 'versions')}, oldest first)`}
        </h2>
        {versions.length === 0 ? (
          <p className="text-sm text-ink-soft">This Website Audit has no versions.</p>
        ) : (
          <ol className="space-y-3">
            {versions.map((version) => (
              <VersionItem
                key={version.version}
                version={version}
                isOpen={opened?.version === version.version}
                onOpen={onOpen}
              />
            ))}
          </ol>
        )}
      </section>

      {opened && <OpenedPanel auditId={summary.auditId} opened={opened} />}

      {shortlist}
    </div>
  );
}

export interface AuditHistoryScreenProps {
  auditId: string;
  /** For tests; the browser's fetch otherwise. */
  fetchImpl?: Fetch;
}

type Loaded =
  { status: 'loading' } | { status: 'failed'; message: string } | { status: 'loaded'; summary: AuditSummary };

/** One saved Website Audit: every version, re-run, delete and its Shortlist entry (REQ-028, REQ-023). */
export function AuditHistoryScreen({ auditId, fetchImpl }: AuditHistoryScreenProps) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [opened, setOpened] = useState<OpenedVersion | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [message, setMessage] = useState<AuditHistoryViewProps['message']>(null);

  const refresh = useCallback(() => {
    setLoaded({ status: 'loading' });
    void loadVersion(auditId, undefined, fetchImpl).then((outcome) =>
      setLoaded(
        outcome.ok
          ? { status: 'loaded', summary: outcome.value.summary }
          : { status: 'failed', message: outcome.message }
      )
    );
  }, [auditId, fetchImpl]);
  useEffect(refresh, [refresh]);

  const open = (version: number) => {
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
    setConfirmingDelete(false);
    if (outcome.ok) setDeleted(true);
    else setMessage({ tone: 'fail', text: outcome.message });
  };

  const setShortlist = (entry: ShortlistEntry) =>
    setLoaded((now) =>
      now.status === 'loaded' ? { status: 'loaded', summary: { ...now.summary, shortlist: entry } } : now
    );

  const summary = loaded.status === 'loaded' ? loaded.summary : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <FocusHeading className="mb-2 break-words text-question font-bold">
        {summary ? `Website Audit of ${summary.host}` : 'Website Audit'}
      </FocusHeading>
      <p className="mb-6">
        <Link to={AUDIT_PATHS.list} className="btn-link text-sm">
          All saved Website Audits
        </Link>
      </p>

      {deleted ? (
        <Notice tone="pass" title="Website Audit deleted">
          Every version, edit, Shortlist entry, Shared Link and Helper access of it is gone.
        </Notice>
      ) : (
        <>
          {loaded.status === 'loading' && <Spinner label="Loading the Website Audit…" />}
          {loaded.status === 'failed' && (
            <>
              <ErrorMessage>{loaded.message}</ErrorMessage>
              <button type="button" className="btn-quiet mt-3" onClick={refresh}>
                Retry
              </button>
            </>
          )}
          {summary && (
            <AuditHistoryView
              summary={summary}
              opened={opened}
              rerunning={rerunning}
              confirmingDelete={confirmingDelete}
              deleting={deleting}
              message={message}
              onOpen={open}
              onRerun={() => void rerun()}
              onAskDelete={() => setConfirmingDelete(true)}
              onCancelDelete={() => setConfirmingDelete(false)}
              onConfirmDelete={() => void remove()}
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
    </div>
  );
}
