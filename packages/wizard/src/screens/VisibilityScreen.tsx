import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AspectGrade, Finding, ReleaseReport } from '@qa/types';
import { getRun, RunnerError } from '../api';
import { DeveloperDetails } from '../components/DeveloperDetails';
import { FocusHeading, Spinner } from '../components/text';
import { Badge, EmptyState, LoadError, Page, PageHeader, type Tone } from '../components/ui';
import { gradeClasses } from '../lib/grades';
import { Link, PATHS } from '../lib/router';
import { aspectOf, BUCKETS, bucketOf, howToFix, plainTitle, whyItMatters, type Bucket } from '../lib/summary';
import { useDocumentTitle } from '../lib/title';
import { looksTechnical } from '../lib/translate';
import { hostOf } from '../lib/url';

type LensTab = 'search' | 'answers' | 'aiSearch' | 'marketing';

const TABS: LensTab[] = ['search', 'answers', 'aiSearch', 'marketing'];

const LENS_METADATA: Record<LensTab, { label: string; tag: string; description: string; hint: string }> = {
  search: {
    label: 'Search (SEO)',
    tag: 'SEO',
    description: 'How search engines such as Google and Bing find, list and rank your pages.',
    hint: 'Page titles and descriptions, headings, links to the main copy of a page, and the files that guide search engines.',
  },
  answers: {
    label: 'AI answers (AEO)',
    tag: 'AEO',
    description: 'How voice assistants and AI answer boxes pick direct answers from your site.',
    hint: 'Questions and answers, step-by-step guides and page trails marked up so machines can read them.',
  },
  aiSearch: {
    label: 'AI search (GEO)',
    tag: 'GEO',
    description: 'How AI search tools such as ChatGPT, Claude and Perplexity read, understand and quote your content.',
    hint: 'A summary file for AI tools, whether AI crawlers may visit, clear article structure, and facts worth quoting.',
  },
  marketing: {
    label: 'Marketing (MKT)',
    tag: 'MKT',
    description: 'How well your pages turn visitors into customers.',
    hint: 'Share previews, a clear call to action, ways to get in touch, privacy links, analytics and proof people trust.',
  },
};

function gradeForScore(score: number): AspectGrade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

const BUCKET_TONE: Record<Bucket, Tone> = {
  'must-fix': 'fail',
  'should-fix': 'warn',
  suggestion: 'neutral',
  'to-confirm': 'neutral',
  judgement: 'neutral',
};

