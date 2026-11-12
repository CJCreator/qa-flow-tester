import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { BenchmarkJob } from '@qa/types';
import { deleteBenchmark, getBenchmark, listBenchmarks, plainMessage, RunnerError, startBenchmark } from '../api';
import { useConfirm } from '../components/ConfirmDialog';
import { ErrorMessage, Spinner } from '../components/text';
import { Badge, LoadError, Page, PageHeader } from '../components/ui';
import { addressFromSearch } from '../lib/form';
import { scrollBehavior } from '../lib/format';
import { Link, PATHS } from '../lib/router';
import { useDocumentTitle } from '../lib/title';
import { hostOf } from '../lib/url';

const POLL_MS = 1500;

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** One yes/no cell of the pattern table: the mark is for the eye, the words for a screen reader. */
function Mark({ yes }: { yes: boolean }) {
  return yes ? (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-pill bg-pass-tint font-bold text-pass">
      <span aria-hidden="true">✓</span>
      <span className="sr-only">Found</span>
    </span>
  ) : (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-pill bg-fail-tint font-bold text-fail">
      <span aria-hidden="true">✗</span>
      <span className="sr-only">Not found</span>
    </span>
  );
}

function ScoreCard({
  title,
  ourName,
  refName,
  ours,
  theirs,
  oursClass = 'text-ink',
  note,
}: {
  title: string;
  ourName: string;
  refName: string;
  ours: ReactNode;
  theirs: ReactNode;
  oursClass?: string;
  note: string;
}) {
  return (
    <div className="rounded-card border border-rule bg-surface p-4">
      <h3 className="text-sm font-bold text-ink-soft">{title}</h3>
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <div>
          <span className="block text-xs text-ink-soft">{ourName}</span>
          <span className={`text-2xl font-bold ${oursClass}`}>{ours}</span>
        </div>
        <div className="text-right">
          <span className="block text-xs text-ink-soft">{refName}</span>
          <span className="text-2xl font-bold text-ink-soft">{theirs}</span>
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-soft">{note}</p>
    </div>
  );
}

