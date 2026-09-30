import { useEffect, useMemo, useRef, useState } from 'react';
import type { AspectGrade, AspectType, Finding, ReleaseReport, RoleCredential } from '@qa/types';
import { downloadRunFile, getRun, RunnerError } from '../api';
import { SiteMap, type MapJourney, type MapPage, type PageStatus } from '../components/SiteMap';
import { DeveloperDetails } from '../components/DeveloperDetails';
import { ErrorMessage, FocusHeading, Notice, Spinner } from '../components/text';
import { Link, PATHS, useTitle } from '../lib/router';
import { ASPECTS, aspectOf, BUCKETS, bucketOf, groupProblems, plainTitle, plainTitleText, summarizeReport, type Bucket, type ProblemGroup } from '../lib/summary';
import { hostOf } from '../lib/url';
import { formatWhen } from './NewCheckupScreen';

/** More problems than this, and the list gets filters and a search box. */
const FILTER_ABOVE = 10;
/** Places listed with their own developer details under one problem; the rest are counted. */
const DETAILS_SHOWN = 5;

const SERIOUS = new Set(['Blocker', 'Major']);

/** Grades use the palette's status tokens only, so the contrast test covers them. */
export function gradeTone(grade: AspectGrade): 'pass' | 'warn' | 'fail' {
  return grade === 'A' || grade === 'B' ? 'pass' : grade === 'C' || grade === 'D' ? 'warn' : 'fail';
}
const TONE_TEXT = { pass: 'text-pass', warn: 'text-warn', fail: 'text-fail' } as const;
const TONE_BORDER = { pass: 'border-pass', warn: 'border-warn', fail: 'border-fail' } as const;
const TONE_TINT = { pass: 'bg-pass-tint', warn: 'bg-warn-tint', fail: 'bg-fail-tint' } as const;

function counts(finding: Finding): boolean {
  return finding.triageStatus !== 'Intended' && finding.triageStatus !== 'False Positive';
}

function pathOf(address: string | undefined): string | undefined {
  if (!address) return undefined;
  try {
    return new URL(address, 'http://placeholder').pathname;
  } catch {
    return undefined;
  }
}

/** Every page the run tested, coloured by the worst problem found on it. */
function pageResults(report: ReleaseReport): Record<string, PageStatus> {
  const result: Record<string, PageStatus> = {};
  for (const r of report.results) {
    for (const step of r.stepEvidence || []) {
      for (const page of [pathOf(step.urlBefore), pathOf(step.urlAfter)]) if (page && !result[page]) result[page] = { status: 'pass', issuesCount: 0 };
    }
  }
  for (const f of report.findings.filter(counts)) {
    if (f.needsConfirmation) continue;
    for (const page of new Set([f.where.urlPath, ...(f.seenAt?.pages || [])])) {
      const before = result[page] ?? { status: 'pass', issuesCount: 0 };
      result[page] = {
        status: SERIOUS.has(f.severity) || before.status === 'fail' ? 'fail' : 'warn',
        issuesCount: (before.issuesCount ?? 0) + 1,
      };
    }
  }
  return result;
}

type Filters = { bucket: Bucket | 'all'; page: string | 'all'; aspect: AspectType | 'all'; search: string };
const NO_FILTERS: Filters = { bucket: 'all', page: 'all', aspect: 'all', search: '' };

function matches(f: Finding, filters: Filters): boolean {
  if (filters.bucket !== 'all' && bucketOf(f) !== filters.bucket) return false;
  if (filters.page !== 'all' && f.where.urlPath !== filters.page && !f.seenAt?.pages.includes(filters.page)) return false;
  if (filters.aspect !== 'all' && aspectOf(f.checker) !== filters.aspect) return false;
  const q = filters.search.trim().toLowerCase();
  if (q && !`${plainTitle(f)} ${f.where.urlPath} ${f.title}`.toLowerCase().includes(q)) return false;
  return true;
}

/**
 * /reports/<runId>: one check-up's report, at an address that never changes. The stamp is the
 * verdict; the six areas, what to fix first, the map and every problem sit under it. Technical
 * detail waits under "Details for developers".
 */
