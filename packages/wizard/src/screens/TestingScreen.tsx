import { useEffect, useMemo, useState } from 'react';
import type { DiscoveredFlow, FindingSeverity } from '@qa/types';
import { SEVERITY_ORDER } from '@qa/types/src/browser.js';
import { SiteMap, type MapPage, type PageStatus } from '../components/SiteMap';
import { RunFailure } from '../components/RunStates';
import { FocusHeading } from '../components/text';
import { count } from '../lib/format';
import { plainTitleText } from '../lib/summary';
import { secondsLeft, timeLeft, type FeedState } from '../lib/translate';

const SERIOUS = new Set(['Blocker', 'Major']);
const MAX_SHOWN = 20;

/** The report's words for a severity: Must fix, Should fix, Suggestion. */
function severityLabel(severity: string): string {
  return SERIOUS.has(severity) ? 'Must fix' : severity === 'Suggestion' ? 'Suggestion' : 'Should fix';
}

/** The more serious of two severity words, by the shared SEVERITY_ORDER. */
function worse(a: string, b: string): string {
  const rank = (s: string) => SEVERITY_ORDER.indexOf(s as FindingSeverity);
  return rank(b) !== -1 && (rank(a) === -1 || rank(b) < rank(a)) ? b : a;
}

/**
 * Testing, as it happens: the test count and time left, the page under test, the latest screen and
 * what's been found so far, all from the runner's events. Phones get the same, without the map.
 */
