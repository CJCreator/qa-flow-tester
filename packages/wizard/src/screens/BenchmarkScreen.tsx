import { useCallback, useEffect, useRef, useState } from 'react';
import type { BenchmarkJob } from '@qa/types';
import { deleteBenchmark, getBenchmark, listBenchmarks, RunnerError, startBenchmark } from '../api';
import { ErrorMessage, FocusHeading, Spinner } from '../components/text';
import { useDocumentTitle } from '../lib/title';

const POLL_MS = 1500;

function hostOf(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function BenchmarkScreen({ initialTargetUrl }: { initialTargetUrl?: string }) {
  useDocumentTitle('Compare with another site');
  const [ourUrl, setOurUrl] = useState(initialTargetUrl || '');
  const [ourName, setOurName] = useState('');
  const [refUrl, setRefUrl] = useState('');
  const [refName, setRefName] = useState('');
  const [job, setJob] = useState<BenchmarkJob | null>(null);
  const [history, setHistory] = useState<BenchmarkJob[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const timer = useRef<number | undefined>(undefined);

  const running = starting || job?.status === 'running';
  const result = job?.status === 'done' ? (job.result ?? null) : null;

  const refreshHistory = useCallback(async () => setHistory(await listBenchmarks()), []);

  // On opening: the kept comparisons, and the one still running if you left while it ran.
  useEffect(() => {
    void (async () => {
      const list = await listBenchmarks();
      setHistory(list);
      const live = list.find((j) => j.status === 'running');
      if (live) setJob(live);
    })();
  }, []);

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
          err instanceof RunnerError ? err.message : 'Lost track of the comparison. Open it again from the list below.'
        );
        setJob(null);
        return;
      }
      timer.current = window.setTimeout(() => void tick(), POLL_MS);
    };
    timer.current = window.setTimeout(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer.current);
    };
  }, [runningId, refreshHistory]);

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

  const remove = async (id: string) => {
    try {
      await deleteBenchmark(id);
      if (job?.id === id) setJob(null);
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

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
      <header>
        <FocusHeading className="text-3xl font-bold tracking-tight">Compare with another site</FocusHeading>
        <p className="mt-1 max-w-prose text-ink-soft">
          See how your journey stacks up against a competitor’s or a site you admire: how many steps and form fields a
          visitor meets, which helpful patterns each has, and what you could try. It only looks: nothing is typed, sent
          or changed on either site, and the other site’s robots.txt is respected. It takes about a minute.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-panel border border-edge bg-surface p-5 shadow-level-2"
      >
        <h2 className="text-lg font-bold text-ink">Which two sites?</h2>
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
              placeholder="https://competitor.com/signup"
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

        <div className="pt-2">
          <button
            type="submit"
            disabled={running || !ourUrl.trim() || !refUrl.trim()}
            className="btn-primary rounded-control px-5 py-2.5 text-sm font-bold shadow-level-1"
          >
            {running ? <Spinner label={job?.stage || 'Starting…'} /> : 'Compare the two sites'}
          </button>
        </div>
      </form>

      {job?.status === 'failed' && (
        <ErrorMessage>{job.error || 'The comparison couldn’t finish. Try again.'}</ErrorMessage>
      )}

      {history.length > 0 && (
        <section aria-labelledby="earlier-comparisons" className="space-y-3">
          <h2 id="earlier-comparisons" className="text-lg font-bold text-ink">
            Earlier comparisons
          </h2>
          <ul className="divide-y divide-rule rounded-card border border-edge bg-surface shadow-level-1">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div>
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
                    className="rounded px-3 py-1.5 text-xs font-bold text-stamp hover:underline"
                    aria-label={`Open the comparison of ${hostOf(h.ourUrl)} with ${hostOf(h.refUrl)}`}
                  >
                    Open
                  </button>
                  {h.status !== 'running' && (
                    <button
                      type="button"
                      onClick={() => void remove(h.id)}
                      className="rounded px-3 py-1.5 text-xs font-bold text-ink-soft hover:text-fail"
                      aria-label={`Remove the comparison of ${hostOf(h.ourUrl)} with ${hostOf(h.refUrl)}`}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Results View */}
      {result && (
        <div className="space-y-8 animate-fade-in">
          <p className="text-sm text-ink-soft">
            {result.ourProduct.name} compared with {result.referenceProduct.name}, {when(result.createdAt)}.
          </p>

          {/* Friction Scorecard */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-ink">How much effort each visitor faces</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Friction Index */}
              <div className="rounded-card border border-edge bg-surface p-4 shadow-level-1">
                <div className="text-xs font-bold uppercase tracking-wider text-ink-soft">
                  Effort score (lower is better)
                </div>
                <div className="mt-3 flex items-baseline justify-between">
                  <div>
                    <span className="text-xs text-ink-soft block">{result.ourProduct.name}</span>
                    <span
                      className={`text-2xl font-bold ${
                        result.ourProduct.scorecard.frictionIndex <= result.referenceProduct.scorecard.frictionIndex
                          ? 'text-pass'
                          : 'text-fail'
                      }`}
                    >
                      {result.ourProduct.scorecard.frictionIndex.toFixed(0)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-ink-soft block">{result.referenceProduct.name}</span>
                    <span className="text-2xl font-bold text-ink">
                      {result.referenceProduct.scorecard.frictionIndex.toFixed(0)}
                    </span>
                  </div>
                </div>
                <div className="mt-2 text-xs text-ink-soft">
                  {result.ourProduct.scorecard.frictionIndex <= result.referenceProduct.scorecard.frictionIndex
                    ? 'Your site asks for the same or less effort.'
                    : 'The other site asks for less effort.'}
                </div>
              </div>

              {/* Step Count */}
              <div className="rounded-card border border-edge bg-surface p-4 shadow-level-1">
                <div className="text-xs font-bold uppercase tracking-wider text-ink-soft">Steps</div>
                <div className="mt-3 flex items-baseline justify-between">
                  <div>
                    <span className="text-xs text-ink-soft block">{result.ourProduct.name}</span>
                    <span className="text-2xl font-bold text-ink">
                      {count(result.ourProduct.scorecard.totalSteps, 'step')}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-ink-soft block">{result.referenceProduct.name}</span>
                    <span className="text-2xl font-bold text-ink-soft">
                      {count(result.referenceProduct.scorecard.totalSteps, 'step')}
                    </span>
                  </div>
                </div>
                <div className="mt-2 text-xs text-ink-soft">
                  {result.delta.stepDifference <= 0
                    ? '✓ Leaner step funnel.'
                    : `+${result.delta.stepDifference} extra steps compared to reference.`}
                </div>
              </div>

              {/* Form Fields */}
              <div className="rounded-card border border-edge bg-surface p-4 shadow-level-1">
                <div className="text-xs font-bold uppercase tracking-wider text-ink-soft">Form fields</div>
                <div className="mt-3 flex items-baseline justify-between">
                  <div>
                    <span className="text-xs text-ink-soft block">{result.ourProduct.name}</span>
                    <span className="text-2xl font-bold text-ink">
                      {count(result.ourProduct.scorecard.totalFields, 'field')}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-ink-soft block">{result.referenceProduct.name}</span>
                    <span className="text-2xl font-bold text-ink-soft">
                      {count(result.referenceProduct.scorecard.totalFields, 'field')}
                    </span>
                  </div>
                </div>
                <div className="mt-2 text-xs text-ink-soft">
                  {result.delta.fieldDifference <= 0
                    ? '✓ Minimal form burden.'
                    : `+${result.delta.fieldDifference} additional input fields required.`}
                </div>
              </div>

              {/* Click Depth */}
              <div className="rounded-card border border-edge bg-surface p-4 shadow-level-1">
                <div className="text-xs font-bold uppercase tracking-wider text-ink-soft">Clicks to get there</div>
                <div className="mt-3 flex items-baseline justify-between">
                  <div>
                    <span className="text-xs text-ink-soft block">{result.ourProduct.name}</span>
                    <span className="text-2xl font-bold text-ink">
                      {count(result.ourProduct.scorecard.clickDepth, 'click')}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-ink-soft block">{result.referenceProduct.name}</span>
                    <span className="text-2xl font-bold text-ink-soft">
                      {count(result.referenceProduct.scorecard.clickDepth, 'click')}
                    </span>
                  </div>
                </div>
                <div className="mt-2 text-xs text-ink-soft">Interactions needed on the way.</div>
              </div>
            </div>
          </section>

          {/* Interactive Pattern Matrix */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-ink">Helpful patterns each site has</h2>
            <p className="text-xs text-ink-soft">
              A ✗ means it wasn’t found on the pages looked at, not that the site can’t do it.
            </p>
            <div className="overflow-hidden rounded-card border border-edge bg-surface shadow-level-1">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-rule bg-panel/70 text-xs font-bold uppercase text-ink-soft">
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
                    <tr key={idx} className="hover:bg-panel/40">
                      <td className="px-4 py-3 font-bold text-ink">{p.pattern}</td>
                      <td className="px-4 py-3 text-center">
                        {p.ourProduct ? (
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-pass/20 font-bold text-pass">
                            ✓
                          </span>
                        ) : (
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-fail/20 font-bold text-fail">
                            ✗
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {p.referenceProduct ? (
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-pass/20 font-bold text-pass">
                            ✓
                          </span>
                        ) : (
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-fail/20 font-bold text-fail">
                            ✗
                          </span>
                        )}
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

          {/* AI UX Recommendations */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-ink">Ideas to try</h2>
                <p className="text-xs text-ink-soft">
                  {result.recommendations.length === 0
                    ? 'Based on what was found on both sites.'
                    : job?.aiUsed
                      ? 'Written by your AI from what was found on both sites, plus fixed checks.'
                      : 'From fixed checks on what was found. Add an AI key in Settings to get ideas written by an AI as well.'}
                </p>
              </div>

              {categories.length > 2 && (
                <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
                  {categories.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setSelectedCategory(c)}
                      className={`rounded-control px-2.5 py-1 font-bold capitalize transition-colors ${
                        selectedCategory === c
                          ? 'bg-stamp text-surface shadow-level-1'
                          : 'bg-surface text-ink-soft hover:text-ink'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {result.recommendations.length === 0 && (
              <p className="rounded-card border border-edge bg-surface p-4 text-sm text-ink-soft">
                Nothing to suggest: on what was measured, the two sites ask the same of a visitor.
              </p>
            )}
            <div className="space-y-3">
              {filteredRecs.map((rec) => {
                const impactTone =
                  rec.impact === 'High'
                    ? 'bg-fail/15 text-fail'
                    : rec.impact === 'Medium'
                      ? 'bg-warn/15 text-warn'
                      : 'bg-pass/15 text-pass';
                const effortTone =
                  rec.effort === 'Low'
                    ? 'bg-pass/15 text-pass'
                    : rec.effort === 'Medium'
                      ? 'bg-warn/15 text-warn'
                      : 'bg-fail/15 text-fail';
                return (
                  <div key={rec.id} className="rounded-card border border-edge bg-surface p-4 shadow-level-1 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-panel px-2 py-0.5 text-xs font-bold text-stamp uppercase border border-rule">
                          {rec.category}
                        </span>
                        <h3 className="font-bold text-ink">{rec.title}</h3>
                      </div>
                      <div className="flex items-center gap-2 text-xs font-bold">
                        <span className={`rounded px-2 py-0.5 ${impactTone}`}>Impact: {rec.impact}</span>
                        <span className={`rounded px-2 py-0.5 ${effortTone}`}>Effort: {rec.effort}</span>
                      </div>
                    </div>

                    <p className="text-xs text-ink-soft pt-1">{rec.rationale}</p>

                    <div className="rounded-control bg-stamp/5 border border-stamp/30 p-2.5 text-xs text-ink flex items-start gap-2">
                      <span className="font-bold text-stamp shrink-0">What to do:</span>
                      <span>{rec.suggestedAction}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