export function ReportScreen({
  runId,
  typedUrl,
  busy,
  onTestAgain,
  onGoDeeper,
}: {
  runId: string;
  /** The site as it was typed, when Past check-ups knows it (the report has the address it connected to). */
  typedUrl?: string;
  /** A check-up is in progress, so another can't start. */
  busy: boolean;
  onTestAgain: (report: ReleaseReport, url: string) => Promise<string | null>;
  onGoDeeper: (report: ReleaseReport, url: string, role: RoleCredential) => Promise<string | null>;
}) {
  const [report, setReport] = useState<ReleaseReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getRun(runId)
      .then((r) => !cancelled && setReport(r))
      .catch((err) => !cancelled && setLoadError(err instanceof RunnerError ? err.message : 'The report couldn’t be opened. Try again.'));
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useTitle(report ? `Report for ${hostOf(typedUrl || report.targetUrl)}` : 'Report');

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-[680px] px-4 py-10 sm:px-6">
        <FocusHeading className="mb-4 text-question font-bold">Report not found</FocusHeading>
        <Notice tone="fail" title={loadError}>
          It may have been deleted, or it’s older than the 10 check-ups kept for each site.
        </Notice>
        <Link to={PATHS.reports} className="btn-primary mt-6 px-5">
          See past check-ups
        </Link>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-ink-soft">
        <Spinner label="Opening the report…" />
      </div>
    );
  }
  return <Report report={report} url={typedUrl || report.targetUrl} busy={busy} onTestAgain={onTestAgain} onGoDeeper={onGoDeeper} />;
}

