import { useCallback, useEffect, useRef, useState } from 'react';
import type { FindingSeverity, RunSummary } from '@qa/types';
import { deleteRun, listRuns, plainError } from '../api';
import type { ConfirmOptions } from '../components/ConfirmDialog';
import { ErrorMessage, Question, Spinner } from '../components/text';
import { count, formatDay, formatWhen } from '../lib/format';
import { Link, PATHS } from '../lib/router';
import { useDocumentTitle } from '../lib/title';

const COUNT_WORDS: Array<[FindingSeverity, string, string]> = [
  ['Blocker', 'blocks release', 'block release'],
  ['Major', 'major', 'major'],
  ['Minor', 'minor', 'minor'],
  ['Suggestion', 'suggestion', 'suggestions'],
];

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
  // After a delete, focus goes to the next check-up's Delete (or the new check-up link when none is left).
  const focusAfterDelete = useRef<string | null>(null);

  const load = useCallback(() => {
    listRuns()
      .then((list) => {
        setRuns(list);
        setError(null);
      })
      .catch((err) => setError(plainError(err, 'Couldn’t list your past check-ups. Try again.')));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    const target = focusAfterDelete.current;
    if (target === null) return;
    focusAfterDelete.current = null;
    const button = [...document.querySelectorAll<HTMLElement>('[data-delete-run]')].find(
      (el) => el.dataset.deleteRun === target
    );
    (button ?? document.querySelector<HTMLElement>('[data-new-checkup]'))?.focus();
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
    // The next check-up of the same site, else the first one left anywhere.
    const siblings = (runs ?? []).filter((r) => r.host === run.host);
    const at = siblings.findIndex((r) => r.runId === run.runId);
    const next = siblings[at + 1] ?? siblings[at - 1] ?? (runs ?? []).find((r) => r.runId !== run.runId);
    try {
      await deleteRun(run.runId);
      focusAfterDelete.current = next?.runId ?? '';
      setRuns((list) => list?.filter((r) => r.runId !== run.runId) ?? null);
    } catch (err) {
      setError(plainError(err, 'The check-up couldn’t be deleted. Try again.'));
    }
  };

  const sites = runs ? [...new Set(runs.map((r) => r.host))] : [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <Question>Past check-ups</Question>
      <p className="mb-8 max-w-prose text-ink-soft">
        The last ten check-ups of each site are kept. Older ones are deleted by themselves.
      </p>

      {error && <ErrorMessage>{error}</ErrorMessage>}
      {error && !runs && (
        <button type="button" className="btn-quiet mt-3" onClick={load}>
          Retry
        </button>
      )}
      {actionError && <ErrorMessage>{actionError}</ErrorMessage>}

      {!runs && !error && <Spinner label="Loading your check-ups…" />}

      {runs && runs.length === 0 && (
        <div className="rounded-lg border border-rule bg-surface p-6">
          <p className="mb-4 font-bold">No check-ups yet.</p>
          <Link to={PATHS.new} className="btn-primary" data-new-checkup="">
            Start a new check-up
          </Link>
        </div>
      )}

      <div className="space-y-10">
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
                  <li key={run.runId} className="rounded-lg border border-edge bg-surface p-4">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <p className="font-bold text-ink">{formatWhen(run.timestamp)}</p>
                        <p className={`font-bold ${run.ready ? 'text-pass' : 'text-fail'}`}>{run.stamp}</p>
                        <p className="text-sm text-ink-soft">
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
                        <Link
                          to={PATHS.report(run.runId)}
                          className="btn-primary min-h-[44px] px-4 text-sm"
                          aria-label={`Open the check-up of ${run.host} from ${formatWhen(run.timestamp)}`}
                        >
                          Open
                        </Link>
                        <button
                          type="button"
                          className="btn-quiet min-h-[44px] px-4 text-sm"
                          disabled={starting}
                          onClick={() => onTestAgain(run)}
                          aria-label={`New check-up of ${run.host}`}
                        >
                          New check-up of this site
                        </button>
                        <button
                          type="button"
                          className="btn-quiet min-h-[44px] border-fail px-4 text-sm text-fail hover:border-fail hover:bg-fail-tint"
                          data-delete-run={run.runId}
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
    </div>
  );
}
