import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { releaseVerdict, type AspectType, type Finding, type ReleaseReport } from '@qa/types';
import { downloadRunFile, finishAiReview, getRun, getStoredReleaseGates, RunnerError, triageProblem } from '../api';
import { DeveloperDetails } from '../components/DeveloperDetails';
import { SiteMap } from '../components/SiteMap';
import { ErrorMessage, FocusHeading, Notice, Spinner } from '../components/text';
import { count, formatDay, formatDuration, formatWhen, scrollBehavior } from '../lib/format';
import { gradeClasses } from '../lib/grades';
import { Link, PATHS } from '../lib/router';
import {
  ASPECTS,
  BUCKETS,
  aspectOf,
  category,
  groupProblems,
  howToFix,
  pageResults,
  plainTitle,
  plainTitleText,
  searchKind,
  summarizeReport,
  whyItMatters,
  type Bucket,
  type ProblemGroup,
} from '../lib/summary';
import { useDocumentTitle } from '../lib/title';
import { looksTechnical } from '../lib/translate';
import { hostOf } from '../lib/url';

/** Reports with more problems than this get filters and a search box. */
const FILTER_ABOVE = 10;
/** Remembered in this browser: the reader prefers the light, printable report. */
const LIGHT_KEY = 'qa-report-light';

export interface ReportActions {
  onTestAgain: (report: ReleaseReport) => void;
  onGoDeeper: (report: ReleaseReport, signIn: { username: string; password: string }) => void;
  /** A new check-up is being started from here. */
  starting: boolean;
  /** Why starting one failed, in plain words. */
  actionError: string | null;
}

/** One check-up's report, at an address that never changes: /reports/<runId>. */
export function ReportScreen({ runId, actions }: { runId: string; actions: ReportActions }) {
  const [report, setReport] = useState<ReleaseReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    getRun(runId)
      .then((r) => !cancelled && setReport(r))
      .catch((err) => !cancelled && setError(err instanceof RunnerError ? err.message : 'The report couldn’t be opened. Try again.'));
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useDocumentTitle(report ? `Report for ${hostOf(report.targetUrl)}` : 'Report');

  if (error) {
    return (
      <div className="mx-auto max-w-prose px-4 py-12 sm:px-6">
        <FocusHeading className="mb-4 text-3xl font-bold">This report can’t be shown</FocusHeading>
        <ErrorMessage>{error}</ErrorMessage>
        <Link to={PATHS.reports} className="btn-primary mt-6">
          Past check-ups
        </Link>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="mx-auto max-w-prose px-4 py-12 text-ink-soft sm:px-6">
        <Spinner label="Opening the report…" />
      </div>
    );
  }
  return <Report report={report} actions={actions} onReportChanged={setReport} />;
}

