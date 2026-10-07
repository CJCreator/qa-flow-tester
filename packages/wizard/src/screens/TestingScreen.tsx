import { useEffect, useMemo, useState } from 'react';
import type { DiscoveredFlow } from '@qa/types';
import { SiteMap, type MapPage, type PageStatus } from '../components/SiteMap';
import { RunFailure } from '../components/RunStates';
import { FocusHeading } from '../components/text';
import { count } from '../lib/format';
import { plainTitleText } from '../lib/summary';
import { secondsLeft, timeLeft, type FeedState } from '../lib/translate';

const SERIOUS = new Set(['Blocker', 'Major']);

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
      { key: string; title: string; serious: boolean; pages: string[]; sizes: string[]; count: number }
    >();
    for (const f of found) {
      const title = plainTitleText(f.title) || 'A problem';
      const key = title.toLowerCase();
      const entry = byTitle.get(key) ?? { key, title, serious: false, pages: [], sizes: [], count: 0 };
      byTitle.set(key, entry);
      entry.count++;
      entry.serious ||= SERIOUS.has(f.severity);
      if (f.urlPath && !entry.pages.includes(f.urlPath)) entry.pages.push(f.urlPath);
      if (f.breakpoint && !entry.sizes.includes(f.breakpoint)) entry.sizes.push(f.breakpoint);
    }
    return [...byTitle.values()];
  }, [found]);

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col">
      <div className="border-b border-rule bg-surface px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            <FocusHeading className="break-words text-2xl font-bold sm:text-3xl">Testing {host}</FocusHeading>
            <p role="status" className="mt-1 text-ink">
              {feed.status === 'completed'
                ? 'All done. Putting your report together…'
                : total > 0
                  ? `Test ${position} of ${total}${left ? ` · ${left}` : ''}`
                  : 'Getting ready to test…'}
            </p>
            {total > 0 ? (
              <div
                role="progressbar"
                aria-label="Tests done"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={feed.progress?.done ?? 0}
                className="mt-2 h-2 max-w-xl overflow-hidden rounded-full bg-rule"
              >
                <div
                  className="h-full rounded-full bg-stamp transition-[width] motion-reduce:transition-none"
                  style={{ width: `${((feed.progress?.done ?? 0) / total) * 100}%` }}
                />
              </div>
            ) : (
              running && (
                <div aria-hidden="true" className="mt-2 h-2 max-w-xl overflow-hidden rounded-full bg-rule">
                  <div className="progress-indeterminate h-full w-1/3 rounded-full bg-stamp" />
                </div>
              )
            )}
          </div>
          {running && (
            <button
              type="button"
              className="btn-quiet border-fail text-fail hover:border-fail hover:bg-fail-tint"
              onClick={onStop}
            >
              Stop testing
            </button>
          )}
        </div>
        {feed.status === 'failed' && feed.failure && (
          <div className="mx-auto mt-4 max-w-6xl">
            <RunFailure
              title="Testing stopped"
              message={feed.failure}
              planKept={feed.planKept}
              onBackToPlan={onBackToPlan}
            />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col overflow-x-hidden lg:flex-row">
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
            <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-ink-soft">Now testing</h2>
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
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-soft">Latest screen</h2>
            {feed.screenshot ? (
              <figure>
                <img
                  src={feed.screenshot.url}
                  alt={`The latest screen${feed.screenshot.page ? `, on ${feed.screenshot.page}` : ''}`}
                  className="w-full rounded border border-rule bg-canvas"
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
            <h2 id="found-title" className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-soft">
              Found so far: {count(problems.length, 'problem', 'problems')}
            </h2>
            {selected && (
              <p className="mb-2 text-sm text-ink">
                On <span className="break-all font-mono">{selected}</span>{' '}
                <button type="button" className="btn-link min-h-0 text-sm" onClick={() => setSelected(null)}>
                  Show all
                </button>
              </p>
            )}
            {problems.length === 0 ? (
              <p className="text-sm text-ink-soft">
                {selected ? 'Nothing found on this page so far.' : 'Nothing yet.'}
              </p>
            ) : (
              <ul className="max-h-[28rem] space-y-2 overflow-y-auto lg:max-h-none">
                {problems.slice(0, 20).map((problem) => (
                  <li
                    key={problem.key}
                    className={`rounded border-l-4 bg-surface px-3 py-2 text-sm ${problem.serious ? 'border-l-fail' : 'border-l-warn'}`}
                  >
                    <span className="block text-ink">
                      {problem.title}
                      {problem.count > 1 && <span className="text-ink-soft"> ×{problem.count}</span>}
                    </span>
                    <span className="block break-all text-sm text-ink-soft">
                      {problem.pages.length === 1 ? (
                        <span className="font-mono">{problem.pages[0]}</span>
                      ) : (
                        `${problem.pages.length} pages`
                      )}
                      {problem.sizes.length > 0 ? ` · at ${problem.sizes.join(', ')}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