export function BenchmarkScreen({ initialTargetUrl }: { initialTargetUrl?: string }) {
  useDocumentTitle('Compare with another site');
  const { confirm, dialog } = useConfirm();
  // A link from a report carries the site as ?url=; otherwise the site last checked.
  const [ourUrl, setOurUrl] = useState(() => addressFromSearch(window.location.search) || initialTargetUrl || '');
  const [ourName, setOurName] = useState('');
  const [refUrl, setRefUrl] = useState('');
  const [refName, setRefName] = useState('');
  const [job, setJob] = useState<BenchmarkJob | null>(null);
  const [history, setHistory] = useState<BenchmarkJob[]>([]);
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const timer = useRef<number | undefined>(undefined);
  const resultRef = useRef<HTMLDivElement>(null);
  // The poll failed: the comparison keeps running on the runner; Retry asks again.
  const [pollFailed, setPollFailed] = useState(false);
  const [pollTry, setPollTry] = useState(0);

  const running = starting || job?.status === 'running';
  // Why the Compare button is off, in words: a disabled button alone never says.
  const compareOff: string | null = running
    ? 'A comparison is running. Wait for it to finish.'
    : !ourUrl.trim()
      ? 'Enter the address of your site first.'
      : !refUrl.trim()
        ? 'Enter the address of the other site first.'
        : null;
  const result = job?.status === 'done' ? (job.result ?? null) : null;

  // A refresh that fails keeps the list already shown: the action it follows has its own message.
  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await listBenchmarks());
    } catch {
      // keep the current list
    }
  }, []);

  // On opening: the kept comparisons, and the one still running if you left while it ran.
  const loadHistory = useCallback(() => {
    setHistoryState('loading');
    void (async () => {
      try {
        const list = await listBenchmarks();
        setHistory(list);
        setHistoryState('ready');
        const live = list.find((j) => j.status === 'running');
        if (live) setJob(live);
      } catch {
        setHistoryState('error');
      }
    })();
  }, []);
  useEffect(loadHistory, [loadHistory]);

  // A comparison that appears (finished or opened) takes focus, so a keyboard or screen reader lands on it.
  const resultId = result ? job?.id : null;
  useEffect(() => {
    if (!resultId) return;
    resultRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    resultRef.current?.focus({ preventScroll: true });
  }, [resultId]);

  // While a comparison runs, ask how it is getting on.
  const runningId = job?.status === 'running' ? job.id : null;
  useEffect(() => {
    if (!runningId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await getBenchmark(runningId);
        if (cancelled) return;
        setJob(next);
        if (next.status !== 'running') {
          void refreshHistory();
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof RunnerError
            ? err.message
            : 'Lost track of the comparison. Retry, or open it from the list below.'
        );
        setPollFailed(true);
        return;
      }
      timer.current = window.setTimeout(() => void tick(), POLL_MS);
    };
    timer.current = window.setTimeout(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer.current);
    };
  }, [runningId, refreshHistory, pollTry]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ourUrl.trim() || !refUrl.trim() || running) return;
    setStarting(true);
    setError(null);
    setSelectedCategory('all');
    try {
      const id = await startBenchmark({
        ourUrl: ourUrl.trim(),
        ourName: ourName.trim(),
        refUrl: refUrl.trim(),
        refName: refName.trim(),
      });
      setJob({
        id,
        status: 'running',
        stage: 'Starting…',
        flowType: 'custom',
        ourUrl: ourUrl.trim(),
        refUrl: refUrl.trim(),
        startedAt: new Date().toISOString(),
      });
    } catch (err) {
      setError(
        err instanceof RunnerError ? err.message : 'The comparison couldn’t start. Check both addresses and try again.'
      );
    } finally {
      setStarting(false);
    }
  };

  const open = async (id: string) => {
    setError(null);
    setSelectedCategory('all');
    try {
      setJob(await getBenchmark(id));
    } catch (err) {
      setError(err instanceof RunnerError ? err.message : 'That comparison couldn’t be opened.');
    }
  };

  const remove = async (h: BenchmarkJob) => {
    const ok = await confirm({
      title: 'Remove this comparison?',
      body: (
        <p>
          The comparison of {hostOf(h.ourUrl)} with {hostOf(h.refUrl)} is removed from the list. This can’t be undone.
        </p>
      ),
      confirmLabel: 'Remove the comparison',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteBenchmark(h.id);
      if (job?.id === h.id) setJob(null);
      await refreshHistory();
    } catch (err) {
      setError(err instanceof RunnerError ? err.message : 'That comparison couldn’t be removed.');
    }
  };

  const categories = result ? ['all', ...Array.from(new Set(result.recommendations.map((r) => r.category)))] : [];
  const filteredRecs = result
    ? selectedCategory === 'all'
      ? result.recommendations
      : result.recommendations.filter((r) => r.category === selectedCategory)
    : [];

  const ourFriction = result?.ourProduct.scorecard.frictionIndex;
  const refFriction = result?.referenceProduct.scorecard.frictionIndex;
  const ourIsLeaner = result ? (ourFriction as number) <= (refFriction as number) : false;

  return (
    <Page width="workspace" className="space-y-8">
      {dialog}
      <PageHeader
        title="Compare with another site"
        lede="Compare a journey on your site with the same journey on another: the steps, the form fields and the helpful patterns each has. It only looks at both sites, respects the other site’s robots.txt, and takes about a minute."
      />

      <form onSubmit={handleSubmit} className="space-y-4 rounded-panel border border-rule bg-surface p-5">
        <h2 className="text-xl font-bold text-ink">Which two sites?</h2>
        <p className="max-w-prose text-sm text-ink-soft">
          Enter the address where the journey starts on each, such as the pricing page or the sign-up page.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="target-url" className="label">
              Your site
            </label>
            <input
              id="target-url"
              name="target-url"
              type="url"
              required
              placeholder="https://yourapp.com/signup"
              value={ourUrl}
              onChange={(e) => setOurUrl(e.target.value)}
              className="field"
            />
            <input
              id="target-name"
              name="target-name"
              type="text"
              aria-label="Name for your site (optional)"
              placeholder="Name (optional)"
              value={ourName}
              onChange={(e) => setOurName(e.target.value)}
              className="field mt-2 text-xs"
            />
          </div>

          <div>
            <label htmlFor="competitor-url" className="label">
              The site to compare with
            </label>
            <input
              id="competitor-url"
              name="competitor-url"
              type="url"
              required
              placeholder="https://example.com/signup"
              value={refUrl}
              onChange={(e) => setRefUrl(e.target.value)}
              className="field"
            />
            <input
              id="competitor-name"
              name="competitor-name"
              type="text"
              aria-label="Name for the other site (optional)"
              placeholder="Name (optional)"
              value={refName}
              onChange={(e) => setRefName(e.target.value)}
              className="field mt-2 text-xs"
            />
          </div>
        </div>

        {error && <ErrorMessage>{error}</ErrorMessage>}
        {pollFailed && runningId && (
          <button
            type="button"
            className="btn-quiet btn-sm mt-3"
            onClick={() => {
              setError(null);
              setPollFailed(false);
              setPollTry((n) => n + 1);
            }}
          >
            Retry
          </button>
        )}

        <div className="pt-2">
          <button
            type="submit"
            disabled={compareOff !== null}
            aria-describedby={compareOff ? 'compare-off-reason' : undefined}
            className={result ? 'btn-quiet' : 'btn-primary'}
          >
            {running ? <Spinner label={job?.stage || 'Starting…'} /> : 'Compare the two sites'}
          </button>
          {compareOff && (
            <p id="compare-off-reason" className="mt-2 text-sm text-ink-soft">
              {compareOff}
            </p>
          )}
        </div>
      </form>

      {job?.status === 'failed' && (
        <ErrorMessage>
          {plainMessage(
            job.error,
            'The comparison couldn’t finish. Try again in a minute. If it keeps failing, check the QA Tool’s terminal.'
          )}
        </ErrorMessage>
      )}

      {/* An opened comparison sits above the history. */}
      {result && job && (
        <div
          ref={resultRef}
          tabIndex={-1}
          role="region"
          aria-label="Comparison result"
          className="space-y-8 rounded-card"
        >
          <p className="text-sm text-ink-soft">
            {result.ourProduct.name} compared with {result.referenceProduct.name}, {when(result.createdAt)}.
          </p>

          <section className="space-y-4" aria-labelledby="effort-title">
            <h2 id="effort-title" className="text-xl font-bold text-ink">
              How much effort each visitor faces
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <ScoreCard
                title="Effort score (lower is better)"
                ourName={result.ourProduct.name}
                refName={result.referenceProduct.name}
                ours={(ourFriction ?? 0).toFixed(0)}
                theirs={(refFriction ?? 0).toFixed(0)}
                oursClass={ourIsLeaner ? 'text-pass' : 'text-fail'}
                note={
                  ourIsLeaner ? 'Your site asks for the same or less effort.' : 'The other site asks for less effort.'
                }
              />
              <ScoreCard
                title="Steps"
                ourName={result.ourProduct.name}
                refName={result.referenceProduct.name}
                ours={count(result.ourProduct.scorecard.totalSteps, 'step')}
                theirs={count(result.referenceProduct.scorecard.totalSteps, 'step')}
                note={
                  result.delta.stepDifference <= 0
                    ? 'Fewer steps than the other site, or the same.'
                    : `${count(result.delta.stepDifference, 'extra step')} compared with the other site.`
                }
              />
              <ScoreCard
                title="Form fields"
                ourName={result.ourProduct.name}
                refName={result.referenceProduct.name}
                ours={count(result.ourProduct.scorecard.totalFields, 'field')}
                theirs={count(result.referenceProduct.scorecard.totalFields, 'field')}
                note={
                  result.delta.fieldDifference <= 0
                    ? 'Fewer fields than the other site, or the same.'
                    : `${count(result.delta.fieldDifference, 'more field')} than the other site.`
                }
              />
              <ScoreCard
                title="Clicks to get there"
                ourName={result.ourProduct.name}
                refName={result.referenceProduct.name}
                ours={count(result.ourProduct.scorecard.clickDepth, 'click')}
                theirs={count(result.referenceProduct.scorecard.clickDepth, 'click')}
                note="Interactions needed on the way."
              />
            </div>
          </section>

          <section className="space-y-4" aria-labelledby="patterns-title">
            <h2 id="patterns-title" className="text-xl font-bold text-ink">
              Helpful patterns each site has
            </h2>
            <p className="text-xs text-ink-soft">
              Not found means it wasn’t found on the pages looked at, not that the site can’t do it.
            </p>
            <div className="overflow-x-auto rounded-card border border-rule bg-surface">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead className="border-b border-rule bg-panel text-xs font-bold text-ink-soft">
                  <tr>
                    <th scope="col" className="px-4 py-3">
                      Pattern
                    </th>
                    <th scope="col" className="px-4 py-3 text-center">
                      {result.ourProduct.name}
                    </th>
                    <th scope="col" className="px-4 py-3 text-center">
                      {result.referenceProduct.name}
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {result.patterns.map((p, idx) => (
                    <tr key={idx}>
                      <td className="px-4 py-3 font-bold text-ink">{p.pattern}</td>
                      <td className="px-4 py-3 text-center">
                        <Mark yes={p.ourProduct} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Mark yes={p.referenceProduct} />
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-soft">
                        {p.ourProduct && !p.referenceProduct ? (
                          <span className="font-bold text-pass">Only you have it</span>
                        ) : !p.ourProduct && p.referenceProduct ? (
                          <span className="font-bold text-warn">Worth adding</span>
                        ) : (
                          'Both or neither'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-4" aria-labelledby="ideas-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="ideas-title" className="text-xl font-bold text-ink">
                  Ideas to try
                </h2>
                <p className="text-xs text-ink-soft">
                  {result.recommendations.length === 0
                    ? 'Based on what was found on both sites.'
                    : job.aiUsed
                      ? 'Written by your AI from what was found on both sites, plus fixed checks.'
                      : 'From fixed checks on what was found. Add an AI key in Settings to get ideas written by an AI as well.'}
                </p>
              </div>

              {categories.length > 2 && (
                <div className="max-w-full overflow-x-auto">
                  <div className="segmented" role="group" aria-label="Kind of idea">
                    {categories.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={selectedCategory === c}
                        onClick={() => setSelectedCategory(c)}
                        className="min-h-[44px] capitalize"
                      >
                        {c === 'all' ? 'All' : c}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {result.recommendations.length === 0 && (
              <p className="rounded-card border border-rule bg-surface p-4 text-sm text-ink-soft">
                Nothing to suggest: on what was measured, the two sites ask the same of a visitor.
              </p>
            )}
            <div className="space-y-3">
              {filteredRecs.map((rec) => (
                <div key={rec.id} className="space-y-2 rounded-card border border-rule bg-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="stamp">{rec.category}</Badge>
                      <h3 className="text-lg font-bold text-ink">{rec.title}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge>Impact: {rec.impact}</Badge>
                      <Badge>Effort: {rec.effort}</Badge>
                    </div>
                  </div>

                  <p className="pt-1 text-xs text-ink-soft">{rec.rationale}</p>

                  <div className="flex items-start gap-2 rounded-control border border-stamp bg-stamp-tint p-2.5 text-xs text-ink">
                    <span className="shrink-0 font-bold text-stamp">What to do:</span>
                    <span>{rec.suggestedAction}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-6">
            <Link to={`${PATHS.new}?url=${encodeURIComponent(job.ourUrl)}`} className="btn-primary">
              Start a check-up of {hostOf(job.ourUrl)}
            </Link>
            <span className="text-sm text-ink-soft">Check your own site for problems, not only how it compares.</span>
          </div>
        </div>
      )}

      <section aria-labelledby="earlier-comparisons" className="space-y-3">
        <h2 id="earlier-comparisons" className="text-xl font-bold text-ink">
          Earlier comparisons
        </h2>
        {historyState === 'loading' && <Spinner label="Loading earlier comparisons…" />}
        {historyState === 'error' && (
          <LoadError title="Earlier comparisons couldn’t be loaded" onRetry={loadHistory}>
            The runner didn’t answer. Try again.
          </LoadError>
        )}
        {historyState === 'ready' && history.length === 0 && (
          <p className="text-sm text-ink-soft">No comparisons yet. The ones you run are kept here.</p>
        )}
        {history.length > 0 && (
          <ul className="divide-y divide-rule rounded-card border border-rule bg-surface">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                <div className="min-w-0 break-all">
                  <span className="font-bold text-ink">
                    {hostOf(h.ourUrl)} <span className="font-normal text-ink-soft">compared with</span>{' '}
                    {hostOf(h.refUrl)}
                  </span>
                  <span className="block text-xs text-ink-soft">
                    {when(h.startedAt)}
                    {h.status === 'running' ? ' · running now' : h.status === 'failed' ? ' · didn’t finish' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void open(h.id)}
                    className="btn-quiet btn-sm"
                    aria-label={`Open the comparison of ${hostOf(h.ourUrl)} with ${hostOf(h.refUrl)}`}
                  >
                    Open
                  </button>
                  {h.status !== 'running' && (
                    <button
                      type="button"
                      onClick={() => void remove(h)}
                      className="btn-quiet btn-sm"
                      aria-label={`Remove the comparison of ${hostOf(h.ourUrl)} with ${hostOf(h.refUrl)}`}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}
