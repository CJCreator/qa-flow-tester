import { useCallback, useEffect, useState } from 'react';
import { SHORTLIST_OUTCOMES, type ShortlistListItem } from '@qa/types/src/browser.js';
import { ErrorMessage, FocusHeading, Spinner } from '../../../components/text';
import { formatWhen } from '../../../lib/format';
import { Link } from '../../../lib/router';
import {
  AUDIT_PATHS,
  MARK_LABEL,
  SHORTLIST_MARKS,
  filterShortlist,
  filtersToQuery,
  listShortlist,
  readMarkFilter,
  readOutcomeFilter,
  type Fetch,
  type ShortlistFilters,
} from './saved-api';

export type ShortlistLoad =
  { status: 'loading' } | { status: 'failed'; message: string } | { status: 'loaded'; items: ShortlistListItem[] };

export interface ShortlistViewProps {
  filters: ShortlistFilters;
  load: ShortlistLoad;
  onFilters: (filters: ShortlistFilters) => void;
  onRetry: () => void;
}

function ShortlistRow({ item }: { item: ShortlistListItem }) {
  return (
    <li className="rounded-lg border border-edge bg-surface p-4" data-audit={item.auditId}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="break-all text-lg font-bold text-ink">{item.host}</h2>
          <p className="break-all text-sm text-ink-soft">{item.url}</p>
          <p className="text-sm text-ink">
            {`Mark: ${item.mark ? MARK_LABEL[item.mark] : 'none'} · Outcome: ${item.outcome ?? 'none yet'}`}
          </p>
          {item.notes.trim() !== '' && <p className="whitespace-pre-wrap text-sm text-ink">{`Notes: ${item.notes}`}</p>}
          {item.outcomeNote.trim() !== '' && (
            <p className="whitespace-pre-wrap text-sm text-ink-soft">{`Outcome note: ${item.outcomeNote}`}</p>
          )}
          <p className="text-xs text-ink-soft">{`Last changed ${formatWhen(item.updatedAt)}`}</p>
        </div>
        <Link
          to={AUDIT_PATHS.history(item.auditId)}
          className="btn-primary min-h-[44px] px-4 text-sm"
          aria-label={`Open the Website Audit of ${item.host}`}
        >
          Open
        </Link>
      </div>
    </li>
  );
}

/** The filters and the filtered Shortlist; no requests of its own (REQ-023 AC-3). */
export function ShortlistView({ filters, load, onFilters, onRetry }: ShortlistViewProps) {
  const filtered = filters.mark !== 'all' || filters.outcome !== 'all';
  const items = load.status === 'loaded' ? filterShortlist(load.items, filters) : [];
  return (
    <>
      <div className="mb-6 flex flex-wrap gap-6">
        <div>
          <label htmlFor="shortlist-filter-mark" className="label text-ink">
            Mark
          </label>
          <select
            id="shortlist-filter-mark"
            className="field py-2 text-sm"
            value={filters.mark}
            onChange={(e) => onFilters({ ...filters, mark: readMarkFilter(e.target.value) })}
          >
            <option value="all">Every mark</option>
            {SHORTLIST_MARKS.map((mark) => (
              <option key={mark} value={mark}>
                {MARK_LABEL[mark]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="shortlist-filter-outcome" className="label text-ink">
            Outcome
          </label>
          <select
            id="shortlist-filter-outcome"
            className="field py-2 text-sm"
            value={filters.outcome}
            onChange={(e) => onFilters({ ...filters, outcome: readOutcomeFilter(e.target.value) })}
          >
            <option value="all">Every outcome</option>
            {SHORTLIST_OUTCOMES.map((outcome) => (
              <option key={outcome} value={outcome}>
                {outcome}
              </option>
            ))}
          </select>
        </div>
      </div>

      {load.status === 'loading' && <Spinner label="Loading the Shortlist…" />}
      {load.status === 'failed' && (
        <>
          <ErrorMessage>{load.message}</ErrorMessage>
          <button type="button" className="btn-quiet mt-3" onClick={onRetry}>
            Retry
          </button>
        </>
      )}
      {load.status === 'loaded' && items.length === 0 && (
        <p className="rounded-lg border border-rule bg-surface p-6 text-ink-soft">
          {filtered
            ? 'No Website Audit on the Shortlist matches these filters.'
            : 'The Shortlist is empty. Open a saved Website Audit and mark it pitch or skip to add it.'}
        </p>
      )}
      {items.length > 0 && (
        <ul className="space-y-3" aria-label="Shortlist">
          {items.map((item) => (
            <ShortlistRow key={item.auditId} item={item} />
          ))}
        </ul>
      )}
    </>
  );
}

export interface ShortlistScreenProps {
  /** For tests; the browser's fetch otherwise. */
  fetchImpl?: Fetch;
}

/** The Shortlist of Website Audits, filtered by mark and outcome through `GET /api/shortlist` (REQ-023). */
export function ShortlistScreen({ fetchImpl }: ShortlistScreenProps = {}) {
  const [filters, setFilters] = useState<ShortlistFilters>({ mark: 'all', outcome: 'all' });
  const [load, setLoad] = useState<ShortlistLoad>({ status: 'loading' });

  const refresh = useCallback(() => {
    let current = true;
    setLoad({ status: 'loading' });
    void listShortlist(filtersToQuery(filters), fetchImpl).then((outcome) => {
      if (!current) return;
      setLoad(outcome.ok ? { status: 'loaded', items: outcome.value } : { status: 'failed', message: outcome.message });
    });
    return () => {
      current = false;
    };
  }, [filters, fetchImpl]);
  useEffect(refresh, [refresh]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <FocusHeading className="mb-2 text-question font-bold">Shortlist</FocusHeading>
      <p className="mb-6 max-w-prose text-ink-soft">
        The Website Audits you marked pitch or skip, with their notes and outcome.{' '}
        <Link to={AUDIT_PATHS.list} className="btn-link">
          All saved Website Audits
        </Link>
      </p>
      <ShortlistView filters={filters} load={load} onFilters={setFilters} onRetry={() => void refresh()} />
    </div>
  );
}
