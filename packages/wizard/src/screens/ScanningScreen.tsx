import { useEffect, useState } from 'react';
import { Page, PageHeader } from '../components/ui';
import { count } from '../lib/format';
import { RunFailure } from '../components/RunStates';
import { timeLeft } from '../lib/translate';
import { stalledForSeconds, statusText } from '../lib/coverage-text';
// The scan's progress payload lives with the plain-text helpers that read it, not with this screen: a
// `lib/` module importing a screen is the one import cycle in the repo (T-202).
import type { ScanProgress } from '../lib/scan-progress';

// Still exported from here, so App.tsx and the existing tests import them where they always have.
export type { ScanProgress } from '../lib/scan-progress';
export { isScanProgress } from '../lib/scan-progress';

/** Seconds since a moment, ticking once a second while shown. */
function useSecondsSince(since: number | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since]);
  return since ? Math.max(0, Math.round((now - since) / 1000)) : null;
}

const STAGES: Array<{ id: ScanProgress['stage']; label: string }> = [
  { id: 'crawling', label: 'Exploring every page' },
  { id: 'narrow-screens', label: 'Looking at phone and tablet menus' },
  { id: 'planning', label: 'Writing the plan' },
];

/**
 * The scan: the site is explored, then the AI writes the plan. Only real numbers are shown, and the
 * one way out is "Stop scanning", which asks first.
 */