/** The light, printable report: the whole page turns light while the report is shown, if chosen. */
function useLightReport(): [boolean, (on: boolean) => void] {
  const [light, setLight] = useState(() => {
    try {
      return window.localStorage.getItem(LIGHT_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (light) root.dataset.theme = 'light';
    else delete root.dataset.theme;
    return () => {
      delete root.dataset.theme;
    };
  }, [light]);
  const set = (on: boolean) => {
    setLight(on);
    try {
      window.localStorage.setItem(LIGHT_KEY, on ? '1' : '0');
    } catch {
      // this browser won't remember it
    }
  };
  return [light, set];
}

function Report({ report, actions, onReportChanged }: { report: ReleaseReport; actions: ReportActions; onReportChanged: (report: ReleaseReport) => void }) {
  const summary = useMemo(() => summarizeReport(report), [report]);
  const host = hostOf(report.targetUrl);
  const { pages, statuses } = useMemo(() => pageResults(report), [report]);
  const [pageFilter, setPageFilter] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(pages.length <= 6);
  const problemsRef = useRef<HTMLElement>(null);
  const coverage = report.coverage;
  const [light, setLight] = useLightReport();
  const mustFix = useMemo(
    () => summary.counts.filter((c) => c.severity === 'Blocker' || c.severity === 'Major').reduce((n, c) => n + c.count, 0),
    [summary]
  );
  const tokens = Object.entries(report.aiUsage || {});
  const evaluatedGate = useMemo(() => {
    const gate = getStoredReleaseGates();
    return releaseVerdict(report.findings || [], gate);
  }, [report.findings]);

  useEffect(() => {
    const handleHash = () => {
      const raw = window.location.hash.slice(1);
      if (!raw) return;
      const decoded = decodeURIComponent(raw);
      const target = document.getElementById(decoded) || document.querySelector<HTMLElement>(`[data-problem-key="${decoded}"]`);
      if (target) {
        const button = target.querySelector<HTMLButtonElement>('button[aria-expanded]') || (target instanceof HTMLButtonElement ? target : null);
        if (button && button.getAttribute('aria-expanded') === 'false') {
          button.click();
        }
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('ring-2', 'ring-stamp', 'shadow-level-3', 'transition-all');
        window.setTimeout(() => {
          target.classList.remove('ring-2', 'ring-stamp', 'shadow-level-3');
        }, 3000);
      }
    };

    const timer = window.setTimeout(handleHash, 200);
    window.addEventListener('hashchange', handleHash);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('hashchange', handleHash);
    };
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
      <nav aria-label="Breadcrumbs" className="flex flex-wrap items-center gap-2 text-sm text-ink-soft print:hidden">
        <Link to={PATHS.reports} className="hover:text-ink transition-colors">
          Past check-ups
        </Link>
        <span aria-hidden="true" className="text-rule">/</span>
        <button
          type="button"
          onClick={() => setPageFilter(null)}
          className={`hover:text-ink transition-colors ${!pageFilter ? 'font-bold text-ink' : ''}`}
        >
          {host}
        </button>
        <span aria-hidden="true" className="text-rule">/</span>
        <span className="font-mono text-xs text-ink-soft">run #{report.runId.slice(0, 8)}</span>
        {pageFilter && (
          <>
            <span aria-hidden="true" className="text-rule">/</span>
            <span className="font-mono text-xs font-bold text-stamp">{pageFilter}</span>
            <button
              type="button"
              onClick={() => setPageFilter(null)}
              className="ml-1 text-xs text-ink-soft hover:text-ink"
              title="Clear page filter"
            >
              (show all)
            </button>
          </>
        )}
      </nav>

      <header className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="shrink-0 py-2">
          <FocusHeading
            className={`stamp inline-block rounded-card border-4 px-5 py-2 font-stamp text-4xl uppercase leading-none tracking-wide sm:text-5xl ${
              summary.ready ? 'border-pass text-pass' : 'border-fail text-fail'
            }`}
          >
            {summary.stamp}
          </FocusHeading>
        </div>
        <div className="min-w-0">
          <p className="text-sm text-ink-soft">
            Check-up of <span className="font-bold text-ink">{host}</span> · {formatWhen(report.timestamp)}
          </p>
          <p className="mt-1 text-2xl font-bold text-ink">{summary.reason}</p>
          <p className="mt-1 text-ink-soft">
            {summary.total === 0 ? summary.headline : `${mustFix} must fix · ${count(summary.total, 'problem', 'problems')} in all`}
            {coverage.totalTestPoints > 0 && ` · ${count(coverage.totalTestPoints, 'test', 'tests')} in ${formatDuration(report.durationMs)}`}
          </p>
          {summary.readOnly && <p className="mt-2 text-sm text-ink">Only looked at: nothing was sent or changed, so forms weren’t tested.</p>}
          {report.testedWithApprovedPlan && <p className="mt-2 text-sm text-ink">Tested with the plan you approved on {formatDay(report.testedWithApprovedPlan)}.</p>}
        </div>
      </header>

      {report.partial && (
        <Notice tone="warn" title="A partial check-up">
          Testing was stopped after {report.partial.done} of {report.partial.planned} tests. What wasn’t tested isn’t in this report, so it can’t say the whole site is
          ready.
        </Notice>
      )}

      <ReportActionsBar report={report} actions={actions} light={light} onLight={setLight} />

      {/* Quality Gate Status */}
      {evaluatedGate.gate && (
        <section aria-labelledby="gate-verdict-title" className="rounded-panel border border-edge bg-surface/60 p-4 shadow-level-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span id="gate-verdict-title" className="text-xs font-bold uppercase tracking-wider text-ink-soft">Quality Gate:</span>
              <span className="font-bold text-ink">
                {evaluatedGate.gate.strictAccessibility ? 'Strict' : evaluatedGate.gate.maxBlockers === 0 ? 'Standard' : 'Lenient'}
              </span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${
                  evaluatedGate.ready ? 'bg-pass/15 text-pass' : 'bg-fail/15 text-fail'
                }`}
              >
                {evaluatedGate.ready ? 'Passed' : 'Breached'}
              </span>
            </div>
            <Link to={PATHS.settings} className="text-xs font-bold text-stamp hover:underline">
              Adjust Gate Criteria →
            </Link>
          </div>
          {evaluatedGate.breaches && evaluatedGate.breaches.length > 0 && (
            <div className="mt-2.5 space-y-1">
              <span className="text-xs font-bold text-fail">Threshold Breaches:</span>
              <ul className="list-disc pl-5 text-xs text-fail space-y-0.5">
                {evaluatedGate.breaches.map((b: string, idx: number) => (
                  <li key={idx}>{b}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <VisualReview report={report} onReportChanged={onReportChanged} />

      <Problems report={report} pageFilter={pageFilter} onPageFilter={setPageFilter} sectionRef={problemsRef} onReportChanged={onReportChanged} />

      {/* Only once there's an earlier check-up to compare with. */}
      {report.history?.previousTimestamp && <Changes report={report} />}

      <Improvements report={report} />

      <AspectGrades report={report} />
      <MarketingPanel report={report} />

      <section aria-labelledby="map-title">
        <details
          className="rounded-card border border-edge bg-surface/40 shadow-level-2"
          open={mapOpen}
          onToggle={(e) => setMapOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="flex min-h-[56px] cursor-pointer items-center px-4 py-3">
            <h2 id="map-title" className="text-2xl font-bold">
              Map of results
            </h2>
          </summary>
          {mapOpen && (
            <div className="border-t border-rule p-4">
              <p className="mb-3 text-ink-soft">Every page that was tested, coloured by what was found on it. Choose a page to see its problems.</p>
              <div className="flex h-[30rem] overflow-hidden rounded-card border border-edge">
                <SiteMap
                  pages={pages}
                  journeys={report.siteMap?.journeys}
                  mode="report"
                  maxCards={12}
                  selectedPagePath={pageFilter}
                  pageStatuses={statuses}
                  onSelectPage={(path) => {
                    setPageFilter(path);
                    problemsRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
                  }}
                />
              </div>
            </div>
          )}
        </details>
      </section>

      {(report.notes?.length ?? 0) > 0 && (
        <section aria-labelledby="notes-title">
          <h2 id="notes-title" className="mb-3 text-2xl font-bold">
            Good to know
          </h2>
          <ul className="max-w-prose list-disc space-y-1 pl-5 text-ink">
            {report.notes!.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      <details className="rounded-md border border-rule bg-canvas/60">
        <summary className="min-h-[44px] cursor-pointer px-4 py-3 font-bold">Details for developers</summary>
        <div className="space-y-3 border-t border-rule p-4 text-sm">
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-quiet min-h-[44px] px-3 text-sm" onClick={() => void downloadRunFile(report.runId, 'report.md')}>
              Download report.md
            </button>
            <button type="button" className="btn-quiet min-h-[44px] px-3 text-sm" onClick={() => void downloadRunFile(report.runId, 'findings.json')}>
              Download findings.json
            </button>
          </div>
          <dl className="grid gap-x-4 gap-y-1 font-mono text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-ink-soft">Run</dt>
            <dd className="break-all text-ink">{report.runId}</dd>
            <dt className="text-ink-soft">Address</dt>
            <dd className="break-all text-ink">{report.targetUrl}</dd>
            <dt className="text-ink-soft">Tests</dt>
            <dd className="text-ink">
              {coverage.passed} passed · {coverage.failed} failed · {coverage.blocked} blocked · {coverage.skipped} skipped · {coverage.couldNotVerify} could not verify
            </dd>
            <dt className="text-ink-soft">Findings</dt>
            <dd className="text-ink">
              {summary.findings} behind the {count(summary.total, 'problem', 'problems')} (the same problem on several pages or sizes is one problem)
            </dd>
            {report.aiModels?.text && (
              <>
                <dt className="text-ink-soft">AI models</dt>
                <dd className="break-all text-ink">
                  {report.aiModels.text}
                  {report.aiModels.vision ? ` · ${report.aiModels.vision}` : ''}
                </dd>
              </>
            )}
            {tokens.map(([stage, u]) => (
              <div key={stage} className="contents">
                <dt className="text-ink-soft">AI tokens: {stage}</dt>
                <dd className="text-ink">
                  {u!.requests} requests · {u!.promptTokens.toLocaleString()} sent · {u!.completionTokens.toLocaleString()} answered
                  {u!.reasoningTokens ? ` (${u!.reasoningTokens.toLocaleString()} thinking)` : ''}
                  {u!.truncated ? ` · ${u!.truncated} cut off` : ''}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </details>
    </div>
  );
}

/** How far the AI's look over the screens got, and a way to finish it when requests are available again. */
function VisualReview({ report, onReportChanged }: { report: ReleaseReport; onReportChanged: (report: ReleaseReport) => void }) {
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ tone: 'pass' | 'fail' | 'warn'; text: string } | null>(null);
  const review = report.visualReview;
  if (!review || review.remaining === 0) return null;
  return (
    <Notice
      tone="warn"
      title={`The AI looked over ${review.reviewed} of ${review.total} screens`}
      actions={
        <button
          type="button"
          className="btn-primary min-h-[44px] px-4 text-sm"
          disabled={working}
          onClick={async () => {
            setWorking(true);
            setMessage(null);
            try {
              const result = await finishAiReview();
              onReportChanged(await getRun(report.runId));
              setMessage(
                result.remainingCount > 0
                  ? { tone: 'warn', text: `${result.reviewedCount} more looked over; ${result.remainingCount} left for another time.` }
                  : { tone: 'pass', text: 'All the screens are looked over now.' }
              );
            } catch (err) {
              setMessage({ tone: 'fail', text: err instanceof RunnerError ? err.message : 'That couldn’t be finished. Try again later.' });
            } finally {
              setWorking(false);
            }
          }}
        >
          {working ? <Spinner label="Looking over the screens…" /> : `Look over the other ${count(review.remaining, 'screen', 'screens')}`}
        </button>
      }
    >
      Today’s AI requests ran out first, so “Looks and reads well” only covers what was looked at.
      {message && <span className={`mt-1 block font-bold text-${message.tone}`}>{message.text}</span>}
    </Notice>
  );
}

function ReportActionsBar({
  report,
  actions,
  light,
  onLight,
}: {
  report: ReleaseReport;
  actions: ReportActions;
  light: boolean;
  onLight: (on: boolean) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [deeper, setDeeper] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="print:hidden">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={downloading}
          onClick={async () => {
            setDownloading(true);
            setDownloadError(null);
            try {
              await downloadRunFile(report.runId, 'report.html');
            } catch (err) {
              setDownloadError(err instanceof Error ? err.message : 'The report couldn’t be downloaded. Try again.');
            } finally {
              setDownloading(false);
            }
          }}
        >
          {downloading ? <Spinner label="Downloading…" /> : 'Download the report'}
        </button>
        <button type="button" className="btn-quiet" disabled={actions.starting} onClick={() => actions.onTestAgain(report)}>
          {actions.starting ? <Spinner label="Starting…" /> : 'Test again'}
        </button>
        <button type="button" className="btn-link" aria-expanded={deeper} onClick={() => setDeeper((d) => !d)}>
          Go deeper: test the signed-in pages
        </button>
        <span className="flex flex-wrap items-center gap-3 sm:ml-auto">
          <button type="button" className="btn-link" aria-pressed={light} onClick={() => onLight(!light)}>
            {light ? 'Dark view' : 'Light view'}
          </button>
          <button type="button" className="btn-link" onClick={() => window.print()}>
            Print
          </button>
        </span>
      </div>
      {downloadError && <ErrorMessage>{downloadError}</ErrorMessage>}
      {actions.actionError && <ErrorMessage>{actions.actionError}</ErrorMessage>}

      {deeper && (
        <form
          className="mt-4 max-w-xl space-y-4 rounded-lg border-2 border-stamp bg-surface p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (username.trim() && password) actions.onGoDeeper(report, { username: username.trim(), password });
          }}
        >
          <div>
            <h2 className="text-lg font-bold">Test the pages behind a sign-in</h2>
            <p className="text-sm text-ink-soft">
              A new check-up signs in with this account, then scans and plans the pages it can reach. Use a test account, not a real
              person’s. Next time you can add a sign-in when you start the check-up, or from the plan.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="deeper-username" className="label">
                Email or username
              </label>
              <input id="deeper-username" className="field" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div>
              <label htmlFor="deeper-password" className="label">
                Password
              </label>
              <input id="deeper-password" type="password" className="field" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </div>
          <button type="submit" className="btn-primary" disabled={actions.starting || !username.trim() || !password}>
            Scan the signed-in pages
          </button>
        </form>
      )}
    </div>
  );
}

/** The marketing basics one by one, so the Marketing score is never all there is to read. */
function MarketingPanel({ report }: { report: ReleaseReport }) {
  const marketing = report.marketing;
  if (!marketing) return null;
  const mark = (c: NonNullable<ReleaseReport['marketing']>['checks'][number]) =>
    c.status === 'ok'
      ? { icon: '✓', label: 'OK', tone: 'text-pass' }
      : c.status === 'gap'
        ? c.kind === 'opinion'
          ? { icon: '+', label: 'Worth adding', tone: 'text-warn' }
          : { icon: '✗', label: 'Missing', tone: 'text-fail' }
        : { icon: '–', label: 'Not checked', tone: 'text-ink-soft' };
  return (
    <section aria-labelledby="marketing-title">
      <h2 id="marketing-title" className="mb-1 text-2xl font-bold">
        Marketing basics
      </h2>
      <p className="mb-3 max-w-prose text-ink-soft">
        What a visitor or a marketer looks for, read from {marketing.readPages.length === 1 ? 'one page' : `${marketing.readPages.length} pages`} ({marketing.readPages.slice(0, 3).join(', ')}
        {marketing.readPages.length > 3 ? ', …' : ''}). Items marked as suggestions depend on what the site is for, so they never count as faults.
      </p>
      <ul className="divide-y divide-rule rounded-card border border-edge bg-surface shadow-level-1">
        {marketing.checks.map((c) => {
          const m = mark(c);
          return (
            <li key={c.key} className="flex items-start gap-3 px-4 py-3">
              <span aria-hidden="true" className={`mt-0.5 w-5 shrink-0 text-center font-bold ${m.tone}`}>
                {m.icon}
              </span>
              <span className="min-w-0">
                <span className="block font-bold text-ink">
                  {c.label}
                  {c.kind === 'opinion' && <span className="ml-2 text-xs font-normal text-ink-soft">suggestion</span>}
                </span>
                <span className="block text-sm text-ink-soft">
                  <span className={`font-bold ${m.tone}`}>{m.label}.</span> {c.detail}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AspectGrades({ report }: { report: ReleaseReport }) {
  if (!report.grades) return null;
  return (
    <section aria-labelledby="aspects-title">
      <h2 id="aspects-title" className="mb-3 text-2xl font-bold">
        How each area did
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ASPECTS.map((aspect) => {
          const data = report.grades!.aspects[aspect];
          const checked = data && data.checked !== false;
          const sub = aspect === 'Findable' ? data?.subBreakdown : undefined;
          const problems = checked ? groupProblems(report.findings.filter((f) => data.findings.includes(f.id))) : null;
          const problemCount = problems ? problems['must-fix'].length + problems['should-fix'].length + problems.suggestion.length : 0;
          return (
            <li key={aspect} className="flex flex-col justify-between gap-3 rounded-card border border-edge bg-surface p-4 shadow-level-1">
              <div className="flex items-center justify-between gap-3">
                <span>
                  <span className="block font-bold text-ink">{aspect}</span>
                  <span className="block text-sm text-ink-soft">{checked ? count(problemCount, 'problem', 'problems') : 'Nothing here was checked this time'}</span>
                </span>
                {checked ? (
                  <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-control border-2 text-2xl font-bold ${gradeClasses(data.grade)}`}>
                    <span className="sr-only">Grade </span>
                    {data.grade}
                  </span>
                ) : (
                  <span className="shrink-0 rounded-control border-2 border-edge px-2 py-1 text-sm font-bold text-ink-soft">Not checked</span>
                )}
              </div>
              {checked && sub && (
                <>
                  <dl className="mt-1 grid grid-cols-2 gap-1 border-t border-rule pt-2 text-sm sm:grid-cols-4">
                    {(
                      [
                        ['Search', sub.seo, 'How search engines, such as Google, find and list the site (SEO).'],
                        ['AI answers', sub.aeo, 'How answer engines and AI assistants pick answers from the site (AEO).'],
                        ['AI search', sub.geo, 'How AI search tools read and quote the site (GEO).'],
                        ['Marketing', sub.marketing, 'Share previews, a clear call to action, contact details, analytics and social links.'],
                      ] as const
                    ).map(([label, part, hint]) => (
                      <div key={label} title={hint}>
                        <dt className="text-ink-soft">{label}</dt>
                        <dd className="font-bold text-ink">{part?.checked === false ? <span className="font-normal text-ink-soft">Not checked</span> : `${part?.score ?? 100}%`}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-2 border-t border-rule pt-2">
                    <Link
                      to={PATHS.visibility(report.runId)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                    >
                      See search, AI & marketing visibility →
                    </Link>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Improvements({ report }: { report: ReleaseReport }) {
  const recommendations = (report.recommendations || []).slice(0, 5);
  if (recommendations.length === 0) return null;
  return (
    <section aria-labelledby="improve-title">
      <h2 id="improve-title" className="mb-3 text-2xl font-bold">
        What to improve first
      </h2>
      <ol className="space-y-3">
        {recommendations.map((rec) => {
          const plainSummary = rec.summary && !looksTechnical(rec.summary) ? rec.summary : null;
          const plainFix = rec.suggestedFix && !looksTechnical(rec.suggestedFix) ? rec.suggestedFix : null;
          return (
            <li key={rec.id} className="rounded-card border border-edge bg-surface p-4 shadow-level-1">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`rounded-control border px-1.5 font-bold ${rec.category === 'quick-win' ? 'border-pass text-pass' : 'border-stamp text-stamp'}`}>
                  {rec.category === 'quick-win' ? 'Quick win' : 'Bigger change'}
                </span>
                <span className="text-ink-soft">
                  {rec.severity === 'Blocker' ? 'Blocks release · ' : rec.severity === 'Major' ? 'Must fix · ' : ''}
                  {rec.aspect} · {rec.effort} effort · {rec.impact} impact
                  {rec.affectedPages.length > 0 && ` · ${count(rec.affectedPages.length, 'page', 'pages')}`}
                </span>
              </p>
              <h3 className="mt-1 font-bold text-ink">{plainTitleText(rec.title)}</h3>
              {/* Technical wording stays in the developer details; a plain line takes its place here. */}
              <p className="mt-1 text-sm text-ink-soft">
                {plainSummary ?? whyItMatters({ title: plainTitleText(rec.title), aspect: rec.aspect })}
              </p>
              <p className="mt-1 text-sm text-ink">
                <strong>How to fix: </strong>
                {plainFix ?? 'A developer can see exactly what to change under the problem’s “Details for developers”.'}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Changes({ report }: { report: ReleaseReport }) {
  const history = report.history!;
  const items = [
    { label: 'Fixed since last time', value: history.fixedFindingFingerprints.length, tone: 'text-pass' },
    { label: 'New', value: history.newFindingFingerprints.length, tone: 'text-fail' },
    { label: 'Still there', value: history.openFindingFingerprints.length, tone: 'text-warn' },
  ];
  return (
    <section aria-labelledby="changes-title">
      <h2 id="changes-title" className="mb-1 text-2xl font-bold">
        Since the last check-up
      </h2>
      {history.previousTimestamp && <p className="mb-3 text-ink-soft">Compared with the check-up on {formatDay(history.previousTimestamp)}.</p>}
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col-reverse rounded-card border border-edge bg-surface p-4 text-center shadow-level-1">
            <dt className="text-sm text-ink-soft">{item.label}</dt>
            <dd className={`text-3xl font-bold ${item.tone}`}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface Filters {
  search: string;
  bucket: Bucket | 'all';
  aspect: AspectType | 'all';
}

function Problems({
  report,
  pageFilter,
  onPageFilter,
  sectionRef,
  onReportChanged,
}: {
  report: ReleaseReport;
  pageFilter: string | null;
  onPageFilter: (page: string | null) => void;
  sectionRef: RefObject<HTMLElement>;
  onReportChanged: (report: ReleaseReport) => void;
}) {
  const [filters, setFilters] = useState<Filters>({ search: '', bucket: 'all', aspect: 'all' });
  const [showHidden, setShowHidden] = useState(false);
  const withFilters = report.findings.length > FILTER_ABOVE;
  const problemPages = useMemo(() => [...new Set(report.findings.map((f) => f.where.urlPath))].sort(), [report.findings]);
  const dismissed = useMemo(() => report.findings.filter((f) => f.triageStatus === 'Intended' || f.triageStatus === 'False Positive'), [report.findings]);
  const dismissedTitles = useMemo(() => [...new Set(dismissed.map((f) => f.title))], [dismissed]);

  const shown = useMemo(() => {
    const words = filters.search.trim().toLowerCase();
    const matches = (f: Finding) =>
      (!pageFilter || f.where.urlPath === pageFilter || !!f.seenAt?.pages.includes(pageFilter)) &&
      (filters.aspect === 'all' || (f.aspect ?? aspectOf(f.checker)) === filters.aspect) &&
      (!words || [plainTitle(f), category(f), f.where.urlPath].join(' ').toLowerCase().includes(words));
    return groupProblems(report.findings.filter(matches));
  }, [report.findings, pageFilter, filters]);

  const buckets = BUCKETS.filter((b) => (filters.bucket === 'all' || filters.bucket === b.id) && shown[b.id].length > 0);
  const filtered = !!pageFilter || filters.search.trim() !== '' || filters.bucket !== 'all' || filters.aspect !== 'all';

  const triage = async (titles: string[], status: 'Intended' | 'False Positive' | null, reason?: string) => {
    onReportChanged(await triageProblem(report.runId, titles, status, reason));
  };

  return (
    <section ref={sectionRef} aria-labelledby="problems-title" className="scroll-mt-20">
      <h2 id="problems-title" className="mb-3 text-2xl font-bold">
        Problems found
      </h2>

      {withFilters && (
        <div role="search" aria-label="Filter the problems" className="mb-4 grid gap-3 rounded-lg border border-rule bg-panel p-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
          <div>
            <label htmlFor="problem-search" className="mb-1 block text-sm font-bold">
              Search
            </label>
            <input
              id="problem-search"
              type="search"
              className="field py-2 text-sm"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="problem-bucket" className="mb-1 block text-sm font-bold">
              How serious
            </label>
            <select
              id="problem-bucket"
              className="field py-2 text-sm"
              value={filters.bucket}
              onChange={(e) => setFilters((f) => ({ ...f, bucket: e.target.value as Filters['bucket'] }))}
            >
              <option value="all">All</option>
              {BUCKETS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="problem-page" className="mb-1 block text-sm font-bold">
              Page
            </label>
            <select id="problem-page" className="field py-2 text-sm" value={pageFilter ?? ''} onChange={(e) => onPageFilter(e.target.value || null)}>
              <option value="">All pages</option>
              {problemPages.map((page) => (
                <option key={page} value={page}>
                  {page}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="problem-aspect" className="mb-1 block text-sm font-bold">
              Area
            </label>
            <select
              id="problem-aspect"
              className="field py-2 text-sm"
              value={filters.aspect}
              onChange={(e) => setFilters((f) => ({ ...f, aspect: e.target.value as Filters['aspect'] }))}
            >
              <option value="all">All areas</option>
              {ASPECTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {pageFilter && (
        <p className="mb-4 text-ink">
          Showing the problems on <span className="break-all font-mono">{pageFilter}</span>.{' '}
          <button type="button" className="btn-link inline-flex min-h-[44px] items-center" onClick={() => onPageFilter(null)}>
            Show every page
          </button>
        </p>
      )}

      {report.findings.length === 0 ? (
        <p className="rounded-lg border border-pass bg-pass-tint p-6 text-center font-bold text-pass">No problems found.</p>
      ) : buckets.length === 0 ? (
        <p className="text-ink-soft">{filtered ? 'No problems match these filters.' : 'No problems count against this check-up.'}</p>
      ) : (
        <div className="space-y-8">
          {buckets.map((bucket) => (
            <section key={bucket.id} aria-labelledby={`bucket-${bucket.id}`}>
              <h3 id={`bucket-${bucket.id}`} className="text-xl font-bold">
                {bucket.title} <span className="font-normal text-ink-soft">({shown[bucket.id].length})</span>
              </h3>
              <p className="mb-3 text-sm text-ink-soft">{bucket.intro}</p>
              <ul className="space-y-2">
                {shown[bucket.id].map((group) => (
                  <ProblemItem key={group.key} group={group} report={report} onTriage={triage} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {dismissedTitles.length > 0 && (
        <div className="mt-6 text-sm text-ink-soft">
          <p>
            {count(dismissedTitles.length, 'problem is', 'problems are')} hidden because you marked {dismissedTitles.length === 1 ? 'it' : 'them'} as intended or not
            a problem.{' '}
            <button type="button" className="btn-link text-sm" aria-expanded={showHidden} onClick={() => setShowHidden((s) => !s)}>
              {showHidden ? 'Hide them' : 'Show them'}
            </button>
          </p>
          {showHidden && (
            <ul className="mt-2 space-y-1">
              {dismissedTitles.map((title) => {
                const f = dismissed.find((d) => d.title === title)!;
                return (
                  <li key={title} className="flex flex-wrap items-center gap-x-3">
                    <span className="text-ink">{plainTitleText(title)}</span>
                    <span>
                      ({f.triageStatus === 'Intended' ? 'intended' : 'not a problem'}
                      {f.triageReason ? `: ${f.triageReason}` : ''})
                    </span>
                    <button type="button" className="btn-link text-sm" onClick={() => void triage([title], null)}>
                      Undo
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

const BUCKET_BORDER: Record<Bucket, string> = {
  'must-fix': 'border-l-fail',
  'should-fix': 'border-l-warn',
  suggestion: 'border-l-stamp',
  'to-confirm': 'border-l-edge',
};

/**
 * One problem: why it matters and how to fix it, where it was found, the details for developers,
 * and a way to say it's intended or not a problem.
 */
function ProblemItem({
  group,
  report,
  onTriage,
}: {
  group: ProblemGroup;
  report: ReleaseReport;
  onTriage: (titles: string[], status: 'Intended' | 'False Positive' | null, reason?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState<'Intended' | 'False Positive' | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedMd, setCopiedMd] = useState(false);
  const first = group.findings[0];
  const id = `problem-${group.key.replace(/[^A-Za-z0-9_-]+/g, '_')}`;
  const kinds = [...new Map(group.findings.map((f) => searchKind(f)).filter((k): k is NonNullable<typeof k> => !!k).map((k) => [k.label, k])).values()];
  const titles = [...new Set(group.findings.map((f) => f.title))];

  const copyMarkdown = async () => {
    const md = [
      `### ${group.title} (${group.bucket})`,
      `**Category**: ${group.category}`,
      `**Pages**: ${group.pages.join(', ')}`,
      '',
      `**Why it matters**: ${whyItMatters(group)}`,
      `**How to fix**: ${howToFix(group, looksTechnical)}`,
      '',
      `*Reported in run: \`${report.runId}\` for ${report.targetUrl}*`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(md);
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 2500);
    } catch {
      // fallback
    }
  };

  return (
    <li id={id} data-problem-key={group.key} className={`rounded-card border border-l-4 border-rule bg-surface/80 shadow-level-1 transition-all ${BUCKET_BORDER[group.bucket]}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? `${id}-details` : undefined}
        onClick={() => setOpen((o) => !o)}
        className="interactive flex w-full items-start justify-between gap-3 rounded-card p-4 text-left hover:bg-panel/80 hover:shadow-level-2"
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2 font-bold text-ink">
            {kinds.map((k) => (
              <span key={k.label} title={k.hint} className="rounded border border-stamp/50 px-1.5 py-0.5 text-xs font-bold text-stamp">
                {k.label}
              </span>
            ))}
            <span>{group.title}</span>
          </span>
          <span className="block text-sm text-ink-soft">
            {/* The tag already names a search category; the line says the rest. */}
            {group.category
              .split(' · ')
              .filter((c) => !kinds.some((k) => k.label === c))
              .map((c) => `${c} · `)
              .join('')}
            {group.pages.length === 1 ? <span className="break-all font-mono">{group.pages[0]}</span> : count(group.pages.length, 'page', 'pages')}
          </span>
        </span>
        <span aria-hidden="true" className="mt-1 shrink-0 text-ink-soft">
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <div id={`${id}-details`} className="space-y-3 border-t border-rule px-4 pb-4 pt-3">
          <p className="text-sm text-ink">
            <strong>Why it matters: </strong>
            {whyItMatters(group)}
          </p>
          <p className="text-sm text-ink">
            <strong>How to fix: </strong>
            {howToFix(group, looksTechnical)}
          </p>
          {group.aspects.length > 1 && <p className="text-sm text-ink-soft">It counts toward {group.aspects.join(' and ')}.</p>}
          <div>
            <p className="text-sm text-ink-soft">Found on:</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {group.pages.map((page) => (
                <li key={page} className="break-all rounded border border-rule bg-canvas px-2 py-0.5 font-mono text-sm text-ink">
                  {page}
                </li>
              ))}
            </ul>
          </div>

          <div className="print:hidden">
            {marking ? (
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSaving(true);
                  setError(null);
                  try {
                    await onTriage(titles, marking, reason);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'That couldn’t be saved.');
                    setSaving(false);
                  }
                }}
              >
                <label className="sr-only" htmlFor={`${id}-reason`}>
                  Why (optional)
                </label>
                <input
                  id={`${id}-reason`}
                  className="field flex-1 py-2 text-sm"
                  placeholder="Why? (optional, for whoever reads this later)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="btn-primary min-h-[44px] px-4 text-sm" disabled={saving}>
                  {marking === 'Intended' ? 'Mark as intended' : 'Mark as not a problem'}
                </button>
                <button type="button" className="btn-link text-sm" onClick={() => setMarking(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex flex-wrap gap-x-4 text-sm">
                  <button type="button" className="btn-link text-sm" onClick={() => setMarking('False Positive')}>
                    Not a problem
                  </button>
                  <button type="button" className="btn-link text-sm" onClick={() => setMarking('Intended')}>
                    It’s intended
                  </button>
                </p>
                <button
                  type="button"
                  className="btn-quiet rounded-control min-h-[36px] px-3 text-xs font-bold text-ink hover:text-stamp"
                  onClick={copyMarkdown}
                  title="Copy problem details formatted as Markdown"
                >
                  {copiedMd ? '✓ Copied Markdown' : 'Copy as Markdown'}
                </button>
              </div>
            )}
            {marking && <p className="mt-1 text-sm text-ink-soft">It’s hidden from this report and not raised again for this site. You can undo it.</p>}
            {error && (
              <p role="alert" className="text-sm text-fail">
                {error}
              </p>
            )}
          </div>

          <DeveloperDetails finding={first} runId={report.runId} targetUrl={report.targetUrl} />
        </div>
      )}
    </li>
  );
}