export function VisibilityScreen({ runId }: { runId: string }) {
  const [report, setReport] = useState<ReleaseReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [activeTab, setActiveTab] = useState<LensTab>('search');
  const tabRefs = useRef<Partial<Record<LensTab, HTMLButtonElement | null>>>({});

  useEffect(() => {
    let cancelled = false;
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

  useDocumentTitle(report ? `Search and AI visibility · ${hostOf(report.targetUrl)}` : 'Search and AI visibility');

  const back = { to: PATHS.report(runId), label: 'Back to the report' };

  if (error) {
    return (
      <Page width="workspace">
        <Link to={back.to} className="btn-link -my-2 w-fit text-sm">
          <span aria-hidden="true">←&nbsp;</span>
          {back.label}
        </Link>
        <FocusHeading className="mb-4 mt-6 font-stamp text-3xl font-bold sm:text-4xl">
          Search and AI visibility can’t be shown
        </FocusHeading>
        <LoadError title="The report didn’t open" onRetry={() => setAttempt((n) => n + 1)}>
          {error}
        </LoadError>
      </Page>
    );
  }

  if (!report) {
    return (
      <Page width="workspace">
        <p className="text-ink-soft">
          <Spinner label="Opening search and AI visibility…" />
        </p>
      </Page>
    );
  }

  const findable = report.grades?.aspects['Findable'];
  const subBreakdown = findable?.subBreakdown;

  const getTabScore = (tab: LensTab) => {
    if (!subBreakdown) return null;
    switch (tab) {
      case 'search':
        return subBreakdown.seo;
      case 'answers':
        return subBreakdown.aeo;
      case 'aiSearch':
        return subBreakdown.geo;
      case 'marketing':
        return subBreakdown.marketing;
    }
  };

  const getLensFindings = (tab: LensTab): Finding[] => {
    const tag = LENS_METADATA[tab].tag;
    return report.findings.filter((f) => {
      if (f.categoryTag === tag) return true;
      if (tab === 'search' && f.checker === 'seo' && (!f.categoryTag || f.categoryTag === 'SEO')) return true;
      return false;
    });
  };

  const currentFindings = getLensFindings(activeTab);
  const currentSub = getTabScore(activeTab);
  const marketingChecks = report.marketing?.checks ?? [];

  /** Arrow keys, Home and End move between the tabs (roving tabindex); the chosen tab opens. */
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const at = TABS.indexOf(activeTab);
    const next =
      e.key === 'ArrowRight'
        ? TABS[(at + 1) % TABS.length]
        : e.key === 'ArrowLeft'
          ? TABS[(at - 1 + TABS.length) % TABS.length]
          : e.key === 'Home'
            ? TABS[0]
            : e.key === 'End'
              ? TABS[TABS.length - 1]
              : null;
    if (!next) return;
    e.preventDefault();
    setActiveTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <Page width="workspace">
      <PageHeader
        back={back}
        meta={<span className="break-all">{hostOf(report.targetUrl)}</span>}
        title="Search and AI visibility"
        lede="How search engines, AI answers and AI search tools find and read the site, and the marketing basics."
      />

      <div role="tablist" aria-label="What to look at" className="mb-6 flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const meta = LENS_METADATA[tab];
          const part = getTabScore(tab);
          const isSelected = activeTab === tab;
          const scoreDisplay = part?.checked === false ? 'Not checked' : `${part?.score ?? 100}%`;
          const grade = part?.score !== undefined && part.checked !== false ? gradeForScore(part.score) : undefined;

          return (
            <button
              key={tab}
              ref={(el) => {
                tabRefs.current[tab] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${tab}`}
              aria-selected={isSelected}
              aria-controls={isSelected ? `panel-${tab}` : undefined}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setActiveTab(tab)}
              onKeyDown={onTabKey}
              className={`flex min-h-[44px] items-center gap-2 rounded-control border-[1.5px] px-4 py-2 text-sm font-bold transition-colors duration-fast ${
                isSelected
                  ? 'border-stamp bg-stamp-tint text-ink'
                  : 'border-edge bg-surface text-ink-soft hover:text-ink'
              }`}
            >
              <span>{meta.label}</span>
              <span
                className={`rounded-control border px-1.5 py-0.5 text-xs ${grade ? gradeClasses(grade) : 'border-rule bg-canvas text-ink-soft'}`}
              >
                {scoreDisplay}
              </span>
            </button>
          );
        })}
      </div>

      <section
        id={`panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
        tabIndex={0}
        className="space-y-10"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-rule pb-6">
          <div className="max-w-prose">
            <h2 className="text-xl font-bold text-ink">{LENS_METADATA[activeTab].label}</h2>
            <p className="mt-1 text-ink-soft">{LENS_METADATA[activeTab].description}</p>
            <p className="mt-2 text-sm text-ink-soft">
              <span className="font-bold text-ink">What it looks at: </span>
              {LENS_METADATA[activeTab].hint}
            </p>
          </div>
          {currentSub && currentSub.checked !== false && (
            <p className="text-right">
              <span className="block font-stamp text-3xl font-bold text-ink">{currentSub.score}%</span>
              <span className="block text-sm text-ink-soft">Score</span>
            </p>
          )}
        </div>

        {activeTab === 'marketing' && marketingChecks.length > 0 && (
          <div>
            <h3 className="text-lg font-bold text-ink">Marketing basics</h3>
            <p className="mb-3 text-sm text-ink-soft">
              Read across the tested pages: how the site is shared, what it asks visitors to do, and what makes people
              trust it.
            </p>
            <ul className="divide-y divide-rule rounded-card border border-rule bg-surface">
              {marketingChecks.map((check) => (
                <li key={check.key} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-xs font-bold ${
                          check.status === 'ok'
                            ? 'bg-pass-tint text-pass'
                            : check.status === 'gap'
                              ? 'bg-warn-tint text-warn'
                              : 'bg-canvas text-ink-soft'
                        }`}
                      >
                        {check.status === 'ok' ? '✓' : check.status === 'gap' ? '!' : '–'}
                      </span>
                      <span className="font-bold text-ink">{check.label}</span>
                      {check.kind === 'opinion' && <Badge>Suggestion</Badge>}
                    </p>
                    {check.detail && <p className="mt-1 pl-8 text-sm text-ink-soft">{check.detail}</p>}
                  </div>
                  <Badge tone={check.status === 'ok' ? 'pass' : check.status === 'gap' ? 'warn' : 'neutral'}>
                    {check.status === 'ok' ? 'Present' : check.status === 'gap' ? 'Missing' : 'Not relevant'}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h3 className="mb-3 text-lg font-bold text-ink">Needs attention ({currentFindings.length})</h3>

          {currentFindings.length === 0 ? (
            <EmptyState
              title={`Nothing to fix for ${LENS_METADATA[activeTab].label}`}
              action={
                <Link to={back.to} className="btn-quiet">
                  Back to the report
                </Link>
              }
            >
              The tested pages do what is expected here.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-rule rounded-card border border-rule bg-surface">
              {currentFindings.map((finding, i) => {
                const bucket = bucketOf(finding);
                const title = plainTitle(finding);
                const aspect = finding.aspect ?? aspectOf(finding.checker);
                return (
                  <li key={`${finding.id}-${i}`} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h4 className="font-bold text-ink">{title}</h4>
                      <Badge tone={BUCKET_TONE[bucket]}>{BUCKETS.find((b) => b.id === bucket)?.title}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-ink-soft">
                      Found on <span className="break-all font-mono text-ink">{finding.where.urlPath}</span>
                    </p>
                    <p className="mt-2 text-ink">
                      <strong>Why it matters: </strong>
                      {whyItMatters({ title, aspect })}
                    </p>
                    <p className="mt-1 text-ink">
                      <strong>How to fix: </strong>
                      {howToFix({ findings: [finding] }, looksTechnical)}
                    </p>
                    <DeveloperDetails finding={finding} runId={report.runId} targetUrl={report.targetUrl} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </Page>
  );
}