export function ScanningScreen({
  host,
  progress,
  failure,
  hasMaterials,
  onStop,
  stalledSeconds,
}: {
  host: string;
  progress: ScanProgress | null;
  /** Why the scan stopped, in plain words. */
  failure?: string | null;
  /** Specs, design notes or journeys were added. */
  hasMaterials: boolean;
  onStop: () => void;
  /** Precomputed stall time in seconds (for tests or override). */
  stalledSeconds?: number;
}) {
  const stageIndex = progress ? STAGES.findIndex((s) => s.id === progress.stage) : -1;
  const planning =
    progress?.stage === 'planning' && progress.total
      ? { done: Math.min(progress.done ?? 0, progress.total), total: progress.total }
      : null;
  const left = timeLeft(progress?.secondsLeft);
  const waited = useSecondsSince(progress?.asking ? progress.askingSince : undefined);

  const [history, setHistory] = useState<Array<{ at: number; pagesFound: number }>>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (progress?.pagesFound !== undefined) {
      setHistory((h) => [...h, { at: Date.now(), pagesFound: progress.pagesFound! }]);
    }
  }, [progress?.pagesFound]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const stall = stalledSeconds ?? (history.length > 0 ? stalledForSeconds(history, now) : 0);
  const showStallWarning = stall >= 20 || (stalledSeconds !== undefined && stalledSeconds > 0);

  const crawling = progress?.stage === 'crawling';
  const stats = [
    progress?.pagesFound !== undefined ? `${count(progress.pagesFound, 'page', 'pages')} found` : null,
    progress?.skipped ? `${progress.skipped} skipped` : null,
    progress?.layoutGroups ? `${count(progress.layoutGroups, 'layout', 'layouts')}` : null,
    progress?.plannedSoFar ? `${count(progress.plannedSoFar, 'item', 'items')} planned while scanning` : null,
    progress?.stage === 'planning' && progress.requestsUsed !== undefined
      ? `${progress.requestsUsed} of about ${progress.requestsNeeded ?? 0} AI requests${
          progress.requestsLeft !== undefined ? `, ${progress.requestsLeft} free left today` : ''
        }`
      : null,
    left,
  ].filter((part): part is string => !!part);

  return (
    <Page width="form">
      <PageHeader
        title={failure ? `The scan of ${host} stopped` : `Exploring ${host}`}
        lede={
          failure
            ? undefined
            : `This can take a few minutes on a big site. You can leave this page: the check-up keeps going, and "New check-up" shows a dot while it does. You review the plan before anything is tested${
                hasMaterials ? ', and the AI uses the specs you added to write it' : ''
              }.`
        }
      />

      {failure ? (
        <RunFailure title="What happened" message={failure} />
      ) : (
        <>
          <ol className="mb-6 space-y-3" aria-label="Stages">
            {STAGES.map((stage, i) => {
              const state =
                stageIndex < 0
                  ? i === 0
                    ? 'current'
                    : 'todo'
                  : i < stageIndex
                    ? 'done'
                    : i === stageIndex
                      ? 'current'
                      : 'todo';
              return (
                <li
                  key={stage.id}
                  className="flex items-center gap-3"
                  aria-current={state === 'current' ? 'step' : undefined}
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${
                      state === 'done'
                        ? 'border-stamp bg-stamp text-on-stamp'
                        : state === 'current'
                          ? 'border-stamp bg-surface text-stamp'
                          : 'border-edge bg-surface text-ink-soft'
                    }`}
                  >
                    {state === 'done' ? '✓' : i + 1}
                  </span>
                  <span className={state === 'todo' ? 'text-ink-soft' : 'font-bold text-ink'}>{stage.label}</span>
                  <span className="ml-auto text-sm text-ink-soft">
                    {state === 'done' ? 'Done' : state === 'current' ? 'In progress' : 'Next'}
                  </span>
                </li>
              );
            })}
          </ol>

          <section aria-label="Scan progress" className="rounded-card border border-rule bg-surface p-5 sm:p-6">
            {/* The live region holds the stage text only: no counters, so it never chatters. */}
            <div role="status" aria-live="polite" className="sr-only">
              {statusText(progress)}
            </div>

            <p className="break-words text-base font-bold text-ink">
              {!progress
                ? 'Opening the site…'
                : progress.stage === 'crawling'
                  ? `Exploring the site${progress.urlPath ? `: just looked at ${progress.urlPath}` : '…'}`
                  : progress.stage === 'narrow-screens'
                    ? 'Looking at the menus on phone and tablet screens…'
                    : progress.asking
                      ? progress.what
                      : `${progress.what ?? 'Writing the plan'}${planning ? ` (${planning.done} of ${planning.total} requests)` : ''}…`}
              {waited !== null && waited >= 3 && (
                <span className="font-normal text-ink-soft"> · {waited} s so far</span>
              )}
            </p>

            {planning ? (
              <div
                role="progressbar"
                aria-label="Plan written so far"
                aria-valuemin={0}
                aria-valuemax={planning.total}
                aria-valuenow={planning.done}
                className="mt-3 h-2 overflow-hidden rounded-pill bg-rule"
              >
                <div
                  className="h-full rounded-pill bg-stamp transition-[width] duration-base motion-reduce:transition-none"
                  style={{ width: `${(planning.done / planning.total) * 100}%` }}
                />
              </div>
            ) : (
              <div aria-hidden="true" className="mt-3 h-2 overflow-hidden rounded-pill bg-rule">
                <div className="progress-indeterminate h-full w-1/3 rounded-pill bg-stamp" />
              </div>
            )}

            {stats.length > 0 && <p className="mt-3 text-sm text-ink-soft">{stats.join(' · ')}</p>}

            {progress?.signedInAs && (
              <p className="mt-3 text-sm text-ink-soft">
                Signed in as <strong className="text-ink">{progress.signedInAs}</strong>
              </p>
            )}

            {progress?.signInFailedFor && progress.signInFailedFor.length > 0 && (
              <div role="alert" className="mt-3 rounded-control border border-fail bg-fail-tint p-3 text-sm text-fail">
                {progress.signInFailedFor.map((r) => `Sign-in failed for ${r}`).join('. ')}
              </div>
            )}

            {crawling && showStallWarning && (
              <div className="mt-3 rounded-control border border-warn bg-warn-tint p-3 text-sm text-ink">
                <p>No new pages for {stall} seconds</p>
                <button type="button" className="btn-link mt-1 text-sm" onClick={onStop}>
                  Stop scanning to plan what's found
                </button>
              </div>
            )}
          </section>

          <div className="mt-8">
            <button type="button" className="btn-quiet border-fail text-fail hover:border-fail hover:bg-fail-tint" onClick={onStop}>
              Stop scanning
            </button>
          </div>
        </>
      )}
    </Page>
  );
}
