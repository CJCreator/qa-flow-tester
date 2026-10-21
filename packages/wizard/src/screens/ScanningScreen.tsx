import { useEffect, useState } from 'react';
import { FocusHeading } from '../components/text';
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

  return (
    <div className="mx-auto max-w-[44rem] px-4 py-10 sm:px-6 sm:py-14">
      <FocusHeading className="mb-2 break-words text-question font-bold">Exploring {host}</FocusHeading>
      <p className="mb-8 max-w-prose text-ink-soft">
        This can take a few minutes on a big site. You can leave this page: the check-up keeps going, and "New check-up"
        shows a dot while it does. You review the plan before anything is tested
        {hasMaterials ? ', and the AI uses the specs you added to write it' : ''}.
      </p>

      {failure ? (
        <RunFailure title="The check-up stopped" message={failure} />
      ) : (
        <>
          <ol className="mb-6 space-y-2.5" aria-label="Stages">
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
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-200 ${
                      state === 'done'
                        ? 'border-stamp bg-stamp text-surface shadow-level-1'
                        : state === 'current'
                          ? 'border-stamp bg-surface text-stamp ring-2 ring-stamp/40 font-bold shadow-level-1'
                          : 'border-edge/50 bg-panel text-ink-soft'
                    }`}
                  >
                    {state === 'done' ? '✓' : i + 1}
                  </span>
                  <span className={state === 'todo' ? 'text-ink-soft font-medium' : 'font-bold text-ink'}>
                    {stage.label}
                  </span>
                  {state === 'current' && (
                    <span className="badge-tech-stamp text-[10px] py-0 px-1.5 ml-auto">NOW</span>
                  )}
                  {state === 'done' && <span className="badge-tech-pass text-[10px] py-0 px-1.5 ml-auto">DONE</span>}
                  <span className="sr-only">
                    {state === 'done' ? '(done)' : state === 'current' ? '(now)' : '(to come)'}
                  </span>
                </li>
              );
            })}
          </ol>

          <section
            aria-label="Check-up progress"
            className="blueprint-card p-6 bg-surface/90 border border-rule/80 relative overflow-hidden shadow-level-3"
          >
            <div className="absolute top-0 inset-x-0 h-1 bg-panel overflow-hidden">
              <div className="h-full bg-stamp progress-indeterminate shadow-[0_0_8px_rgba(108,155,242,0.5)]" />
            </div>

            {/* Polite screen reader live region announcing stage transitions only */}
            <div role="status" aria-live="polite" className="sr-only">
              {statusText(progress)}
            </div>

            {/* Non-live visible progress indicator */}
            <p className="font-bold text-ink text-base">
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
              {left && !progress?.asking && <span className="font-normal text-ink-soft"> · {left}</span>}
            </p>

            {progress?.signedInAs && (
              <p className="mt-2 text-sm text-ink-soft">
                Signed in as <strong className="text-ink">{progress.signedInAs}</strong>
              </p>
            )}

            {progress?.signInFailedFor && progress.signInFailedFor.length > 0 && (
              <div role="alert" className="mt-2 rounded-md border border-fail bg-fail-tint p-2 text-sm text-fail">
                {progress.signInFailedFor.map((r) => `Sign-in failed for ${r}`).join('. ')}
              </div>
            )}

            {progress?.pagesFound !== undefined && (
              <div className="mt-4 flex flex-wrap items-center gap-2 pt-3 border-t border-rule/50">
                <span className="badge-tech">
                  <span>EXPLORED:</span>
                  <strong className="text-ink">{progress.pagesFound} pages</strong>
                </span>
                {progress.layoutGroups !== undefined && (
                  <span className="badge-tech">
                    <span>LAYOUTS:</span>
                    <strong className="text-ink">{progress.layoutGroups}</strong>
                  </span>
                )}
                {left && (
                  <span className="badge-tech">
                    <span>EST. TIME LEFT:</span>
                    <strong className="text-ink">{left}</strong>
                  </span>
                )}
              </div>
            )}

            {showStallWarning && (
              <div role="status" className="mt-3 rounded-md border border-warn bg-warn-tint p-3 text-sm text-warn-dark">
                No new pages for {stall} seconds
              </div>
            )}

            {planning ? (
              <div
                role="progressbar"
                aria-label="Plan written so far"
                aria-valuemin={0}
                aria-valuemax={planning.total}
                aria-valuenow={planning.done}
                className="mt-3 h-2 overflow-hidden rounded-full bg-rule"
              >
                <div
                  className="h-full rounded-full bg-stamp transition-[width] motion-reduce:transition-none"
                  style={{ width: `${(planning.done / planning.total) * 100}%` }}
                />
              </div>
            ) : (
              <div aria-hidden="true" className="mt-3 h-2 overflow-hidden rounded-full bg-rule">
                <div className="progress-indeterminate h-full w-1/3 rounded-full bg-stamp" />
              </div>
            )}

            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-ink-soft">Pages found</dt>
                <dd className="font-mono text-xl font-bold text-ink">{progress?.pagesFound ?? 0}</dd>
              </div>
              {progress?.skipped !== undefined && progress.skipped > 0 && (
                <div>
                  <dt className="text-ink-soft">Skipped</dt>
                  <dd className="font-mono text-xl font-bold text-ink">{progress.skipped}</dd>
                </div>
              )}
              {!!progress?.plannedSoFar && (
                <div>
                  <dt className="text-ink-soft">Planned while exploring</dt>
                  <dd className="font-mono text-xl font-bold text-ink">{progress.plannedSoFar}</dd>
                </div>
              )}
              {progress?.stage === 'planning' && !!progress.layoutGroups && (
                <div>
                  <dt className="text-ink-soft">Layouts</dt>
                  <dd className="font-mono text-xl font-bold text-ink">{progress.layoutGroups ?? 0}</dd>
                </div>
              )}
              {progress?.stage === 'planning' && (
                <div className="col-span-2 sm:col-span-1">
                  <dt className="text-ink-soft">AI requests</dt>
                  <dd className="font-mono text-xl font-bold text-ink">
                    {progress.requestsUsed ?? 0} of about {progress.requestsNeeded ?? 0}
                  </dd>
                  {progress.requestsLeft !== undefined && (
                    <dd className="text-ink-soft">{progress.requestsLeft} free left today</dd>
                  )}
                </div>
              )}
            </dl>
          </section>

          <div className="mt-8">
            <button
              type="button"
              className="btn-quiet border-fail text-fail hover:border-fail hover:bg-fail-tint"
              onClick={onStop}
            >
              Stop exploring
            </button>
          </div>
        </>
      )}
    </div>
  );
}
