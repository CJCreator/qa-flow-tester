import { useCallback, useEffect, useState } from 'react';
import type { AuditSummary } from '@qa/types/src/browser.js';
import { Spinner } from '../../../components/text';
import { EmptyState, LoadError, Page, PageHeader } from '../../../components/ui';
import { count, formatWhen } from '../../../lib/format';
import { Link } from '../../../lib/router';
import { useDocumentTitle } from '../../../lib/title';
import { AUDIT_PATHS, STATUS_LABEL, latestVersion, listAudits, shortlistMarkText, type Fetch } from './saved-api';

export type SavedAuditsLoad =
  { status: 'loading' } | { status: 'failed'; message: string } | { status: 'loaded'; audits: AuditSummary[] };

export interface SavedAuditsViewProps {
  load: SavedAuditsLoad;
  onRetry: () => void;
}

/**
 * The screen's one primary action: start another Website Audit. Left out while the list is empty, where the
 * empty state carries the same action. Shortlist and settings live in the area row above the screen.
 */
export function SavedAuditsActions({ load }: { load: SavedAuditsLoad }) {
  if (load.status === 'loaded' && load.audits.length === 0) return null;
  return (
    <Link to={AUDIT_PATHS.start} className="btn-primary btn-sm">
      Start a Website Audit
    </Link>
  );
}

/** One saved Website Audit: host, address, versions, latest status and Shortlist mark. The whole row opens it. */
function AuditItem({ audit }: { audit: AuditSummary }) {
  const latest = latestVersion(audit);
  // What the latest version holds, so two audits of one address are told apart; left out while it has no counts.
  const sizeText = [
    latest?.pagesRecorded !== undefined ? count(latest.pagesRecorded, 'page', 'pages') : null,
    latest?.findings !== undefined ? count(latest.findings, 'finding', 'findings') : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li
      className="relative rounded-card border border-rule bg-surface p-4 transition-colors duration-fast hover:border-edge focus-within:border-stamp"
      data-audit={audit.auditId}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="break-all text-lg font-bold text-ink">
            <Link
              to={AUDIT_PATHS.history(audit.auditId)}
              className="after:absolute after:inset-0 after:rounded-card hover:underline"
              aria-label={`Open the Website Audit of ${audit.host}`}
            >
              {audit.host}
            </Link>
          </h2>
          <p className="break-all font-mono text-sm text-ink-soft">{audit.url}</p>
          <p className="mt-1 text-sm text-ink">
            {count(audit.versions.length, 'version', 'versions')}
            {latest && ` · Latest: ${STATUS_LABEL[latest.status]}, started ${formatWhen(latest.startedAt)}`}
          </p>
          {sizeText && <p className="text-sm text-ink">{sizeText}</p>}
          {audit.shortlist?.mark && <p className="text-sm text-ink-soft">{shortlistMarkText(audit.shortlist)}</p>}
        </div>
        <span aria-hidden="true" className="mt-1 shrink-0 text-xl text-ink-soft">
          →
        </span>
      </div>
    </li>
  );
}

/** The list as it is shown for a load state; no requests of its own. */
export function SavedAuditsView({ load, onRetry }: SavedAuditsViewProps) {
  return (
    <>
      {load.status === 'loading' && <Spinner label="Loading your Website Audits…" />}
      {load.status === 'failed' && (
        <LoadError title="Your Website Audits could not be loaded" onRetry={onRetry}>
          {load.message}
        </LoadError>
      )}
      {load.status === 'loaded' && load.audits.length === 0 && (
        <EmptyState
          title="No Website Audits yet."
          action={
            <Link to={AUDIT_PATHS.start} className="btn-primary btn-sm">
              Start a Website Audit
            </Link>
          }
        >
          To start one, enter the address of a public website and how many pages to read.
        </EmptyState>
      )}
      {load.status === 'loaded' && load.audits.length > 0 && (
        <ul className="grid gap-3" aria-label="Saved Website Audits">
          {load.audits.map((audit) => (
            <AuditItem key={audit.auditId} audit={audit} />
          ))}
        </ul>
      )}
    </>
  );
}

export interface SavedAuditsScreenProps {
  /** For tests; the browser's fetch otherwise. */
  fetchImpl?: Fetch;
}

/** Every saved Website Audit, each opening its history (REQ-028). */
export function SavedAuditsScreen({ fetchImpl }: SavedAuditsScreenProps = {}) {
  const [load, setLoad] = useState<SavedAuditsLoad>({ status: 'loading' });

  const refresh = useCallback(() => {
    setLoad({ status: 'loading' });
    void listAudits(fetchImpl).then((outcome) =>
      setLoad(outcome.ok ? { status: 'loaded', audits: outcome.value } : { status: 'failed', message: outcome.message })
    );
  }, [fetchImpl]);
  useEffect(refresh, [refresh]);
  useDocumentTitle('Website Audits');

  return (
    <Page width="prose">
      <PageHeader
        title="Website Audits"
        lede="Every Website Audit is kept, with each version, until you delete it."
        actions={<SavedAuditsActions load={load} />}
      />
      <SavedAuditsView load={load} onRetry={refresh} />
    </Page>
  );
}