function Report({
  report,
  url,
  busy,
  onTestAgain,
  onGoDeeper,
}: {
  report: ReleaseReport;
  url: string;
  busy: boolean;
  onTestAgain: (report: ReleaseReport, url: string) => Promise<string | null>;
  onGoDeeper: (report: ReleaseReport, url: string, role: RoleCredential) => Promise<string | null>;
}) {
  const summary = summarizeReport(report);
  const host = hostOf(url);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [actionError, setActionError] = useState<string | null>(null);
  const [working, setWorking] = useState<'again' | 'deeper' | 'download' | null>(null);
  const problemsRef = useRef<HTMLElement>(null);

  const active = useMemo(() => report.findings.filter(counts), [report.findings]);
  const showFilters = active.length > FILTER_ABOVE;
  const filtered = useMemo(() => active.filter((f) => matches(f, filters)), [active, filters]);
  const grouped = useMemo(() => groupProblems(filtered), [filtered]);
  const statuses = useMemo(() => pageResults(report), [report]);

  const mapPages: MapPage[] = useMemo(() => {
    const list: MapPage[] = (report.siteMap?.pages || report.pages || []).map((p) => ({ urlPath: p.urlPath, title: p.title }));
    for (const page of Object.keys(statuses)) if (!list.some((p) => p.urlPath === page)) list.push({ urlPath: page });
    return list;
  }, [report, statuses]);
  const journeys: MapJourney[] = useMemo(() => (report.siteMap?.journeys || []).map((j) => ({ id: j.id, name: j.name, pages: j.pages })), [report]);
  const pagesWithProblems = useMemo(() => [...new Set(active.flatMap((f) => [f.where.urlPath, ...(f.seenAt?.pages || [])]))].sort(), [active]);

  const run = async (kind: 'again' | 'deeper' | 'download', action: () => Promise<string | null | void>) => {
    setActionError(null);
    setWorking(kind);
    try {
      const error = await action();
      if (error) setActionError(error);
    } catch (err) {
      setActionError(err instanceof RunnerError ? err.message : 'That didn’t work. Try again.');
    } finally {
      setWorking(null);
    }
  };

  const showPage = (page: string) => {
    setFilters((f) => ({ ...f, page: f.page === page ? 'all' : page }));
    problemsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const tone = summary.ready ? 'pass' : 'fail';
  const approvedOn = report.testedWithApprovedPlan ? new Date(report.testedWithApprovedPlan) : null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-12 px-4 py-10 sm:px-6 sm:py-12">
      {/* ── The verdict, and what to do next ── */}
      <div className="space-y-6">
      <section aria-label="Verdict" className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className={`stamp inline-block self-start rounded-lg border-4 px-6 py-3 ${TONE_BORDER[tone]} ${TONE_TINT[tone]}`}>
          <FocusHeading className={`font-stamp text-4xl font-extrabold uppercase tracking-wide sm:text-5xl ${TONE_TEXT[tone]}`}>{summary.stamp}</FocusHeading>
        </div>
        <div className="min-w-0">
          <p className="text-xl font-bold text-ink">{summary.reason}</p>
          <p className="mt-1 break-words text-ink-soft">
            {host} · checked {formatWhen(report.timestamp)}
          </p>
          {approvedOn && !Number.isNaN(approvedOn.getTime()) && (
            <p className="mt-1 text-ink-soft">
              Tested with the plan you approved on {approvedOn.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}.
            </p>
          )}
          {summary.readOnly && <p className="mt-1 text-ink-soft">Only looked at: nothing was sent or changed, so forms weren’t tested.</p>}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary px-5"
          disabled={working !== null}
          onClick={() => void run('download', () => downloadRunFile(report.runId, 'report.html'))}
        >
          {working === 'download' ? <Spinner label="Downloading…" /> : 'Download the report'}
        </button>
        <button type="button" className="btn-quiet px-5" disabled={busy || working !== null} onClick={() => void run('again', () => onTestAgain(report, url))}>
          {working === 'again' ? <Spinner label="Starting…" /> : 'Test again'}
        </button>
        <Link to={PATHS.new} className="btn-link">
          New check-up
        </Link>
      </div>
      {busy && <p className="text-sm text-ink-soft">A check-up is in progress. Test again once it’s finished.</p>}
      {actionError && <ErrorMessage>{actionError}</ErrorMessage>}

      <GoDeeper disabled={busy || working !== null} working={working === 'deeper'} onStart={(role) => run('deeper', () => onGoDeeper(report, url, role))} />
      </div>

      {/* ── How each area did ── */}
      {report.grades && (
        <section aria-labelledby="areas-heading">
          <h2 id="areas-heading" className="mb-4 text-2xl font-bold">
            How each area did
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ASPECTS.map((aspect) => {
              const data = report.grades!.aspects[aspect];
              const checked = !!data && data.checked !== false;
              const t = checked ? gradeTone(data.grade) : null;
              const problems = data?.findings.length ?? 0;
              return (
                <li key={aspect} className={`rounded-lg border-2 bg-surface p-4 ${t ? TONE_BORDER[t] : 'border-rule'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-ink">{aspect}</span>
                    {checked ? (
                      <span className={`font-stamp text-3xl font-extrabold ${TONE_TEXT[t!]}`} aria-label={`Grade ${data.grade}`}>
                        {data.grade}
                      </span>
                    ) : (
                      <span className="text-sm font-bold text-ink-soft">Not checked</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">
                    {!checked
                      ? 'Nothing in this check-up looked at it, so it isn’t graded.'
                      : problems === 0
                        ? 'No problems found.'
                        : `${problems} ${problems === 1 ? 'problem' : 'problems'} found.`}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {report.history?.previousTimestamp && (
        <p className="rounded-lg border-2 border-rule bg-surface px-4 py-3 text-ink">
          Since the check-up on {new Date(report.history.previousTimestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}:{' '}
          <strong className="text-pass">{report.history.fixedFindingFingerprints.length} fixed</strong> ·{' '}
          <strong className="text-fail">{report.history.newFindingFingerprints.length} new</strong> ·{' '}
          <strong className="text-warn">{report.history.openFindingFingerprints.length} still there</strong>
        </p>
      )}

      {/* ── What to improve first ── */}
      {report.recommendations && report.recommendations.length > 0 && (
        <section aria-labelledby="first-heading">
          <h2 id="first-heading" className="mb-4 text-2xl font-bold">
            What to improve first
          </h2>
          <ol className="space-y-3">
            {report.recommendations.slice(0, 5).map((rec) => (
              <li key={rec.id} className={`rounded-lg border-l-4 bg-surface p-4 ${SERIOUS.has(rec.severity) ? 'border-fail' : 'border-warn'}`}>
                <p className="font-bold text-ink">{plainTitleText(rec.title)}</p>
                <p className="mt-1 text-sm text-ink-soft">
                  {rec.aspect} · {rec.category === 'quick-win' ? 'Quick to fix' : 'A bigger change'} · on {rec.affectedPages.length}{' '}
                  {rec.affectedPages.length === 1 ? 'page' : 'pages'}
                </p>
                {rec.suggestedFix && (
                  <details data-developer className="mt-2">
                    <summary className="min-h-[36px] cursor-pointer py-1 text-sm font-bold text-stamp">How to fix it (for developers)</summary>
                    <p className="text-sm text-ink">{rec.suggestedFix}</p>
                  </details>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ── Map of results ── */}
      {mapPages.length > 0 && (
        <section aria-labelledby="map-heading">
          <h2 id="map-heading" className="mb-1 text-2xl font-bold">
            Map of results
          </h2>
          <p className="mb-4 text-ink-soft">Choose a page to see only its problems.</p>
          <div className="flex h-[440px] overflow-hidden rounded-lg border-2 border-rule">
            <SiteMap
              pages={mapPages}
              journeys={journeys}
              mode="report"
              pageStatuses={statuses}
              selectedPagePath={filters.page === 'all' ? null : filters.page}
              onSelectPage={showPage}
              maxCards={12}
            />
          </div>
        </section>
      )}

      {/* ── Problems found ── */}
      <section ref={problemsRef} aria-labelledby="problems-heading" className="scroll-mt-24">
        <h2 id="problems-heading" className="mb-1 text-2xl font-bold">
          Problems found
        </h2>
        <p className="mb-4 text-ink-soft">{summary.headline}</p>

        {showFilters && (
          <ProblemFilters filters={filters} setFilters={setFilters} pages={pagesWithProblems} shown={filtered.length} total={active.length} />
        )}
        {!showFilters && filters.page !== 'all' && (
          <p className="mb-4 flex flex-wrap items-center gap-x-3 text-ink">
            Showing the problems on <span className="break-all font-mono">{filters.page}</span>
            <button type="button" className="btn-link" onClick={() => setFilters(NO_FILTERS)}>
              Show every page
            </button>
          </p>
        )}

        {active.length === 0 ? (
          <Notice tone="pass" title="No problems found">
            Every check that ran on the tested pages passed.
          </Notice>
        ) : filtered.length === 0 ? (
          <p className="text-ink-soft">No problems match. Change the filters to see more.</p>
        ) : (
          <div className="space-y-8">
            {BUCKETS.map((bucket) =>
              grouped[bucket.id].length === 0 ? null : (
                <div key={bucket.id}>
                  <h3 className="text-xl font-bold">
                    {bucket.title} <span className="font-normal text-ink-soft">({grouped[bucket.id].length})</span>
                  </h3>
                  <p className="mb-3 text-sm text-ink-soft">{bucket.intro}</p>
                  <ul className="space-y-2">
                    {grouped[bucket.id].map((group) => (
                      <ProblemItem key={group.key} group={group} runId={report.runId} targetUrl={url} />
                    ))}
                  </ul>
                </div>
              )
            )}
          </div>
        )}
      </section>

      {report.notes && report.notes.length > 0 && (
        <section aria-labelledby="notes-heading">
          <h2 id="notes-heading" className="mb-3 text-2xl font-bold">
            Good to know
          </h2>
          <ul className="list-disc space-y-1 pl-6 text-ink">
            {report.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      <details data-developer className="rounded-lg border-2 border-rule bg-surface">
        <summary className="min-h-[48px] cursor-pointer px-4 py-3 font-bold">Details for developers</summary>
        <div className="space-y-3 border-t border-rule p-4 text-sm">
          <p className="text-ink-soft">
            Check-up <code className="font-mono text-ink">{report.runId}</code> of <span className="break-all font-mono text-ink">{report.targetUrl}</span>, in{' '}
            {Math.round(report.durationMs / 1000)} seconds. {report.coverage.totalTestPoints} tests: {report.coverage.passed} passed,{' '}
            {report.coverage.failed} failed, {report.coverage.skipped} skipped.
            {report.aiModels?.text && ` Planned by ${report.aiModels.text}.`}
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-quiet min-h-[40px] px-3 text-sm" onClick={() => void run('download', () => downloadRunFile(report.runId, 'report.md'))}>
              Download report.md
            </button>
            <button type="button" className="btn-quiet min-h-[40px] px-3 text-sm" onClick={() => void run('download', () => downloadRunFile(report.runId, 'findings.json'))}>
              Download findings.json
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}

/** "Go deeper": the same site again, signed in, so the pages behind the sign-in are tested too. */
function GoDeeper({ disabled, working, onStart }: { disabled: boolean; working: boolean; onStart: (role: RoleCredential) => void }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  return (
    <div>
      <button type="button" className="btn-link" aria-expanded={open} aria-controls="go-deeper" onClick={() => setOpen((o) => !o)}>
        Go deeper: test the signed-in pages
      </button>
      {open && (
        <form
          id="go-deeper"
          className="mt-3 max-w-xl space-y-4 rounded-lg border-2 border-edge bg-surface p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (username.trim() && password) onStart({ role: 'member', username: username.trim(), password });
          }}
        >
          <p className="text-ink-soft">
            Sign in details for a test account. The site is scanned again signed in, and you review the new plan before anything is tested.
            The details are never saved to disk.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="deeper-username" className="label">
                Email or username
              </label>
              <input id="deeper-username" className="field" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div>
              <label htmlFor="deeper-password" className="label">
                Password
              </label>
              <input
                id="deeper-password"
                className="field"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" className="btn-primary px-5" disabled={disabled || !username.trim() || !password}>
            {working ? <Spinner label="Starting…" /> : 'Sign in and scan again'}
          </button>
        </form>
      )}
    </div>
  );
}

function ProblemFilters({
  filters,
  setFilters,
  pages,
  shown,
  total,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  pages: string[];
  shown: number;
  total: number;
}) {
  const select = 'field w-full py-2 text-sm';
  return (
    <div role="search" aria-label="Filter the problems" className="mb-6 rounded-lg border-2 border-rule bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="filter-search" className="label text-sm">
            Search
          </label>
          <input
            id="filter-search"
            type="search"
            className={select}
            value={filters.search}
            placeholder="For example, contrast"
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="filter-bucket" className="label text-sm">
            How serious
          </label>
          <select id="filter-bucket" className={select} value={filters.bucket} onChange={(e) => setFilters({ ...filters, bucket: e.target.value as Filters['bucket'] })}>
            <option value="all">All</option>
            {BUCKETS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="filter-page" className="label text-sm">
            Page
          </label>
          <select id="filter-page" className={select} value={filters.page} onChange={(e) => setFilters({ ...filters, page: e.target.value })}>
            <option value="all">Every page</option>
            {pages.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="filter-aspect" className="label text-sm">
            Area
          </label>
          <select id="filter-aspect" className={select} value={filters.aspect} onChange={(e) => setFilters({ ...filters, aspect: e.target.value as Filters['aspect'] })}>
            <option value="all">Every area</option>
            {ASPECTS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p role="status" className="mt-3 flex flex-wrap items-center gap-x-3 text-sm text-ink-soft">
        Showing {shown} of {total} problems
        {(filters.bucket !== 'all' || filters.page !== 'all' || filters.aspect !== 'all' || filters.search) && (
          <button type="button" className="btn-link min-h-[36px] text-sm" onClick={() => setFilters(NO_FILTERS)}>
            Clear the filters
          </button>
        )}
      </p>
    </div>
  );
}

/** One problem: a button that opens where it was found, with the technical detail for each place under it. */
function ProblemItem({ group, runId, targetUrl }: { group: ProblemGroup; runId: string; targetUrl: string }) {
  const [open, setOpen] = useState(false);
  const id = `problem-${group.key.replace(/[^a-z0-9]+/gi, '-')}`;
  const serious = group.bucket === 'must-fix';
  const extra = group.findings.length - DETAILS_SHOWN;
  return (
    <li className={`rounded-lg border-l-4 bg-surface ${serious ? 'border-fail' : group.bucket === 'to-confirm' ? 'border-rule' : 'border-warn'}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[56px] w-full items-start justify-between gap-4 rounded-r-lg px-4 py-3 text-left hover:bg-panel"
      >
        <span className="min-w-0">
          <span className="block font-bold text-ink">{group.title}</span>
          <span className="block text-sm text-ink-soft">
            {group.category} · on {group.pages.length} {group.pages.length === 1 ? 'page' : 'pages'}
          </span>
        </span>
        <span aria-hidden="true" className="shrink-0 pt-0.5 text-ink-soft">
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <div id={id} className="border-t border-rule px-4 pb-4 pt-3">
          <p className="text-sm font-bold text-ink-soft">Found on</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {group.pages.map((page) => (
              <li key={page} className="rounded border border-rule px-2 py-0.5 font-mono text-xs text-ink">
                {page}
              </li>
            ))}
          </ul>
          {group.findings.slice(0, DETAILS_SHOWN).map((f) => (
            <DeveloperDetails key={f.id} finding={f} runId={runId} targetUrl={targetUrl} />
          ))}
          {extra > 0 && <p className="mt-2 text-sm text-ink-soft">And {extra} more {extra === 1 ? 'place' : 'places'} like these.</p>}
        </div>
      )}
    </li>
  );
}
