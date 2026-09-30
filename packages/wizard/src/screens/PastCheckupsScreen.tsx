import { useMemo, useState } from 'react';
import type { RunSummary } from '@qa/types';
import { deleteRun, RunnerError } from '../api';
import type { ConfirmOptions } from '../components/ConfirmDialog';
import { ErrorMessage, Question, Spinner } from '../components/text';
import { Link, PATHS, useTitle } from '../lib/router';
import { formatWhen } from './NewCheckupScreen';

function countsSentence(run: RunSummary): string {
  const mustFix = run.counts.Blocker + run.counts.Major;
  const parts = [
    mustFix > 0 && `${mustFix} must fix`,
    run.counts.Minor > 0 && `${run.counts.Minor} should fix`,
    run.counts.Suggestion > 0 && `${run.counts.Suggestion} ${run.counts.Suggestion === 1 ? 'suggestion' : 'suggestions'}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'No problems';
}

/**
 * /reports: every check-up kept on this computer, by site, newest first. The last 10 of each site
 * are kept; any of them can be deleted here.
 */
export function PastCheckupsScreen({
  runs,
  error,
  confirm,
  onDeleted,
  onTestAgain,
  busy,
}: {
  runs: RunSummary[] | null;
  error: string | null;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  onDeleted: (runId: string) => void;
  onTestAgain: (run: RunSummary) => Promise<string | null>;
  /** A check-up is in progress, so another can't start. */
  busy: boolean;
}) {
  useTitle('Past check-ups');
  const [working, setWorking] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Sites in the order of their newest check-up.
  const sites = useMemo(() => {
    const bySite = new Map<string, RunSummary[]>();
    for (const run of runs || []) bySite.set(run.host, [...(bySite.get(run.host) || []), run]);
    return [...bySite.entries()];
  }, [runs]);

  const remove = async (run: RunSummary) => {
    const ok = await confirm({
      title: 'Delete this check-up?',
      body: `The report of ${run.host} from ${formatWhen(run.timestamp)} and its screenshots are deleted from this computer. The site’s grade history is kept.`,
      confirmLabel: 'Delete it',
      cancelLabel: 'Keep it',
      danger: true,
    });
    if (!ok) return;
    setActionError(null);
    setWorking(`delete:${run.runId}`);
    try {
      await deleteRun(run.runId);
      onDeleted(run.runId);
    } catch (err) {
      setActionError(err instanceof RunnerError ? err.message : 'The check-up couldn’t be deleted. Try again.');
    } finally {
      setWorking(null);
    }
  };

  const again = async (run: RunSummary) => {
    setActionError(null);
    setWorking(`again:${run.runId}`);
    try {
      const failure = await onTestAgain(run);
      if (failure) setActionError(failure);
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <Question>Past check-ups</Question>
      <p className="mb-8 max-w-prose text-ink-soft">The last 10 check-ups of each site are kept on this computer. Older ones are deleted by themselves.</p>

      {error && <ErrorMessage>{error}</ErrorMessage>}
      {actionError && <ErrorMessage>{actionError}</ErrorMessage>}
      {busy && <p className="mb-4 text-sm text-ink-soft">A check-up is in progress. Test again once it’s finished.</p>}

      {runs === null && !error && <Spinner label="Opening your past check-ups…" />}
      {runs?.length === 0 && (
        <div className="rounded-lg border-2 border-rule bg-surface p-6">
          <p className="font-bold">No check-ups yet.</p>
          <p className="mt-1 text-ink-soft">Each one you finish is kept here, with its report.</p>
          <Link to={PATHS.new} className="btn-primary mt-4 px-5">
            Start a check-up
          </Link>
        </div>
      )}

      <div className="space-y-10">
        {sites.map(([host, list]) => (
          <section key={host} aria-labelledby={`site-${host}`}>
            <h2 id={`site-${host}`} className="mb-3 break-all text-xl font-bold">
              {host}
            </h2>
            <ul className="space-y-3">
              {list.map((run) => (
                <li key={run.runId} className={`rounded-lg border-l-4 bg-surface p-4 ${run.ready ? 'border-pass' : 'border-fail'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                    <div className="min-w-0">
                      <p className={`font-bold ${run.ready ? 'text-pass' : 'text-fail'}`}>{run.stamp}</p>
                      <p className="text-ink">{countsSentence(run)}</p>
                      <p className="text-sm text-ink-soft">
                        {formatWhen(run.timestamp)}
                        {run.readOnly ? ' · only looked at' : ''}
                        {run.testedWithApprovedPlan ? ' · tested with the approved plan' : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={PATHS.report(run.runId)} className="btn-primary min-h-[44px] px-4 text-sm" aria-label={`Open the check-up of ${host} from ${formatWhen(run.timestamp)}`}>
                        Open
                      </Link>
                      <button
                        type="button"
                        className="btn-quiet min-h-[44px] px-4 text-sm"
                        disabled={busy || working !== null}
                        onClick={() => void again(run)}
                        aria-label={`Test ${host} again`}
                      >
                        {working === `again:${run.runId}` ? <Spinner label="Starting…" /> : 'Test again'}
                      </button>
                      <button
                        type="button"
                        className="btn-quiet min-h-[44px] border-fail px-4 text-sm text-fail hover:border-fail hover:bg-fail-tint"
                        disabled={working !== null}
                        onClick={() => void remove(run)}
                        aria-label={`Delete the check-up of ${host} from ${formatWhen(run.timestamp)}`}
                      >
                        {working === `delete:${run.runId}` ? <Spinner label="Deleting…" /> : 'Delete'}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
