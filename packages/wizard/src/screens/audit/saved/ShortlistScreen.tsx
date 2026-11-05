import { useCallback, useEffect, useState } from 'react';
import { SHORTLIST_OUTCOMES, type ShortlistListItem } from '@qa/types/src/browser.js';
import { Spinner } from '../../../components/text';
import { EmptyState, LoadError, Page, PageHeader } from '../../../components/ui';
import { formatWhen } from '../../../lib/format';
import { Link } from '../../../lib/router';
import { useDocumentTitle } from '../../../lib/title';
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

/** One Website Audit on the Shortlist. The whole row opens it. */
function ShortlistRow({ item }: { item: ShortlistListItem }) {
  return (
    <li
      className="relative rounded-card border border-rule bg-surface p-4 transition-colors duration-fast hover:border-edge focus-within:border-stamp"
      data-audit={item.auditId}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="break-all text-lg font-bold text-ink">
            <Link
              to={AUDIT_PATHS.history(item.auditId)}
              className="after:absolute after:inset-0 after:rounded-card hover:underline"
              aria-label={`Open the Website Audit of ${item.host}`}
            >
              {item.host}
            </Link>
          </h2>
          <p className="break-all font-mono text-sm text-ink-soft">{item.url}</p>
          <p className="mt-1 text-sm text-ink">
            {`Mark: ${item.mark ? MARK_LABEL[item.mark] : 'none'} · Outcome: ${item.outcome ?? 'none yet'}`}
          </p>
          {item.notes.trim() !== '' && (
            <p className="whitespace-pre-wrap break-words text-sm text-ink">{`Notes: ${item.notes}`}</p>
          )}
          {item.outcomeNote.trim() !== '' && (
            <p className="whitespace-pre-wrap break-words text-sm text-ink-soft">{`Outcome note: ${item.outcomeNote}`}</p>
          )}
          <p className="text-xs text-ink-soft">{`Last changed ${formatWhen(item.updatedAt)}`}</p>
        </div>
        <span aria-hidden="true" className="mt-1 shrink-0 text-xl text-ink-soft">
          →
        </span>
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
      <div className="mb-6 grid gap-4 sm:flex sm:flex-wrap sm:gap-6">
        <div>
          <label htmlFor="shortlist-filter-mark" className="label text-ink">
            Mark
          </label>
          <select
            id="shortlist-filter-mark"
            className="field min-h-[44px] py-2 text-sm"
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
            className="field min-h-[44px] py-2 text-sm"
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
        <LoadError title="The Shortlist could not be loaded" onRetry={onRetry}>
          {load.message}
        </LoadError>
      )}
      {load.status === 'loaded' &&
        items.length === 0 &&
        (filtered ? (
          <EmptyState
            title="No Website Audit on the Shortlist matches these filters."
            action={
              <button
                type="button"
                className="btn-quiet btn-sm"
                onClick={() => onFilters({ mark: 'all', outcome: 'all' })}
              >
                Show every mark and outcome
              </button>
            }
          />
        ) : (
          <EmptyState
            title="The Shortlist is empty."
            action={
              <Link to={AUDIT_PATHS.list} className="btn-primary btn-sm">
                See your Website Audits
              </Link>
            }
          >
            Open a saved Website Audit and mark it pitch or skip to add it.
          </EmptyState>
        ))}
      {items.length > 0 && (
        <ul className="grid gap-3" aria-label="Shortlist">
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
  useDocumentTitle('Shortlist');

  return (
    <Page width="prose">
      <PageHeader title="Shortlist" lede="The Website Audits you marked pitch or skip, with their notes and outcome." />
      <ShortlistView filters={filters} load={load} onFilters={setFilters} onRetry={() => void refresh()} />
    </Page>
  );
}
