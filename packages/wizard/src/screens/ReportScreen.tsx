import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import {
  releaseVerdict,
  type AspectType,
  type Finding,
  type FindingSeverity,
  type ReleaseReport,
} from '@qa/types';
import {
  acceptJudgement,
  downloadRunFile,
  finishAiReview,
  getRun,
  getStoredReleaseGates,
  recordSpecOverride,
  RunnerError,
  triageProblem,
} from '../api';
import { CopyButton, DeveloperDetails } from '../components/DeveloperDetails';
import { SiteMap } from '../components/SiteMap';
import { ErrorMessage, FocusHeading, Notice, Spinner } from '../components/text';
import { Badge, Disclosure, LoadError, Page, Section } from '../components/ui';
import { skipReasonText } from '../lib/coverage-text';
import { count, formatDay, formatDuration, scrollBehavior } from '../lib/format';
import { gradeClasses } from '../lib/grades';
import { slowerNote } from '../lib/slower-note';
import { Link, PATHS } from '../lib/router';
import {
  ASPECTS,
  BUCKETS,
  aspectOf,
  category,
  groupProblems,
  howToFix,
  judgementByRole,
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
import { documentedLine } from '../lib/plan-sources';

/** Reports with more problems than this get filters and a search box. */
const FILTER_ABOVE = 10;
/** "Fix these first" shows this many until "Show all". */
const FIX_FIRST_SHOWN = 3;

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
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    getRun(runId)
      .then((r) => !cancelled && setReport(r))
      .catch(
        (err) =>
          !cancelled && setError(err instanceof RunnerError ? err.message : 'The report couldn’t be opened. Try again.')
      );
    return () => {
      cancelled = true;
    };
  }, [runId, attempt]);

  useDocumentTitle(report ? `Report for ${hostOf(report.targetUrl)}` : 'Report');

  if (error) {
    return (
      <Page width="prose">
        <BackLink />
        <FocusHeading className="mb-4 mt-6 font-stamp text-3xl font-bold sm:text-4xl">
          This report can’t be shown
        </FocusHeading>
        <LoadError title="The report didn’t open" onRetry={() => setAttempt((n) => n + 1)}>
          {error}
        </LoadError>
      </Page>
    );
  }
  if (!report) {
    return (
      <Page width="prose">
        <p className="text-ink-soft">
          <Spinner label="Opening the report…" />
        </p>
      </Page>
    );
  }
  return <Report report={report} actions={actions} onReportChanged={setReport} />;
}

function BackLink() {
  return (
    <Link to={PATHS.reports} className="btn-link -my-2 w-fit text-sm print:hidden">
      <span aria-hidden="true">←&nbsp;</span>
      Past check-ups
    </Link>
  );
}

/**
 * "2 blockers, and your rule allows 0." from the verdict's counts and the rule's limits; area score
 * breaches have no counts, so their own texts follow.
 */