export function TestingScreen({
  host,
  pages: plannedPages,
  flows,
  feed,
  onStop,
  onBackToPlan,
}: {
  host: string;
  /** The approved plan's pages and journeys, for the map. Unknown after a reload mid-run. */
  pages?: MapPage[];
  flows?: DiscoveredFlow[];
  feed: FeedState;
  onStop: () => void;
  onBackToPlan: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const running = feed.status === 'starting' || feed.status === 'running';

  // The time left is re-estimated as the tests go by.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, [running]);

  // The plan's pages, and any page a test reached that the plan didn't name.
  const pages = useMemo(() => {
    const list: MapPage[] = [...(plannedPages ?? [])];
    for (const urlPath of Object.keys(feed.pages)) if (!list.some((p) => p.urlPath === urlPath)) list.push({ urlPath });
    return list;
  }, [plannedPages, feed.pages]);
  const statuses = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(feed.pages).map(([path, r]) => [
          path,
          { status: r.status, issuesCount: r.issues } satisfies PageStatus,
        ])
      ),
    [feed.pages]
  );

  const test = feed.test;
  const total = test?.total || feed.progress?.total || 0;
  const position = test ? Math.min(test.index + 1, total) : 0;
  const left = timeLeft(secondsLeft(feed, now));
  const found = selected ? feed.found.filter((f) => f.urlPath === selected) : feed.found;
  // The same problem seen on several pages or at several sizes is one line, with where it was seen.
  const problems = useMemo(() => {
    const byTitle = new Map<
      string,
      {
        key: string;
        title: string;
        serious: boolean;
        severity: string;
        label: string;
        pages: string[];
        sizes: string[];
        count: number;
      }
    >();
    for (const f of found) {
      const title = plainTitleText(f.title) || 'A problem';
      const key = title.toLowerCase();
      const entry = byTitle.get(key) ?? {
        key,
        title,
        serious: false,
        severity: f.severity,
        label: severityLabel(f.severity),
        pages: [],
        sizes: [],
        count: 0,
      };
      byTitle.set(key, entry);
      entry.count++;
      entry.serious ||= SERIOUS.has(f.severity);
      entry.severity = worse(entry.severity, f.severity);
      entry.label = severityLabel(entry.severity);
      if (f.urlPath && !entry.pages.includes(f.urlPath)) entry.pages.push(f.urlPath);
      if (f.breakpoint && !entry.sizes.includes(f.breakpoint)) entry.sizes.push(f.breakpoint);
    }
    return [...byTitle.values()];
  }, [found]);

  const status =
    feed.status === 'completed'
      ? 'All done. Putting your report together…'
      : total > 0
        ? `Test ${position} of ${total}`
        : 'Getting ready to test…';
  // Announced to screen readers: the page under test, never the counters.
  const announcement =
    feed.status === 'completed'
      ? 'All done. Putting your report together…'
      : feed.currentPage
        ? `Testing ${feed.currentPage}`
        : 'Getting ready to test…';
  const shown = problems.slice(0, MAX_SHOWN);

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col">
      <div className="border-b border-rule bg-surface py-4">
        <div className="mx-auto flex max-w-workspace flex-wrap items-end justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="min-w-0 flex-1">
            <FocusHeading className="break-words font-stamp text-3xl font-bold tracking-tight sm:text-4xl">
              Testing {host}
            </FocusHeading>
            <p role="status" className="sr-only">
              {announcement}
            </p>
            <p className="mt-2 text-ink">
              {status}
              {left && total > 0 && <span className="text-ink-soft"> · {left}</span>}
            </p>
            {total > 0 ? (
              <div
                role="progressbar"
                aria-label="Tests done"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={feed.progress?.done ?? 0}
                className="mt-3 h-2 max-w-xl overflow-hidden rounded-pill bg-rule"
              >
                <div
                  className="h-full rounded-pill bg-stamp transition-[width] duration-base motion-reduce:transition-none"
                  style={{ width: `${((feed.progress?.done ?? 0) / total) * 100}%` }}
                />
              </div>
            ) : (
              running && (
                <div aria-hidden="true" className="mt-3 h-2 max-w-xl overflow-hidden rounded-pill bg-rule">
                  <div className="progress-indeterminate h-full w-1/3 rounded-pill bg-stamp" />
                </div>
              )
            )}
          </div>
          {running && (
            <button
              type="button"
              className="btn-danger-quiet"
              onClick={onStop}
            >
              Stop testing
            </button>
          )}
        </div>
        {feed.status === 'failed' && feed.failure && (
          <div className="mx-auto mt-4 max-w-workspace px-4 sm:px-6 lg:px-8">
            <RunFailure
              title="Testing stopped"
              message={feed.failure}
              planKept={feed.planKept}
              onBackToPlan={onBackToPlan}
            />
          </div>
        )}
      </div>

      <div className="mx-auto flex w-full max-w-workspace flex-1 flex-col lg:flex-row">
        {/* The map is wider than a phone: phones and tablets get the panel on its own. */}
        <div className="hidden min-h-[32rem] overflow-hidden lg:flex lg:min-w-0 lg:flex-1">
          <SiteMap
            pages={pages}
            flows={flows}
            mode="live"
            runningPagePath={running ? feed.currentPage : null}
            selectedPagePath={selected}
            pageStatuses={statuses}
            onSelectPage={(path) => setSelected((s) => (s === path ? null : path))}
          />
        </div>

        <aside
          aria-label="What’s happening"
          className="w-full space-y-6 bg-panel p-4 sm:p-6 lg:sticky lg:top-0 lg:max-h-[calc(100vh-7rem)] lg:w-96 lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-rule"
        >
          <section>
            <h2 className="mb-1 text-xl font-bold text-ink">Now testing</h2>
            {feed.currentPage ? (
              <p className="break-all font-mono text-ink">{feed.currentPage}</p>
            ) : (
              <p className="text-ink-soft">No page yet.</p>
            )}
            {test && (
              <p className="text-sm text-ink-soft">
                {test.name ? `“${test.name}”` : `Test ${position}`}
                {test.size ? ` at ${test.size}` : ''}
                {test.role ? `, as ${test.role}` : ''}
              </p>
            )}
            {running && <p className="mt-1 text-sm text-ink">{feed.current}</p>}
          </section>

          <section>
            <h2 className="mb-2 text-xl font-bold text-ink">Latest screen</h2>
            {feed.screenshot ? (
              <figure>
                <img
                  src={feed.screenshot.url}
                  alt={`The latest screen${feed.screenshot.page ? `, on ${feed.screenshot.page}` : ''}`}
                  className="w-full rounded-control border border-rule bg-canvas"
                />
                {feed.screenshot.page && (
                  <figcaption className="mt-1 break-all font-mono text-sm text-ink-soft">
                    {feed.screenshot.page}
                  </figcaption>
                )}
              </figure>
            ) : (
              <p className="text-sm text-ink-soft">The latest screen shows here once a test has taken one.</p>
            )}
          </section>

          <section aria-labelledby="found-title">
            <h2 id="found-title" className="mb-2 text-xl font-bold text-ink">
              Found so far: {count(problems.length, 'problem', 'problems')}
            </h2>
            {selected && (
              <p className="mb-2 text-sm text-ink">
                On <span className="break-all font-mono">{selected}</span>{' '}
                <button type="button" className="btn-link text-sm" onClick={() => setSelected(null)}>
                  Show all
                </button>
              </p>
            )}
            {problems.length === 0 ? (
              <p className="text-sm text-ink-soft">
                {selected ? 'Nothing found on this page so far.' : 'Nothing yet.'}
              </p>
            ) : (
              <>
                <ul className="max-h-[28rem] space-y-2 overflow-y-auto lg:max-h-none">
                  {shown.map((problem) => (
                    <li
                      key={problem.key}
                      className={`rounded-card border border-l-4 border-rule bg-surface p-3 text-sm ${
                        problem.serious ? 'border-l-fail' : 'border-l-warn'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="block font-semibold leading-snug text-ink">
                          {problem.title}
                          {problem.count > 1 && <span className="text-xs text-ink-soft"> ×{problem.count}</span>}
                        </span>
                        <span className={`shrink-0 ${problem.serious ? 'badge-fail' : 'badge-warn'}`}>
                          {problem.label}
                        </span>
                      </div>
                      <span className="mt-1 block break-all text-xs text-ink-soft">
                        {problem.pages.length === 1 ? (
                          <span className="font-mono">{problem.pages[0]}</span>
                        ) : (
                          `${problem.pages.length} pages`
                        )}
                        {problem.sizes.length > 0 ? ` · ${problem.sizes.join(', ')}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
                {problems.length > MAX_SHOWN && (
                  <p className="mt-2 text-sm text-ink-soft">
                    +{problems.length - MAX_SHOWN} more. The full list is in the report.
                  </p>
                )}
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
