import { FocusHeading } from '../components/text';
import { RunFailure } from '../components/RunFailure';
import { Link, PATHS, useTitle } from '../lib/router';
import { timeLeft } from '../lib/translate';
import { hostOf } from '../lib/url';

/** How the scan is going, from the QA Tool's progress events. */
export interface ScanProgress {
  stage: 'crawling' | 'narrow-screens' | 'planning';
  /** The page just explored (crawling). */
  urlPath?: string;
  pagesFound?: number;
  layoutGroups?: number;
  done?: number;
  total?: number;
  requestsUsed?: number;
  requestsNeeded?: number;
  requestsLeft?: number;
  what?: string;
  /** Seconds left, estimated from how long the AI requests so far took. */
  secondsLeft?: number;
}

function nowSentence(progress: ScanProgress | null): string {
  if (!progress) return 'Opening the site…';
  if (progress.stage === 'crawling') return progress.urlPath ? `Exploring the site. Just looked at ${progress.urlPath}` : 'Exploring the site…';
  if (progress.stage === 'narrow-screens') return 'Looking at the menus on phone and tablet screens…';
  const what = progress.what || 'The AI is writing the plan';
  return progress.total ? `${what} (${Math.min(progress.done ?? 0, progress.total)} of ${progress.total})` : `${what}…`;
}

/**
 * /check/scan: the site is explored and the AI writes the plan. Numbers only, from the QA Tool's
 * events, and one way to stop.
 */
export function ScanningScreen({
  targetUrl,
  progress,
  failure,
  onStop,
}: {
  targetUrl: string;
  progress: ScanProgress | null;
  /** Why the scan stopped, in plain words. */
  failure: string | null;
  onStop: () => void;
}) {
  const host = targetUrl ? hostOf(targetUrl) : 'your site';
  useTitle(`Scanning ${host}`);
  const left = timeLeft(progress?.secondsLeft);
  const planning = progress?.stage === 'planning';
  const percent = planning && progress?.total ? Math.round((Math.min(progress.done ?? 0, progress.total) / progress.total) * 100) : null;

  return (
    <div className="mx-auto w-full max-w-[680px] px-4 py-10 sm:px-6 sm:py-14">
      <FocusHeading className="mb-2 break-words text-question font-bold">Scanning {host}</FocusHeading>
      <p className="mb-8 text-ink-soft">The site is explored first, then the AI writes a plan for you to review. Nothing is tested yet.</p>

      {failure ? (
        <RunFailure
          title="The scan stopped"
          message={failure}
          actions={
            <Link to={PATHS.new} className="btn-primary px-5">
              Back to the address
            </Link>
          }
        />
      ) : (
        <>
          <section aria-label="Scan progress" className="rounded-lg border-2 border-edge bg-surface p-5">
            <p role="status" className="font-bold text-ink">
              {nowSentence(progress)}
              {left && <span className="font-normal text-ink-soft"> · {left}</span>}
            </p>

            <div className="mt-4 h-2 overflow-hidden rounded-full bg-rule" aria-hidden="true">
              {percent === null ? (
                <div className="progress-indeterminate h-full w-1/3 rounded-full bg-stamp" />
              ) : (
                <div className="h-full rounded-full bg-stamp transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
              )}
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-ink-soft">Pages found</dt>
                <dd className="font-mono text-2xl font-bold text-ink">{progress?.pagesFound ?? 0}</dd>
              </div>
              {planning && (
                <div>
                  <dt className="text-sm text-ink-soft">Layouts</dt>
                  <dd className="font-mono text-2xl font-bold text-ink">{progress?.layoutGroups ?? 0}</dd>
                </div>
              )}
              {planning && (
                <div>
                  <dt className="text-sm text-ink-soft">AI requests</dt>
                  <dd className="font-mono text-2xl font-bold text-ink">
                    {progress?.requestsUsed ?? 0}
                    <span className="text-base font-normal text-ink-soft"> of about {progress?.requestsNeeded ?? 0}</span>
                  </dd>
                  {progress?.requestsLeft !== undefined && <dd className="text-sm text-ink-soft">{progress.requestsLeft} free left today</dd>}
                </div>
              )}
            </dl>
          </section>

          <div className="mt-8">
            <button type="button" onClick={onStop} className="btn-quiet border-fail text-fail hover:border-fail hover:bg-fail-tint">
              Stop scanning
            </button>
          </div>
        </>
      )}
    </div>
  );
}