function ruleBreachText(v: ReturnType<typeof releaseVerdict>): string {
  const limits: Array<[keyof typeof v.counts, string, number | undefined]> = [
    ['Blocker', 'blocker', v.gate?.maxBlockers ?? 0],
    ['Major', 'major', v.gate?.maxMajors],
    ['Minor', 'minor', v.gate?.maxMinors],
  ];
  const over = limits.filter(([sev, , max]) => max !== undefined && v.counts[sev] > max);
  const rest = (v.breaches ?? []).filter((b) => !/^\d+ (blocker|major|minor) problems? \(/.test(b));
  const parts: string[] = [];
  if (over.length === 1) {
    const [sev, word, max] = over[0];
    parts.push(`${v.counts[sev]} ${word}${v.counts[sev] === 1 ? '' : 's'}, and your rule allows ${max}.`);
  } else if (over.length > 1) {
    parts.push(
      `${over.map(([sev, word, max]) => `${v.counts[sev]} ${word}${v.counts[sev] === 1 ? '' : 's'} (your rule allows ${max})`).join(', ')}.`
    );
  }
  parts.push(...rest.map((b) => `${b}.`));
  return parts.join(' ');
}

const SEVERITY_RANK: FindingSeverity[] = ['Blocker', 'Major', 'Minor', 'Suggestion'];

/** A problem row: one per distinct problem, with every key it stands for (for #deep links). */
export interface ProblemRow extends ProblemGroup {
  keys: string[];
}

/**
 * Display only: rows for the same plain problem in the same area are one row that lists every page.
 * (The verdict keeps its own counting; this is how the list reads.)
 */
export function mergeSameProblem(groups: ProblemGroup[]): ProblemRow[] {
  const rows = new Map<string, ProblemRow>();
  for (const g of groups) {
    const id = `${plainTitleText(g.title).toLowerCase()}|${g.aspect}`;
    const row = rows.get(id);
    if (!row) {
      rows.set(id, { ...g, keys: [g.key], findings: [...g.findings], pages: [...g.pages], aspects: [...g.aspects] });
      continue;
    }
    row.keys.push(g.key);
    row.findings.push(...g.findings);
    for (const page of g.pages) if (!row.pages.includes(page)) row.pages.push(page);
    for (const aspect of g.aspects) if (!row.aspects.includes(aspect)) row.aspects.push(aspect);
    row.category = [...new Set([...row.category.split(' · '), ...g.category.split(' · ')])].join(' · ');
    if (SEVERITY_RANK.indexOf(g.severity) < SEVERITY_RANK.indexOf(row.severity)) row.severity = g.severity;
  }
  return [...rows.values()].sort(
    (a, b) => SEVERITY_RANK.indexOf(a.severity) - SEVERITY_RANK.indexOf(b.severity) || b.pages.length - a.pages.length
  );
}

/** Each area in the words of the headline: "mostly in security and phone layout". */
const AREA_WORDS: Record<AspectType, string> = {
  Works: 'things that break',
  Accessible: 'accessibility',
  'Fast and mobile': 'speed and phone layout',
  Findable: 'search',
  Secure: 'security',
  'Looks and reads well': 'looks and wording',
};

/**
 * The one plain line under the verdict, from the structured data (never the long verdict sentence):
 * how many problems must be fixed first, and the one or two areas most of them are in.
 */
export function reportHeadline(input: {
  ready: boolean;
  /** Distinct problems that must be fixed before release, with the area each counts toward. */
  mustFix: Array<{ aspect: AspectType }>;
  /** Every distinct problem that counts. */
  total: number;
  /** Areas whose grade or score is below the rule's minimum. */
  lowAreas: AspectType[];
}): string {
  const { ready, mustFix, total, lowAreas } = input;
  const where = (() => {
    const byArea = new Map<AspectType, number>();
    for (const p of mustFix) byArea.set(p.aspect, (byArea.get(p.aspect) ?? 0) + 1);
    const top = [...byArea].sort((a, b) => b[1] - a[1]).slice(0, 2);
    if (top.length === 0) return '';
    if (byArea.size === 1) return `, all in ${AREA_WORDS[top[0][0]]}`;
    return `, mostly in ${top.map(([a]) => AREA_WORDS[a]).join(' and ')}`;
  })();
  if (ready) {
    if (total === 0) return 'No problems found.';
    if (mustFix.length > 0)
      return `Nothing blocks release, but ${count(mustFix.length, 'problem is', 'problems are')} worth fixing first${where}.`;
    return `Nothing blocks release. ${count(total, 'smaller problem is', 'smaller problems are')} worth fixing.`;
  }
  if (mustFix.length > 0) return `${count(mustFix.length, 'problem must', 'problems must')} be fixed first${where}.`;
  if (lowAreas.length > 0) {
    const names = lowAreas.map((a) => AREA_WORDS[a]);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return `Some areas scored too low to release: ${list}.`;
  }
  return 'Some areas scored too low to release.';
}

/** "14:05", or nothing for a time that can't be read. */
function timeOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** True while the browser prints: every problem body opens so the paper copy is whole. */
function usePrinting(): boolean {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    // flushSync: the browser lays out the page for printing right after beforeprint returns.
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
  return printing;
}

const VERDICT_TONE = {
  pass: { stub: 'bg-pass', words: 'text-pass' },
  fail: { stub: 'bg-fail', words: 'text-fail' },
} as const;

export function Report({
  report,
  actions,
  onReportChanged,
}: {
  report: ReleaseReport;
  actions: ReportActions;
  onReportChanged: (report: ReleaseReport) => void;
}) {
  const summary = useMemo(() => summarizeReport(report), [report]);
  const host = hostOf(report.targetUrl);
  const { pages, statuses } = useMemo(() => pageResults(report), [report]);
  const [pageFilter, setPageFilter] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(pages.length <= 6);
  const problemsRef = useRef<HTMLElement>(null);
  const coverage = report.coverage;
  const printing = usePrinting();
  const tokens = Object.entries(report.aiUsage || {});
  const evaluatedGate = useMemo(() => {
    const gate = getStoredReleaseGates();
    return releaseVerdict(report.findings || [], gate, report.grades, report.coverage);
  }, [report.findings, report.grades, report.coverage]);
  const standardVerdict = useMemo(
    () => releaseVerdict(report.findings || [], undefined, report.grades, report.coverage),
    [report.findings, report.grades, report.coverage]
  );
  const distinct = useMemo(() => {
    const groups = groupProblems(report.findings || []);
    return {
      mustFix: mergeSameProblem(groups['must-fix']),
      total:
        mergeSameProblem(groups['must-fix']).length +
        mergeSameProblem(groups['should-fix']).length +
        mergeSameProblem(groups.suggestion).length,
    };
  }, [report.findings]);
  const headline = reportHeadline({
    ready: summary.ready,
    mustFix: distinct.mustFix,
    total: distinct.total,
    lowAreas: ASPECTS.filter((a) => (standardVerdict.breaches ?? []).some((b) => b.startsWith(`${a} `))),
  });
  const tone = VERDICT_TONE[summary.ready ? 'pass' : 'fail'];
  const when = report.timestamp ?? '';
  const time = when ? timeOf(when) : '';

  useEffect(() => {
    const handleHash = () => {
      const raw = window.location.hash.slice(1);
      if (!raw) return;
      let decoded = raw;
      try {
        decoded = decodeURIComponent(raw);
      } catch {
        // keep the raw hash
      }
      const target =
        document.getElementById(decoded) ||
        [...document.querySelectorAll<HTMLElement>('[data-problem-key]')].find(
          (el) => el.dataset.problemKey === decoded || (el.dataset.problemKeys ?? '').split('\n').includes(decoded)
        ) ||
        null;
      if (target) {
        const button =
          target.querySelector<HTMLButtonElement>('button[aria-expanded]') ||
          (target instanceof HTMLButtonElement ? target : null);
        if (button && button.getAttribute('aria-expanded') === 'false') {
          button.click();
        }
        target.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
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
    <Page width="workspace">
      <div className="mb-6">
        <BackLink />
      </div>

      {/* The verdict tag: the one bold thing on the report. It lands once (.stamp). */}
      <header className="stamp flex overflow-hidden rounded-card border border-rule bg-surface">
        <div aria-hidden="true" className={`relative w-10 shrink-0 sm:w-16 ${tone.stub}`}>
          <span className="absolute left-1/2 top-5 h-4 w-4 -translate-x-1/2 rounded-full bg-paper" />
        </div>
        <div className="min-w-0 flex-1 border-l-2 border-dotted border-rule px-5 py-5 sm:px-8 sm:py-6">
          <p className="text-sm text-ink-soft">
            Check-up of <span className="break-all font-bold text-ink">{host}</span>
          </p>
          <FocusHeading className={`mt-1 font-stamp text-verdict font-bold ${tone.words}`}>{summary.stamp}</FocusHeading>
          <p className="mt-3 text-sm text-ink-soft">
            {when && `Checked ${formatDay(when)}${time ? ` at ${time}` : ''}.`}
            {coverage.totalTestPoints > 0 &&
              ` ${count(coverage.totalTestPoints, 'test', 'tests')} in ${formatDuration(report.durationMs)}.`}
          </p>
        </div>
      </header>

      <div className="mt-6 max-w-prose space-y-2">
        <p className="text-xl font-bold text-ink">{headline}</p>
        {summary.ready && distinct.mustFix.length > 0 && (
          <p className="text-sm text-ink-soft">
            Ready to release does not mean nothing needs fixing. The Standard rule does not block release on Majors
            alone, but they lower an area grade, and they stay listed under Must fix before release.
          </p>
        )}
        {summary.readOnly && (
          <p className="text-sm text-ink-soft">Only looked at: nothing was sent or changed, so forms weren’t tested.</p>
        )}
        {report.testedWithApprovedPlan && (
          <p className="text-sm text-ink-soft">
            Tested with the plan you approved on {formatDay(report.testedWithApprovedPlan)}.
          </p>
        )}
        {/* The person's own rule, kept in this browser: shown as information, never a second verdict. */}
        {evaluatedGate.gate && (
          <p className="text-sm text-ink-soft">
            {evaluatedGate.ready
              ? 'Your release rule: met.'
              : `Your release rule: not met. ${ruleBreachText(evaluatedGate)}`.trim()}
            {!evaluatedGate.ready && summary.ready && (
              <>
                {' '}
                Your rule is stricter than the Standard rule the verdict uses, so the verdict does not change.{' '}
                <Link to={PATHS.settings} className="btn-link print:hidden">
                  Change the rule
                </Link>
              </>
            )}
            {evaluatedGate.ready && !summary.ready && (
              <> The verdict uses the Standard rule and says {summary.stamp}. It does not change.</>
            )}
          </p>
        )}
      </div>

      {report.partial && (
        <div className="mt-6">
          <Notice tone="warn" title="A partial check-up">
            Testing was stopped after {report.partial.done} of {report.partial.planned} tests. What wasn’t tested isn’t
            in this report, so it can’t say the whole site is ready.
          </Notice>
        </div>
      )}

      <div className="mt-12 space-y-12">
        <AspectGrades report={report} />

        <VisualReview report={report} onReportChanged={onReportChanged} />

        <FixFirst report={report} />

        <ReportActionsBar report={report} actions={actions} />

        <Problems
          report={report}
          pageFilter={pageFilter}
          onPageFilter={setPageFilter}
          sectionRef={problemsRef}
          onReportChanged={onReportChanged}
          printing={printing}
        />

        {/* Only once there's an earlier check-up to compare with. */}
        {report.history?.previousTimestamp && <Changes report={report} />}

        {(report.slowerThanLastTime?.length ?? 0) > 0 && (
          <Section
            id="slower"
            title="Slower than last time"
            description="A note beside the problems. It does not change the grades or the verdict."
          >
            <ul className="max-w-prose list-disc space-y-1 pl-5 text-ink">
              {report.slowerThanLastTime!.map((item, i) => (
                <li key={`${item.urlPath}-${item.role}-${item.breakpoint}-${i}`}>{slowerNote(item)}</li>
              ))}
            </ul>
          </Section>
        )}

        <MarketingPanel report={report} />

        <section aria-labelledby="map-title">
          <h2 id="map-title" className="mb-2 text-xl font-bold">
            Map of results
          </h2>
          <details
            className="disclosure border-y border-rule print:hidden"
            open={mapOpen}
            onToggle={(e) => setMapOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary className="py-1">Every page that was tested, coloured by what was found on it</summary>
            {mapOpen && (
              <div className="pb-6 pt-2">
                <p className="mb-3 text-ink-soft">Choose a page to see its problems.</p>
                <div className="flex h-[30rem] overflow-hidden rounded-card border border-rule">
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

        <TestedDetails report={report} />

        {(report.notes?.length ?? 0) > 0 && (
          <Section id="notes" title="Good to know">
            <ul className="max-w-prose list-disc space-y-1 pl-5 text-ink">
              {report.notes!.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </Section>
        )}

        <Section id="further" title="Go further" className="print:hidden">
          <ul className="flex flex-wrap gap-x-8 gap-y-2">
            <li>
              <Link to={PATHS.visibility(report.runId)} className="btn-link">
                Search and AI visibility
              </Link>
            </li>
            <li>
              <Link to={`${PATHS.benchmark}?url=${encodeURIComponent(report.targetUrl)}`} className="btn-link">
                Compare with another site
              </Link>
            </li>
            <li>
              <Link to={PATHS.baselines} className="btn-link">
                Visual baselines
              </Link>
            </li>
          </ul>
        </Section>

        <Disclosure summary="Details for developers">
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-3">
              {(['report.md', 'findings.json', 'issues.md', 'issues.html'] as const).map((file) => (
                <button
                  key={file}
                  type="button"
                  className="btn-quiet btn-sm"
                  onClick={() => void downloadRunFile(report.runId, file)}
                >
                  Download {file}
                </button>
              ))}
            </div>
            <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[12rem_1fr]">
              <dt className="text-ink-soft">Verdict, in full</dt>
              <dd className="text-ink">{summary.reason}</dd>
              <dt className="text-ink-soft">Check-up</dt>
              <dd className="break-all font-mono text-ink">{report.runId}</dd>
              <dt className="text-ink-soft">Address</dt>
              <dd className="break-all font-mono text-ink">{report.targetUrl}</dd>
              <dt className="text-ink-soft">Tests</dt>
              <dd className="text-ink">
                {coverage.passed} passed · {coverage.failed} failed · {coverage.blocked} blocked · {coverage.skipped}{' '}
                skipped · {coverage.couldNotVerify} could not verify
              </dd>
              <dt className="text-ink-soft">Findings</dt>
              <dd className="text-ink">
                {summary.findings} behind the {count(summary.total, 'problem', 'problems')} the verdict counts (the
                same problem on several pages or sizes is one problem)
              </dd>
              {report.aiModels?.text && (
                <>
                  <dt className="text-ink-soft">AI models</dt>
                  <dd className="break-all font-mono text-ink">
                    {report.aiModels.text}
                    {report.aiModels.vision ? ` · ${report.aiModels.vision}` : ''}
                  </dd>
                </>
              )}
              {tokens.map(([stage, u]) => (
                <div key={stage} className="contents">
                  <dt className="text-ink-soft">AI tokens: {stage}</dt>
                  <dd className="text-ink">
                    {u!.requests} requests · {u!.promptTokens.toLocaleString()} sent ·{' '}
                    {u!.completionTokens.toLocaleString()} answered
                    {u!.reasoningTokens ? ` (${u!.reasoningTokens.toLocaleString()} thinking)` : ''}
                    {u!.truncated ? ` · ${u!.truncated} cut off` : ''}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </Disclosure>
      </div>
    </Page>
  );
}

const MESSAGE_TONE = { pass: 'text-pass', fail: 'text-fail', warn: 'text-warn' } as const;

/** How far the AI's look over the screens got, and a way to finish it when requests are available again. */
function VisualReview({
  report,
  onReportChanged,
}: {
  report: ReleaseReport;
  onReportChanged: (report: ReleaseReport) => void;
}) {
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
          className="btn-quiet btn-sm print:hidden"
          disabled={working}
          onClick={async () => {
            setWorking(true);
            setMessage(null);
            try {
              const result = await finishAiReview();
              onReportChanged(await getRun(report.runId));
              setMessage(
                result.remainingCount > 0
                  ? {
                      tone: 'warn',
                      text: `${result.reviewedCount} more looked over; ${result.remainingCount} left for another time.`,
                    }
                  : { tone: 'pass', text: 'All the screens are looked over now.' }
              );
            } catch (err) {
              setMessage({
                tone: 'fail',
                text: err instanceof RunnerError ? err.message : 'That couldn’t be finished. Try again later.',
              });
            } finally {
              setWorking(false);
            }
          }}
        >
          {working ? (
            <Spinner label="Looking over the screens…" announce={false} />
          ) : (
            `Look over the other ${count(review.remaining, 'screen', 'screens')}`
          )}
        </button>
      }
    >
      Today’s AI requests ran out first, so “Looks and reads well” only covers what was looked at.
      {message && <span className={`mt-1 block font-bold ${MESSAGE_TONE[message.tone]}`}>{message.text}</span>}
    </Notice>
  );
}

/** After "Fix these first": the next step. One primary (a new check-up), a quiet download, and going deeper. */
function ReportActionsBar({ report, actions }: { report: ReleaseReport; actions: ReportActions }) {
  const [deeper, setDeeper] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  return (
    <div className="print:hidden">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          // While the sign-in form is open, its Start is the screen's one primary.
          className={deeper ? 'btn-quiet' : 'btn-primary'}
          disabled={actions.starting}
          onClick={() => actions.onTestAgain(report)}
        >
          {actions.starting ? <Spinner label="Starting…" announce={false} /> : 'New check-up of this site'}
        </button>
        <button
          type="button"
          className="btn-quiet"
          disabled={downloading}
          onClick={async () => {
            setDownloading(true);
            setDownloadError(null);
            setDownloaded(false);
            try {
              await downloadRunFile(report.runId, 'report.html');
              setDownloaded(true);
            } catch (err) {
              setDownloadError(err instanceof Error ? err.message : 'The report couldn’t be downloaded. Try again.');
            } finally {
              setDownloading(false);
            }
          }}
        >
          {downloading ? <Spinner label="Downloading…" announce={false} /> : 'Download the report'}
        </button>
        <button type="button" className="btn-link" onClick={() => window.print()}>
          Print
        </button>
        <button type="button" className="btn-link" aria-expanded={deeper} onClick={() => setDeeper((d) => !d)}>
          Go deeper: test signed-in pages
        </button>
      </div>
      <p role="status" className="mt-2 text-sm text-pass">
        {downloaded ? 'Report downloaded.' : ''}
      </p>
      {downloadError && <ErrorMessage>{downloadError}</ErrorMessage>}
      {actions.actionError && <ErrorMessage>{actions.actionError}</ErrorMessage>}

      {deeper && (
        <form
          className="mt-4 max-w-form space-y-4 rounded-card border border-rule bg-surface p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (username.trim() && password) actions.onGoDeeper(report, { username: username.trim(), password });
          }}
        >
          <div>
            <h2 className="text-xl font-bold">Test the pages behind a sign-in</h2>
            <p className="mt-1 text-sm text-ink-soft">
              A new check-up signs in with these details, then scans and plans the pages it can reach. Use a test
              sign-in, not a real person’s. Next time you can add a sign-in when you start the check-up, or from the
              plan.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="deeper-username" className="label">
                Email or username
              </label>
              <input
                id="deeper-username"
                className="field"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="deeper-password" className="label">
                Password
              </label>
              <input
                id="deeper-password"
                type="password"
                className="field"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" className="btn-primary" disabled={actions.starting || !username.trim() || !password}>
            {actions.starting ? <Spinner label="Starting…" announce={false} /> : 'Start with these sign-in details'}
          </button>
        </form>
      )}
    </div>
  );
}

const MARK_TONE = { pass: 'text-pass', warn: 'text-warn', fail: 'text-fail', soft: 'text-ink-soft' } as const;

/** The marketing basics one by one, so the Marketing score is never all there is to read. */
function MarketingPanel({ report }: { report: ReleaseReport }) {
  const marketing = report.marketing;
  if (!marketing) return null;
  const mark = (c: NonNullable<ReleaseReport['marketing']>['checks'][number]) =>
    c.status === 'ok'
      ? { icon: '✓', label: 'OK', tone: MARK_TONE.pass }
      : c.status === 'gap'
        ? c.kind === 'opinion'
          ? { icon: '+', label: 'Worth adding', tone: MARK_TONE.warn }
          : { icon: '✗', label: 'Missing', tone: MARK_TONE.fail }
        : { icon: '–', label: 'Not checked', tone: MARK_TONE.soft };
  return (
    <Section
      id="marketing"
      title="Marketing basics"
      description={
        <>
          What a visitor or a marketer looks for, read from{' '}
          {marketing.readPages.length === 1 ? 'one page' : `${marketing.readPages.length} pages`} (
          {marketing.readPages.slice(0, 3).join(', ')}
          {marketing.readPages.length > 3 ? ', …' : ''}). Items marked as suggestions depend on what the site is for,
          so they never count as faults.
        </>
      }
    >
      <ul className="divide-y divide-rule rounded-card border border-rule bg-surface">
        {marketing.checks.map((c) => {
          const m = mark(c);
          return (
            <li key={c.key} className="flex items-start gap-3 px-4 py-3">
              <span aria-hidden="true" className={`mt-0.5 w-5 shrink-0 text-center font-bold ${m.tone}`}>
                {m.icon}
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 font-bold text-ink">
                  {c.label}
                  {c.kind === 'opinion' && <Badge>Suggestion</Badge>}
                </span>
                <span className="block text-sm text-ink-soft">
                  <span className={`font-bold ${m.tone}`}>{m.label}.</span> {c.detail}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function AspectGrades({ report }: { report: ReleaseReport }) {
  if (!report.grades) return null;
  return (
    <Section id="aspects" title="How each area did">
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {ASPECTS.map((aspect) => {
          const data = report.grades!.aspects[aspect];
          const checked = !!data && data.checked !== false && data.grade !== null;
          const sub = aspect === 'Findable' ? data?.subBreakdown : undefined;
          const problems = checked ? groupProblems(report.findings.filter((f) => data.findings.includes(f.id))) : null;
          const problemCount = problems
            ? mergeSameProblem(problems['must-fix']).length +
              mergeSameProblem(problems['should-fix']).length +
              mergeSameProblem(problems.suggestion).length
            : 0;
          return (
            <li
              key={aspect}
              className={`flex flex-col gap-3 rounded-card border border-rule bg-surface p-4 ${
                checked && sub ? 'col-span-2 lg:col-span-1' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-bold text-ink">{aspect}</span>
                  <span className="block text-sm text-ink-soft">
                    {checked ? count(problemCount, 'problem', 'problems') : 'Not checked this time'}
                  </span>
                </span>
                {checked ? (
                  <span
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-control border font-stamp text-2xl font-bold ${gradeClasses(data.grade ?? 'F')}`}
                  >
                    <span className="sr-only">Grade </span>
                    {data.grade}
                  </span>
                ) : (
                  <span className="shrink-0 text-sm font-bold text-ink-soft">Not checked</span>
                )}
              </div>
              {checked && sub && (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-rule pt-2 text-sm">
                  {(
                    [
                      ['Search', sub.seo, 'How search engines, such as Google, find and list the site (SEO).'],
                      ['AI answers', sub.aeo, 'How answer engines and AI assistants pick answers from the site (AEO).'],
                      ['AI search', sub.geo, 'How AI search tools read and quote the site (GEO).'],
                      [
                        'Marketing',
                        sub.marketing,
                        'Share previews, a clear call to action, contact details, analytics and social links.',
                      ],
                    ] as const
                  ).map(([label, part, hint]) => (
                    <div key={label}>
                      <dt className="text-ink-soft">{label}</dt>
                      <dd className="font-bold text-ink">
                        {part?.checked === false ? (
                          <span className="font-normal text-ink-soft">Not checked</span>
                        ) : (
                          `${part?.score ?? 100}%`
                        )}
                      </dd>
                      <dd className="text-xs text-ink-soft">{hint}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

const EFFORT_WORDS: Record<string, string> = { Low: 'Little effort', Medium: 'Some effort', High: 'Big effort' };

/** "Fix these first": the recommendations in priority order, three until "Show all". */
function FixFirst({ report }: { report: ReleaseReport }) {
  const [all, setAll] = useState(false);
  const recommendations = report.recommendations || [];
  if (recommendations.length === 0) return null;
  const more = recommendations.length - FIX_FIRST_SHOWN;
  return (
    <Section id="improve" title="Fix these first" description="In this order: the most good for the least work first.">
      <ol className="divide-y divide-rule border-y border-rule">
        {recommendations.map((rec, i) => {
          const plainSummary = rec.summary && !looksTechnical(rec.summary) ? rec.summary : null;
          const plainFix = rec.suggestedFix && !looksTechnical(rec.suggestedFix) ? rec.suggestedFix : null;
          const hidden = !all && i >= FIX_FIRST_SHOWN;
          return (
            <li key={rec.id} className={`gap-4 py-4 ${hidden ? 'hidden print:flex' : 'flex'}`}>
              <span aria-hidden="true" className="w-8 shrink-0 font-stamp text-2xl font-bold leading-none text-stamp">
                {i + 1}
              </span>
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-ink">{plainTitleText(rec.title)}</h3>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                  <Badge tone={rec.category === 'quick-win' ? 'pass' : 'stamp'}>
                    {rec.category === 'quick-win' ? 'Quick win' : 'Bigger change'}
                  </Badge>
                  <Badge>{EFFORT_WORDS[rec.effort] ?? `${rec.effort} effort`}</Badge>
                  <span>
                    {rec.severity === 'Blocker'
                      ? 'Blocks release · '
                      : rec.severity === 'Major'
                        ? 'Must fix before release · '
                        : ''}
                    {rec.aspect} · {rec.impact} impact
                    {rec.affectedPages.length > 0 && ` · ${count(rec.affectedPages.length, 'page', 'pages')}`}
                  </span>
                </p>
                {/* Technical wording stays in the developer details; a plain line takes its place here. */}
                <p className="mt-2 text-ink-soft">
                  {plainSummary ?? whyItMatters({ title: plainTitleText(rec.title), aspect: rec.aspect })}
                </p>
                <p className="mt-1 text-ink">
                  <strong>How to fix: </strong>
                  {plainFix ?? 'A developer can see exactly what to change under the problem’s “Details for developers”.'}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {more > 0 && (
        <button
          type="button"
          className="btn-link mt-2 print:hidden"
          aria-expanded={all}
          onClick={() => setAll((a) => !a)}
        >
          {all ? 'Show the first three' : `Show all ${recommendations.length}`}
        </button>
      )}
    </Section>
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
    <Section
      id="changes"
      title="Since the last check-up"
      description={
        history.previousTimestamp ? `Compared with the check-up on ${formatDay(history.previousTimestamp)}.` : undefined
      }
    >
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex flex-col-reverse rounded-card border border-rule bg-surface p-4 text-center"
          >
            <dt className="text-sm text-ink-soft">{item.label}</dt>
            <dd className={`font-stamp text-3xl font-bold ${item.tone}`}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </Section>
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
  printing,
}: {
  report: ReleaseReport;
  pageFilter: string | null;
  onPageFilter: (page: string | null) => void;
  sectionRef: RefObject<HTMLElement>;
  onReportChanged: (report: ReleaseReport) => void;
  printing: boolean;
}) {
  const [filters, setFilters] = useState<Filters>({ search: '', bucket: 'all', aspect: 'all' });
  const [showHidden, setShowHidden] = useState(false);
  const withFilters = report.findings.length > FILTER_ABOVE;
  const problemPages = useMemo(
    () => [...new Set(report.findings.map((f) => f.where.urlPath))].sort(),
    [report.findings]
  );
  const dismissed = useMemo(
    () => report.findings.filter((f) => f.triageStatus === 'Intended' || f.triageStatus === 'False Positive'),
    [report.findings]
  );
  const dismissedTitles = useMemo(() => [...new Set(dismissed.map((f) => f.title))], [dismissed]);

  const shown = useMemo(() => {
    const words = filters.search.trim().toLowerCase();
    const matches = (f: Finding) =>
      (!pageFilter || f.where.urlPath === pageFilter || !!f.seenAt?.pages.includes(pageFilter)) &&
      (filters.aspect === 'all' || (f.aspect ?? aspectOf(f.checker)) === filters.aspect) &&
      (!words || [plainTitle(f), category(f), f.where.urlPath].join(' ').toLowerCase().includes(words));
    const groups = groupProblems(report.findings.filter(matches));
    const rows = {} as Record<Bucket, ProblemRow[]>;
    for (const b of BUCKETS) rows[b.id] = b.id === 'judgement' ? groups[b.id].map((g) => ({ ...g, keys: [g.key] })) : mergeSameProblem(groups[b.id]);
    return rows;
  }, [report.findings, pageFilter, filters]);

  const buckets = BUCKETS.filter(
    (b) => (filters.bucket === 'all' || filters.bucket === b.id) && shown[b.id].length > 0
  );
  const filtered = !!pageFilter || filters.search.trim() !== '' || filters.bucket !== 'all' || filters.aspect !== 'all';

  const triage = async (titles: string[], status: 'Intended' | 'False Positive' | null, reason?: string) => {
    onReportChanged(await triageProblem(report.runId, titles, status, reason));
  };
  const accept = async (titles: string[]) => {
    onReportChanged(await acceptJudgement(report.runId, titles, true));
  };

  return (
    <section ref={sectionRef} aria-labelledby="problems-title" className="scroll-mt-20">
      <h2 id="problems-title" className="mb-4 text-xl font-bold">
        Problems found
      </h2>

      {withFilters && (
        <div
          role="search"
          aria-label="Filter the problems"
          className="mb-6 grid gap-4 border-y border-rule py-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden"
        >
          <div>
            <label htmlFor="problem-search" className="label">
              Search
            </label>
            <input
              id="problem-search"
              type="search"
              className="field"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="problem-bucket" className="label">
              How serious
            </label>
            <select
              id="problem-bucket"
              className="field"
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
            <label htmlFor="problem-page" className="label">
              Page
            </label>
            <select
              id="problem-page"
              className="field"
              value={pageFilter ?? ''}
              onChange={(e) => onPageFilter(e.target.value || null)}
            >
              <option value="">All pages</option>
              {problemPages.map((page) => (
                <option key={page} value={page}>
                  {page}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="problem-aspect" className="label">
              Area
            </label>
            <select
              id="problem-aspect"
              className="field"
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
          <button type="button" className="btn-link" onClick={() => onPageFilter(null)}>
            Show every page
          </button>
        </p>
      )}

      {report.findings.length === 0 ? (
        <p className="rounded-card border border-pass bg-pass-tint p-6 text-center font-bold text-pass">
          No problems found.
        </p>
      ) : buckets.length === 0 ? (
        <p className="text-ink-soft">
          {filtered ? 'No problems match these filters.' : 'No problems count against this check-up.'}
        </p>
      ) : (
        <div className="space-y-8">
          {buckets.map((bucket) => (
            <section key={bucket.id} aria-labelledby={`bucket-${bucket.id}`}>
              <h3 id={`bucket-${bucket.id}`} className="text-lg font-bold">
                {bucket.title} <span className="font-normal text-ink-soft">({shown[bucket.id].length})</span>
              </h3>
              <p className="mb-3 text-sm text-ink-soft">{bucket.intro}</p>
              {bucket.id === 'judgement' ? (
                judgementByRole(shown.judgement).map((byRole) => (
                  <div key={byRole.role} className="mb-3">
                    <h4 className="mb-1 font-bold text-ink">As {byRole.role}</h4>
                    <ul className="divide-y divide-rule rounded-card border border-rule bg-surface">
                      {byRole.groups.map((group) => (
                        <ProblemItem
                          key={group.key}
                          group={group as ProblemRow}
                          report={report}
                          onTriage={triage}
                          onAccept={accept}
                          printing={printing}
                        />
                      ))}
                    </ul>
                  </div>
                ))
              ) : (
                <ul className="divide-y divide-rule rounded-card border border-rule bg-surface">
                  {shown[bucket.id].map((group) => (
                    <ProblemItem key={group.key} group={group} report={report} onTriage={triage} printing={printing} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {dismissedTitles.length > 0 && (
        <div className="mt-6 text-sm text-ink-soft">
          <p>
            {count(dismissedTitles.length, 'problem is', 'problems are')} hidden because you marked{' '}
            {dismissedTitles.length === 1 ? 'it' : 'them'} as intended or not a problem.{' '}
            <button
              type="button"
              className="btn-link text-sm"
              aria-expanded={showHidden}
              onClick={() => setShowHidden((s) => !s)}
            >
              Show them
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
  judgement: 'border-l-edge',
};

/**
 * What was and wasn't tested: pages reached, roles not tested and documents, under one line that
 * always shows the gaps (ADR 0018: what was not checked is never hidden).
 */
function TestedDetails({ report }: { report: ReleaseReport }) {
  const pages = report.pageCoverage;
  const roles = report.rolesNotTested ?? [];
  const documents = !!documentedLine(report.documentedItems) || (report.documentedItems?.notFound ?? []).length > 0;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const hidden = !pages && roles.length === 0 && !documents;

  // A closed <details> prints without its content: open it (and the lists inside) for printing, then restore.
  useEffect(() => {
    if (hidden) return;
    let reopened: HTMLDetailsElement[] = [];
    const beforePrint = () => {
      const root = detailsRef.current;
      if (!root) return;
      reopened = [root, ...root.querySelectorAll<HTMLDetailsElement>('details')].filter((d) => !d.open);
      reopened.forEach((d) => (d.open = true));
    };
    const afterPrint = () => {
      reopened.forEach((d) => (d.open = false));
      reopened = [];
    };
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    return () => {
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', afterPrint);
    };
  }, [hidden]);

  if (hidden) return null;

  const gaps = [
    pages && `${pages.reached} of ${count(pages.found, 'page', 'pages')} reached`,
    roles.length > 0 && `${count(roles.length, 'role', 'roles')} not tested`,
  ].filter(Boolean);
  return (
    <section aria-labelledby="tested-title">
      <h2 id="tested-title" className="mb-2 text-xl font-bold">
        What was and wasn’t tested
      </h2>
      <details ref={detailsRef} className="disclosure border-y border-rule">
        <summary className="py-1">
          {gaps.length > 0 ? gaps.join(', ') : 'Pages, roles and documents'}
        </summary>
        <div className="space-y-8 pb-6 pt-2">
          <PageCoverageSection report={report} />
          <RolesNotTestedSection report={report} />
          <SourcesSummary report={report} />
        </div>
      </details>
    </section>
  );
}

function PageCoverageSection({ report }: { report: ReleaseReport }) {
  const coverage = report.pageCoverage;
  if (!coverage) return null;

  const skipped = coverage.skipped ?? [];
  return (
    <section aria-labelledby="coverage-title" className="space-y-3">
      <h3 id="coverage-title" className="text-lg font-bold">
        Pages checked
      </h3>
      <p className="text-ink-soft">
        Pages reached {coverage.reached} of {coverage.found}
      </p>
      {skipped.length > 0 && (
        <details className="disclosure border-y border-rule">
          <summary className="py-1">Skipped pages ({skipped.length})</summary>
          <div className="overflow-x-auto pb-4">
            <ul className="divide-y divide-rule text-sm">
              {skipped.map((item, idx) => (
                <li key={idx} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="break-all font-mono text-ink">{item.urlPath}</span>
                  <span className="text-ink-soft">
                    {skipReasonText(item.why)}
                    {item.status ? ` (the site answered ${item.status})` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </section>
  );
}

/** Roles that were not tested and why, under their own heading. */
function RolesNotTestedSection({ report }: { report: ReleaseReport }) {
  const roles = report.rolesNotTested ?? [];
  if (roles.length === 0) return null;

  return (
    <section aria-labelledby="roles-not-tested-title" className="space-y-3">
      <h3 id="roles-not-tested-title" className="text-lg font-bold">
        Roles not tested, and why
        <span className="sr-only">Roles not tested and why</span>
      </h3>
      <ul className="list-disc space-y-1 pl-5 text-ink">
        {roles.map((r) => (
          <li key={r.role}>
            <strong>{r.role}:</strong> <span className="text-ink-soft">{r.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type OverrideStatus = 'updated' | 'retired' | 'postponed';

/**
 * What the documents added to this report: how many documented items the scan reached
 * (the rest are listed as not found in the app).
 */
function SourcesSummary({ report }: { report: ReleaseReport }) {
  const line = documentedLine(report.documentedItems);
  const notFound = report.documentedItems?.notFound ?? [];
  const [activeOverride, setActiveOverride] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideStatus, setOverrideStatus] = useState<OverrideStatus>('updated');
  const [overrideSelector, setOverrideSelector] = useState('');
  const [overrideUrlPath, setOverrideUrlPath] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);
  const [overrideSuccess, setOverrideSuccess] = useState<Record<string, boolean>>({});
  const [overrideError, setOverrideError] = useState<string | null>(null);

  if (!line && notFound.length === 0) return null;

  const handleSaveOverride = async (reqId: string) => {
    setSavingOverride(true);
    setOverrideError(null);
    try {
      await recordSpecOverride({
        runId: report.runId,
        requirementId: reqId,
        reason: overrideReason,
        status: overrideStatus,
        newSelector: overrideSelector || undefined,
        newUrlPath: overrideUrlPath || undefined,
      });
      setOverrideSuccess((prev) => ({ ...prev, [reqId]: true }));
      setActiveOverride(null);
      setOverrideReason('');
      setOverrideSelector('');
      setOverrideUrlPath('');
    } catch (err: unknown) {
      setOverrideError(err instanceof Error ? err.message : 'The override couldn’t be saved. Try again.');
    } finally {
      setSavingOverride(false);
    }
  };

  return (
    <section aria-labelledby="sources-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="sources-title" className="text-lg font-bold">
          How the site matches its requirements
        </h3>
        {line && <Badge tone="stamp">{line}</Badge>}
      </div>

      {notFound.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-bold text-ink">Documented requirements not reached ({notFound.length})</h4>
          <ul className="divide-y divide-rule rounded-card border border-rule bg-surface">
            {notFound.map((item, i) => {
              const reqId = item.docSource.requirementId || item.docSource.section || item.docSource.document;
              const isOverridden = overrideSuccess[reqId] || item.override;
              const isEditing = activeOverride === reqId;

              return (
                <li key={i} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <strong className="font-bold text-ink">{item.docSource.section ?? item.docSource.document}</strong>
                        <span className="text-sm text-ink-soft">in {item.docSource.document}</span>
                        {isOverridden && <Badge tone="pass">Override recorded</Badge>}
                      </p>
                      <p className="mt-1 text-ink-soft">{item.reason}</p>
                      {item.code && (
                        <details className="disclosure mt-1 text-sm">
                          <summary className="py-1 text-ink-soft">Details for developers</summary>
                          <code className="break-all font-mono text-ink">{item.code}</code>
                        </details>
                      )}
                    </div>

                    {!isOverridden && !isEditing && (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveOverride(reqId);
                          setOverrideError(null);
                        }}
                        className="btn-quiet btn-sm"
                      >
                        Record a requirement override
                      </button>
                    )}
                  </div>
                  {!isOverridden && !isEditing && (
                    <p className="mt-1 text-sm text-ink-soft">Did this feature change or move? Record it here.</p>
                  )}

                  {isEditing && (
                    <form
                      className="mt-4 space-y-4 border-t border-rule pt-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleSaveOverride(reqId);
                      }}
                    >
                      <p className="font-bold text-ink">Record a requirement override</p>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label htmlFor="override-status" className="label">
                            What happened to it
                          </label>
                          <select
                            id="override-status"
                            value={overrideStatus}
                            onChange={(e) => setOverrideStatus(e.target.value as OverrideStatus)}
                            className="field"
                          >
                            <option value="updated">It changed or moved</option>
                            <option value="retired">It was removed</option>
                            <option value="postponed">It comes later</option>
                          </select>
                        </div>
                        <div>
                          <label htmlFor="override-url" className="label">
                            Its new address (optional)
                          </label>
                          <input
                            id="override-url"
                            type="text"
                            placeholder="/new-path"
                            value={overrideUrlPath}
                            onChange={(e) => setOverrideUrlPath(e.target.value)}
                            className="field font-mono"
                          />
                        </div>
                      </div>
                      <div>
                        <label htmlFor="override-reason" className="label">
                          Why (optional)
                        </label>
                        <input
                          id="override-reason"
                          type="text"
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                          className="field"
                        />
                        <p className="hint mt-1 text-sm">For whoever reads this later.</p>
                      </div>
                      <details className="disclosure text-sm">
                        <summary className="py-1">Details for developers</summary>
                        <label htmlFor="override-selector" className="label">
                          New CSS selector (optional)
                        </label>
                        <input
                          id="override-selector"
                          type="text"
                          placeholder="button[data-testid='save']"
                          value={overrideSelector}
                          onChange={(e) => setOverrideSelector(e.target.value)}
                          className="field font-mono"
                        />
                      </details>
                      {overrideError && (
                        <p role="alert" className="text-sm text-fail">
                          {overrideError}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-3">
                        {/* Quiet: the screen's one primary is "New check-up of this site". */}
                        <button type="submit" disabled={savingOverride} className="btn-quiet btn-sm">
                          {savingOverride ? <Spinner label="Saving…" announce={false} /> : 'Save the override'}
                        </button>
                        <button type="button" onClick={() => setActiveOverride(null)} className="btn-link text-sm">
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * One problem: why it matters and how to fix it, every page it was found on, the details for
 * developers, and a way to say it's intended or not a problem.
 */
function ProblemItem({
  group,
  report,
  onTriage,
  onAccept,
  printing,
}: {
  group: ProblemRow;
  report: ReleaseReport;
  onTriage: (titles: string[], status: 'Intended' | 'False Positive' | null, reason?: string) => Promise<void>;
  /** Only on "Needs your judgement": counts the item as a problem. */
  onAccept?: (titles: string[]) => Promise<void>;
  printing: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState<'Intended' | 'False Positive' | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = group.findings[0];
  const id = `problem-${group.key.replace(/[^A-Za-z0-9_-]+/g, '_')}`;
  const kinds = [
    ...new Map(
      group.findings
        .map((f) => searchKind(f))
        .filter((k): k is NonNullable<typeof k> => !!k)
        .map((k) => [k.label, k])
    ).values(),
  ];
  const titles = [...new Set(group.findings.map((f) => f.title))];
  const shownOpen = open || printing;

  const markdown = () =>
    [
      `### ${group.title}`,
      `**Area**: ${group.category}`,
      `**Pages**: ${group.pages.join(', ')}`,
      '',
      `**Why it matters**: ${whyItMatters(group)}`,
      `**How to fix**: ${howToFix(group, looksTechnical)}`,
      '',
      `*Reported in run: \`${report.runId}\` for ${report.targetUrl}*`,
    ].join('\n');

  return (
    <li
      id={id}
      data-problem-key={group.key}
      data-problem-keys={group.keys.length > 1 ? group.keys.join('\n') : undefined}
      className={`border-l-4 transition-all duration-base first:rounded-t-card last:rounded-b-card ${BUCKET_BORDER[group.bucket]}`}
    >
      <button
        type="button"
        aria-expanded={shownOpen}
        aria-controls={shownOpen ? `${id}-details` : undefined}
        onClick={() => setOpen((o) => !o)}
        className="interactive flex min-h-[44px] w-full items-start justify-between gap-3 p-4 text-left print:hidden"
      >
        <ProblemHeading group={group} kinds={kinds} />
        <span aria-hidden="true" className="mt-1 shrink-0 text-ink-soft">
          {shownOpen ? '▲' : '▼'}
        </span>
      </button>
      {/* On paper the toggle is hidden: the same heading, as text. */}
      <div className="hidden p-4 print:block">
        <ProblemHeading group={group} kinds={kinds} />
      </div>
      {shownOpen && (
        <div id={`${id}-details`} className="space-y-3 border-t border-rule px-4 pb-4 pt-3">
          <p className="text-ink">
            <strong>Why it matters: </strong>
            {whyItMatters(group)}
          </p>
          <p className="text-ink">
            <strong>How to fix: </strong>
            {howToFix(group, looksTechnical)}
          </p>
          {group.aspects.length > 1 && (
            <p className="text-sm text-ink-soft">It counts toward {group.aspects.join(' and ')}.</p>
          )}
          <div>
            <p className="text-sm text-ink-soft">
              Found on {group.pages.length === 1 ? 'this page' : count(group.pages.length, 'page', 'pages')}:
            </p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {group.pages.map((page) => (
                <li
                  key={page}
                  className="break-all rounded-control border border-rule bg-canvas px-2 py-0.5 font-mono text-sm text-ink"
                >
                  {page}
                </li>
              ))}
            </ul>
          </div>

          <div className="print:hidden">
            {marking ? (
              <form
                className="space-y-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSaving(true);
                  setError(null);
                  try {
                    await onTriage(titles, marking, reason);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'That couldn’t be saved. Try again.');
                    setSaving(false);
                  }
                }}
              >
                <label className="label text-sm" htmlFor={`${id}-reason`}>
                  Why (optional)
                </label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    id={`${id}-reason`}
                    className="field flex-1"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    autoFocus
                  />
                  {/* Quiet: the screen's one primary is "New check-up of this site". */}
                  <button type="submit" className="btn-quiet btn-sm" disabled={saving}>
                    {saving ? (
                      <Spinner label="Saving…" announce={false} />
                    ) : marking === 'Intended' ? (
                      'Mark as intended'
                    ) : (
                      'Mark as not a problem'
                    )}
                  </button>
                  <button type="button" className="btn-link text-sm" onClick={() => setMarking(null)}>
                    Cancel
                  </button>
                </div>
                <p className="text-sm text-ink-soft">For whoever reads this later.</p>
              </form>
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="flex flex-wrap gap-x-4 text-sm">
                  <button type="button" className="btn-link text-sm" onClick={() => setMarking('False Positive')}>
                    Not a problem
                  </button>
                  <button type="button" className="btn-link text-sm" onClick={() => setMarking('Intended')}>
                    It’s intended
                  </button>
                  {onAccept && (
                    <button
                      type="button"
                      className="btn-link text-sm font-bold"
                      disabled={saving}
                      onClick={async () => {
                        setSaving(true);
                        setError(null);
                        try {
                          await onAccept(titles);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'That couldn’t be saved. Try again.');
                          setSaving(false);
                        }
                      }}
                    >
                      Accept as a problem
                    </button>
                  )}
                </p>
                <CopyButton label="Copy as Markdown" getText={async () => markdown()} />
              </div>
            )}
            {marking && (
              <p className="mt-1 text-sm text-ink-soft">
                It’s hidden from this report and not raised again for this site. You can undo it.
              </p>
            )}
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

function ProblemHeading({ group, kinds }: { group: ProblemRow; kinds: Array<{ label: string; hint: string }> }) {
  return (
    <span className="min-w-0">
      <span className="flex flex-wrap items-center gap-2 font-bold text-ink">
        {kinds.map((k) => (
          <Badge key={k.label} tone="stamp" title={k.hint}>
            {k.label}
          </Badge>
        ))}
        <span>{group.title}</span>
      </span>
      <span className="mt-0.5 block text-sm text-ink-soft">
        {/* The badge already names a search kind; the line says the rest. */}
        {group.category
          .split(' · ')
          .filter((c) => !kinds.some((k) => k.label === c))
          .map((c) => `${c} · `)
          .join('')}
        {group.pages.length === 1 ? (
          <span className="break-all font-mono">{group.pages[0]}</span>
        ) : (
          `on ${count(group.pages.length, 'page', 'pages')}`
        )}
      </span>
    </span>
  );
}
