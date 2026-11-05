import { useCallback, useEffect, useRef, useState } from 'react';
import type { FindingSeverity, RunSummary } from '@qa/types';
import { deleteRun, listRuns, RunnerError } from '../api';
import type { ConfirmOptions } from '../components/ConfirmDialog';
import { ErrorMessage, Spinner } from '../components/text';
import { Badge, EmptyState, LoadError, Page, PageHeader } from '../components/ui';
import { neighbourAfterDelete } from '../lib/checkup-focus';
import { count, formatDay, formatWhen } from '../lib/format';
import { Link, PATHS } from '../lib/router';
import { useDocumentTitle } from '../lib/title';

const COUNT_WORDS: Array<[FindingSeverity, string, string]> = [
  ['Blocker', 'blocks release', 'block release'],
  ['Major', 'major', 'major'],
  ['Minor', 'minor', 'minor'],
  ['Suggestion', 'suggestion', 'suggestions'],
];

const STARTING_REASON = 'A check-up is already running.';

/** "2 block release · 3 minor", or "No problems". */
function countsLine(counts: RunSummary['counts']): string {
  const parts = COUNT_WORDS.filter(([s]) => counts[s] > 0).map(
    ([s, one, many]) => `${counts[s]} ${counts[s] === 1 ? one : many}`
  );
  return parts.length ? parts.join(' · ') : 'No problems';
}

/**
 * Every check-up kept on this computer, by site, newest first: the last ten of each site. Each can
 * be opened, tested again or deleted (which asks first).
 */
export function PastCheckupsScreen({
  confirm,
  onTestAgain,
  starting,
  actionError,
}: {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  onTestAgain: (run: RunSummary) => void;
  starting: boolean;
  actionError: string | null;
}) {
  useDocumentTitle('Past check-ups');
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Where focus goes after a delete: a check-up id, '' for the page heading, or null for nothing pending.
  const pendingFocus = useRef<string | null>(null);

  const load = useCallback(() => {
    listRuns()
      .then((list) => {
        setRuns(list);
        setError(null);
      })
      .catch((err) =>
        setError(err instanceof RunnerError ? err.message : 'Couldn’t list your past check-ups. Try again.')
      );
  }, []);
  useEffect(load, [load]);

  // After a delete the row is gone, so focus moves to the next row of the site, else to the heading.
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    const row = target
      ? Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-run-id]') ?? []).find(
          (el) => el.dataset.runId === target
        )
      : undefined;
    if (row) row.querySelector<HTMLElement>('a')?.focus();
    else document.querySelector<HTMLElement>('h1')?.focus();
  }, [runs]);

  const remove = async (run: RunSummary) => {
    const ok = await confirm({
      title: 'Delete this check-up?',
      body: (
        <p>
          The report of {run.host} from {formatWhen(run.timestamp)}, with its screenshots, is deleted. This can’t be
          undone. The site’s grade history is kept.
        </p>
      ),
      confirmLabel: 'Delete the check-up',
      danger: true,
    });
    if (!ok) return;
    pendingFocus.current = neighbourAfterDelete(runs ?? [], run.runId) ?? '';
    try {
      await deleteRun(run.runId);
      setRuns((list) => list?.filter((r) => r.runId !== run.runId) ?? null);
    } catch (err) {
      pendingFocus.current = null;
      setError(err instanceof RunnerError ? err.message : 'The check-up couldn’t be deleted. Try again.');
    }
  };

  const sites = runs ? [...new Set(runs.map((r) => r.host))] : [];

  return (
    <Page width="workspace">
      <PageHeader
        title="Past check-ups"
        lede="The last ten check-ups of each site are kept. Older ones are deleted by themselves."
        actions={
          <Link to={PATHS.new} className="btn-primary">
            New check-up
          </Link>
        }
      />

      {error && !runs ? (
        <LoadError title="Your past check-ups couldn’t be loaded" onRetry={load}>
          {error}
        </LoadError>
      ) : (
        error && <ErrorMessage>{error}</ErrorMessage>
      )}
      {actionError && <ErrorMessage>{actionError}</ErrorMessage>}

      {!runs && !error && <Spinner label="Loading your check-ups…" />}

      {runs && runs.length > 0 && starting && (
        <p role="status" className="mb-4 text-sm text-ink-soft">
          {STARTING_REASON}
        </p>
      )}

      {runs && runs.length === 0 && (
        <EmptyState
          title="No check-ups yet."
          action={
            <Link to={PATHS.new} className="btn-primary">
              Start a new check-up
            </Link>
          }
        >
          Each check-up you run is kept here, with its report.
        </EmptyState>
      )}

      <div className="space-y-10" ref={listRef}>
        {sites.map((site) => {
          const ofSite = runs!.filter((r) => r.host === site);
          return (
            <section key={site} aria-labelledby={`site-${site}`}>
              <h2 id={`site-${site}`} className="mb-3 break-all text-xl font-bold">
                {site}{' '}
                <span className="text-base font-normal text-ink-soft">
                  ({count(ofSite.length, 'check-up', 'check-ups')})
                </span>
              </h2>
              <ul className="space-y-3">
                {ofSite.map((run) => (
                  <li key={run.runId} data-run-id={run.runId} className="rounded-card border border-rule bg-surface p-4">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <Link
                          to={PATHS.report(run.runId)}
                          className="inline-flex min-h-[44px] items-center font-bold text-ink underline decoration-edge underline-offset-4 hover:decoration-stamp"
                          aria-label={`Open the check-up of ${run.host} from ${formatWhen(run.timestamp)}`}
                        >
                          {formatWhen(run.timestamp)}
                        </Link>
                        <p className="mt-1">
                          <Badge tone={run.ready ? 'pass' : 'fail'}>{run.stamp}</Badge>
                        </p>
                        <p className="mt-1 text-sm text-ink-soft">
                          {countsLine(run.counts)}
                          {run.readOnly ? ' · only looked at' : ''}
                        </p>
                        {run.testedWithApprovedPlan && (
                          <p className="text-sm text-ink-soft">
                            Tested with the plan you approved on {formatDay(run.testedWithApprovedPlan)}.
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="btn-quiet btn-sm min-h-[44px]"
                          disabled={starting}
                          title={starting ? STARTING_REASON : undefined}
                          onClick={() => onTestAgain(run)}
                          aria-label={`New check-up of this site, ${run.host}`}
                        >
                          New check-up of this site
                        </button>
                        <button
                          type="button"
                          className="btn-quiet btn-sm min-h-[44px] border-fail text-fail hover:border-fail hover:bg-fail-tint"
                          onClick={() => void remove(run)}
                          aria-label={`Delete the check-up of ${run.host} from ${formatWhen(run.timestamp)}`}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Page>
  );
}
