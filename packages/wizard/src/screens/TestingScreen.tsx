import { useMemo, useState } from 'react';
import type { ReviewPlan } from '@qa/types';
import { SiteMap, type MapPage, type PageStatus } from '../components/SiteMap';
import { FocusHeading } from '../components/text';
import { RunFailure } from '../components/RunFailure';
import { Link, PATHS, useTitle } from '../lib/router';
import { secondsLeft, timeLeft, type FeedState } from '../lib/translate';
import { plainTitleText } from '../lib/summary';
import { hostOf } from '../lib/url';

const SERIOUS = new Set(['Blocker', 'Major']);

/**
 * /check/testing: the approved plan is being tested. Everything here comes from the QA Tool's
 * events: the test count and time left, the page under test, the latest screen, and each problem
 * pinned to its page. On phones the map gives way to the rest.
 */
export function TestingScreen({
  targetUrl,
  plan,
  feed,
  failure,
  planKept,
  onStop,
}: {
  targetUrl: string;
  plan: ReviewPlan | null;
  feed: FeedState;
  failure: string | null;
  planKept: boolean;
  onStop: () => void;
}) {
  const host = targetUrl ? hostOf(targetUrl) : 'your site';
  useTitle(`Testing ${host}`);
  const [selected, setSelected] = useState<string | null>(null);

  const progress = feed.progress;
  const current = progress ? Math.min((feed.test?.index ?? progress.done) + 1, progress.total) : 0;
  const left = timeLeft(secondsLeft(feed));
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null;

  // The plan's pages, and any page a test reached that the plan didn't list.
  const pages: MapPage[] = useMemo(() => {
    const list: MapPage[] = (plan?.pages || []).map((p) => ({ urlPath: p.urlPath, title: p.title }));
    for (const path of Object.keys(feed.pages)) if (!list.some((p) => p.urlPath === path)) list.push({ urlPath: path });
    return list;
  }, [plan, feed.pages]);
  const statuses = useMemo(
    () => Object.fromEntries(Object.entries(feed.pages).map(([path, p]) => [path, { status: p.status, issuesCount: p.issues } satisfies PageStatus])),
    [feed.pages]
  );
  const shown = selected ? feed.found.filter((f) => f.urlPath === selected) : feed.found;

  return (
    <div className="flex w-full flex-1 flex-col">
      <div className="border-b border-rule bg-surface px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <FocusHeading className="break-words text-2xl font-bold sm:text-3xl">Testing {host}</FocusHeading>
            <p role="status" className="mt-1 text-ink-soft">
              {failure ? 'Testing stopped.' : progress ? `Test ${current} of ${progress.total}` : 'Getting ready…'}
              {!failure && left && ` · ${left}`}
            </p>
          </div>
          {!failure && (
            <button type="button" onClick={onStop} className="btn-quiet border-fail text-fail hover:border-fail hover:bg-fail-tint">
              Stop testing
            </button>
          )}
        </div>
        {!failure && (
          <div className="mx-auto mt-3 h-2 max-w-6xl overflow-hidden rounded-full bg-rule" aria-hidden="true">
            {percent === null ? (
              <div className="progress-indeterminate h-full w-1/3 rounded-full bg-stamp" />
            ) : (
              <div className="h-full rounded-full bg-stamp transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
            )}
          </div>
        )}
      </div>

      {failure && (
        <div className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6">
          <RunFailure
            title="Testing stopped before it finished"
            message={failure}
            actions={
              planKept ? (
                <Link to={PATHS.plan} className="btn-primary px-5">
                  Back to the plan
                </Link>
              ) : (
                <Link to={PATHS.new} className="btn-primary px-5">
                  Start a new check-up
                </Link>
              )
            }
          />
        </div>
      )}

      <div className="flex flex-1 md:h-[70vh] md:flex-none">
        {/* The map is wider than a phone: phones get the rest without it. */}
        <div className="hidden min-w-0 flex-1 md:flex">
          <SiteMap
            pages={pages}
            flows={plan?.flows}
            mode="live"
            selectedPagePath={selected}
            runningPagePath={failure ? null : feed.currentPage}
            pageStatuses={statuses}
            onSelectPage={(path) => setSelected((s) => (s === path ? null : path))}
            maxCards={12}
          />
        </div>

        <aside aria-label="What’s happening" className="w-full space-y-6 overflow-y-auto bg-panel p-4 sm:p-5 md:w-96 md:shrink-0 md:border-l md:border-rule">
          <section aria-labelledby="now-heading">
            <h2 id="now-heading" className="mb-1 text-sm font-bold text-ink-soft">
              Now testing
            </h2>
            <p className="break-all font-mono text-sm text-ink">{feed.currentPage || '…'}</p>
            <p className="mt-1 text-ink">{feed.current}</p>
            {feed.test?.size && <p className="mt-1 text-sm text-ink-soft">At {screenName(feed.test.size)}{feed.test.role ? `, as ${feed.test.role}` : ''}</p>}
          </section>

          <section aria-labelledby="screen-heading">
            <h2 id="screen-heading" className="mb-2 text-sm font-bold text-ink-soft">
              Latest screen
            </h2>
            {feed.screenshot ? (
              <img
                src={feed.screenshot.url}
                alt={`The page ${feed.screenshot.page ?? ''} after the latest step`}
                className="w-full rounded border border-rule bg-canvas"
              />
            ) : (
              <p className="text-sm text-ink-soft">The first screen shows here once a test has taken a step.</p>
            )}
          </section>

          <section aria-labelledby="found-heading">
            <h2 id="found-heading" className="mb-2 text-sm font-bold text-ink-soft">
              Found so far{feed.findings > 0 ? ` (${feed.findings})` : ''}
            </h2>
            {selected && (
              <p className="mb-2 flex flex-wrap items-center gap-x-3 text-sm text-ink">
                On <span className="break-all font-mono">{selected}</span>
                <button type="button" className="btn-link min-h-[36px] text-sm" onClick={() => setSelected(null)}>
                  Show every page
                </button>
              </p>
            )}
            {shown.length === 0 ? (
              <p className="text-sm text-ink-soft">{selected ? 'Nothing found on this page so far.' : 'No problems found so far.'}</p>
            ) : (
              <ul className="space-y-2">
                {shown.map((f) => (
                  <li
                    key={f.id}
                    className={`rounded border-l-4 bg-surface px-3 py-2 text-sm ${SERIOUS.has(f.severity) ? 'border-fail' : 'border-warn'}`}
                  >
                    <span className="block text-ink">{plainTitleText(f.title)}</span>
                    <span className="block break-all font-mono text-xs text-ink-soft">{f.urlPath}</span>
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

function screenName(size: string): string {
  if (size === '375px') return 'phone size';
  if (size === '768px') return 'tablet size';
  if (size === '1440px') return 'desktop size';
  return size;
}
