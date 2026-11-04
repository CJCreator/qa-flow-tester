import { useCallback, useEffect, useState } from 'react';
import type { AuditSummary } from '@qa/types/src/browser.js';
import { ErrorMessage, FocusHeading, Spinner } from '../../../components/text';
import { count, formatWhen } from '../../../lib/format';
import { Link } from '../../../lib/router';
import { AUDIT_PATHS, STATUS_LABEL, latestVersion, listAudits, shortlistMarkText, type Fetch } from './saved-api';

export type SavedAuditsLoad =
  { status: 'loading' } | { status: 'failed'; message: string } | { status: 'loaded'; audits: AuditSummary[] };

export interface SavedAuditsViewProps {
  load: SavedAuditsLoad;
  onRetry: () => void;
}

/** One saved Website Audit: host, address, versions, latest status and Shortlist mark. */
function AuditItem({ audit }: { audit: AuditSummary }) {
  const latest = latestVersion(audit);
  return (
    <li className="rounded-lg border border-edge bg-surface p-4" data-audit={audit.auditId}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="break-all text-lg font-bold text-ink">{audit.host}</h2>
          <p className="break-all text-sm text-ink-soft">{audit.url}</p>
          <p className="text-sm text-ink">
            {count(audit.versions.length, 'version', 'versions')}
            {latest && ` · Latest: ${STATUS_LABEL[latest.status]}, started ${formatWhen(latest.startedAt)}`}
          </p>
          <p className="text-sm text-ink-soft">{shortlistMarkText(audit.shortlist)}</p>
        </div>
        <Link
          to={AUDIT_PATHS.history(audit.auditId)}
          className="btn-primary min-h-[44px] px-4 text-sm"
          aria-label={`Open the Website Audit of ${audit.host}`}
        >
          Open
        </Link>
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
        <>
          <ErrorMessage>{load.message}</ErrorMessage>
          <button type="button" className="btn-quiet mt-3" onClick={onRetry}>
            Retry
          </button>
        </>
      )}
      {load.status === 'loaded' && load.audits.length === 0 && (
        <div className="rounded-lg border border-rule bg-surface p-6">
          <p className="mb-4 font-bold">No Website Audits yet.</p>
          <p className="mb-4 max-w-prose text-ink-soft">
            To start one, enter the address of a public website and how many pages to read.
          </p>
          <Link to={AUDIT_PATHS.start} className="btn-primary">
            Start a Website Audit
          </Link>
        </div>
      )}
      {load.status === 'loaded' && load.audits.length > 0 && (
        <ul className="space-y-3" aria-label="Saved Website Audits">
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

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <FocusHeading className="mb-2 text-question font-bold">Saved Website Audits</FocusHeading>
      <p className="mb-6 max-w-prose text-ink-soft">
        Every Website Audit is kept, with each version, until you delete it.{' '}
        <Link to={AUDIT_PATHS.shortlist} className="btn-link">
          Open the Shortlist
        </Link>
      </p>
      <SavedAuditsView load={load} onRetry={refresh} />
    </div>
  );
}
