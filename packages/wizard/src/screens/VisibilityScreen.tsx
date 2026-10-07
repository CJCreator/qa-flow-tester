import React, { useEffect, useState } from 'react';
import type { AspectGrade, Finding, ReleaseReport } from '@qa/types';
import { getRun, RunnerError } from '../api';
import { ErrorMessage, FocusHeading, Spinner } from '../components/text';
import { gradeClasses } from '../lib/grades';
import { Link, PATHS } from '../lib/router';
import { useDocumentTitle } from '../lib/title';
import { hostOf } from '../lib/url';

type LensTab = 'search' | 'answers' | 'aiSearch' | 'marketing';

const LENS_METADATA: Record<LensTab, { label: string; tag: string; description: string; hint: string }> = {
  search: {
    label: 'Search (SEO)',
    tag: 'SEO',
    description: 'How search engines like Google and Bing find, index, and rank your pages.',
    hint: 'Titles, meta descriptions, headings, canonical links, robots.txt, and sitemaps.',
  },
  answers: {
    label: 'AI answers (AEO)',
    tag: 'AEO',
    description: 'How voice assistants and AI answer boxes select direct answers from your site.',
    hint: 'Schema.org JSON-LD markup, FAQPage, HowTo, and BreadcrumbList structured data.',
  },
  aiSearch: {
    label: 'AI search (GEO)',
    tag: 'GEO',
    description: 'How AI search engines like ChatGPT, Claude, and Perplexity parse, understand, and cite your content.',
    hint: 'llms.txt agent summary, AI crawler permissions (GPTBot, ClaudeBot), semantic article structure, and citable facts.',
  },
  marketing: {
    label: 'Marketing (MKT)',
    tag: 'MKT',
    description: 'How effectively your pages convert visitors into customers.',
    hint: 'Rich social share previews, clear call to action, contact channels, privacy links, analytics, and trust proof.',
  },
};

function gradeForScore(score: number): AspectGrade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

export function VisibilityScreen({ runId }: { runId: string }) {
  const [report, setReport] = useState<ReleaseReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<LensTab>('search');

  useEffect(() => {
    let cancelled = false;
    getRun(runId)
      .then((r) => !cancelled && setReport(r))
      .catch(
        (err) =>
          !cancelled &&
          setError(err instanceof RunnerError ? err.message : 'The report could not be opened. Try again.')
      );
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useDocumentTitle(report ? `Search and AI visibility · ${hostOf(report.targetUrl)}` : 'Search and AI visibility');

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12">
        <ErrorMessage>{error}</ErrorMessage>
        <div className="mt-4">
          <Link to={PATHS.report(runId)} className="btn-secondary">
            ← Back to Report
          </Link>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner label="Loading search and AI visibility..." />
      </div>
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

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Breadcrumb Navigation */}
      <nav aria-label="Breadcrumbs" className="mb-4 text-xs text-ink-soft">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link to={PATHS.reports} className="hover:text-ink hover:underline">
              Check-ups
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link to={PATHS.report(runId)} className="hover:text-ink hover:underline">
              {hostOf(report.targetUrl)}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="font-semibold text-ink" aria-current="page">
            Search & AI Visibility
          </li>
        </ol>
      </nav>

      {/* Screen Title */}
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4 border-b border-rule pb-4">
        <div>
          <FocusHeading className="text-2xl font-bold text-ink sm:text-3xl">Search & AI Visibility</FocusHeading>
          <p className="mt-1 text-sm text-ink-soft">
            Audit of SEO, structured data, AI crawler accessibility, and conversion readiness for{' '}
            <span className="font-semibold text-ink">{hostOf(report.targetUrl)}</span>.
          </p>
        </div>
        <Link to={PATHS.report(runId)} className="btn-secondary text-xs">
          ← Back to Report
        </Link>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Visibility audit dimensions"
        className="mb-6 flex flex-wrap gap-2 border-b border-rule pb-2"
      >
        {(['search', 'answers', 'aiSearch', 'marketing'] as const).map((tab) => {
          const meta = LENS_METADATA[tab];
          const part = getTabScore(tab);
          const isSelected = activeTab === tab;
          const scoreDisplay = part?.checked === false ? 'Off' : `${part?.score ?? 100}%`;
          const grade = part?.score !== undefined ? gradeForScore(part.score) : undefined;

          return (
            <button
              key={tab}
              role="tab"
              id={`tab-${tab}`}
              aria-selected={isSelected}
              aria-controls={`panel-${tab}`}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-2 rounded-control px-4 py-2.5 text-sm font-bold transition-all ${
                isSelected
                  ? 'border-2 border-stamp bg-surface text-ink shadow-level-1'
                  : 'border border-edge bg-canvas text-ink-soft hover:bg-surface hover:text-ink'
              }`}
            >
              <span>{meta.label}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-xs ${grade ? gradeClasses(grade) : 'bg-surface text-ink-soft'}`}
              >
                {scoreDisplay}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tab Panel */}
      <section id={`panel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`} className="space-y-6">
        {/* Dimension Header Banner */}
        <div className="rounded-card border border-edge bg-surface p-5 shadow-level-1">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-ink">{LENS_METADATA[activeTab].label}</h2>
              <p className="mt-1 max-w-2xl text-sm text-ink-soft">{LENS_METADATA[activeTab].description}</p>
              <p className="mt-1 text-xs text-ink-soft">
                <span className="font-semibold text-ink">Checked: </span>
                {LENS_METADATA[activeTab].hint}
              </p>
            </div>
            {currentSub && currentSub.checked !== false && (
              <div className="text-right">
                <div className="text-3xl font-extrabold text-ink">{currentSub.score}%</div>
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Health Score</div>
              </div>
            )}
          </div>
        </div>

        {/* Marketing Specific Checklist */}
        {activeTab === 'marketing' && marketingChecks.length > 0 && (
          <div className="rounded-card border border-edge bg-surface p-5 shadow-level-1">
            <h3 className="mb-3 text-base font-bold text-ink">Marketing Basics Checklist</h3>
            <p className="mb-4 text-xs text-ink-soft">
              Scanned across tested pages to evaluate social reach, user action guidance, and trust factors.
            </p>
            <ul className="divide-y divide-rule text-sm">
              {marketingChecks.map((check) => (
                <li key={check.key} className="flex items-start justify-between gap-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          check.status === 'ok'
                            ? 'bg-pass/10 text-pass'
                            : check.status === 'gap'
                              ? 'bg-warn/10 text-warn'
                              : 'bg-canvas text-ink-soft'
                        }`}
                      >
                        {check.status === 'ok' ? '✓' : check.status === 'gap' ? '⚠' : '○'}
                      </span>
                      <span className="font-semibold text-ink">{check.label}</span>
                      {check.kind === 'opinion' && (
                        <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] text-ink-soft">
                          Recommendation
                        </span>
                      )}
                    </div>
                    {check.detail && <p className="mt-1 pl-7 text-xs text-ink-soft">{check.detail}</p>}
                  </div>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
                      check.status === 'ok'
                        ? 'border border-pass/30 bg-pass/10 text-pass'
                        : check.status === 'gap'
                          ? 'border border-warn/30 bg-warn/10 text-warn'
                          : 'border border-edge bg-canvas text-ink-soft'
                    }`}
                  >
                    {check.status === 'ok' ? 'Present' : check.status === 'gap' ? 'Missing' : 'Not relevant'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Missing / Needs Attention Items */}
        <div className="rounded-card border border-edge bg-surface p-5 shadow-level-1">
          <div className="flex items-center justify-between border-b border-rule pb-3">
            <h3 className="text-base font-bold text-ink">Needs Attention ({currentFindings.length})</h3>
            <span className="text-xs text-ink-soft">
              {currentFindings.length === 0 ? 'All checked items passed' : 'Actionable findings to resolve'}
            </span>
          </div>

          {currentFindings.length === 0 ? (
            <div className="py-8 text-center text-ink-soft">
              <span className="inline-block text-2xl text-pass">✓</span>
              <p className="mt-2 text-sm font-semibold text-ink">
                No defects found for {LENS_METADATA[activeTab].label}!
              </p>
              <p className="text-xs">Your inspected pages conform to the expected best practices for this category.</p>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {currentFindings.map((finding) => (
                <article
                  key={finding.id}
                  className="rounded-control border border-edge bg-canvas p-4 text-sm transition-all hover:border-stamp"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h4 className="font-bold text-ink">{finding.title}</h4>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${
                        finding.severity === 'Major'
                          ? 'bg-fail/10 text-fail border border-fail/20'
                          : finding.severity === 'Minor'
                            ? 'bg-warn/10 text-warn border border-warn/20'
                            : 'bg-canvas text-ink-soft border border-edge'
                      }`}
                    >
                      {finding.severity === 'Major'
                        ? 'Must fix'
                        : finding.severity === 'Minor'
                          ? 'Should fix'
                          : 'Suggestion'}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-ink-soft">
                    Found on: <code className="font-mono text-ink">{finding.where.urlPath}</code>
                  </p>

                  <div className="mt-3 grid gap-2 rounded border border-edge/60 bg-surface p-3 text-xs">
                    <div>
                      <span className="font-semibold text-ink">Actual: </span>
                      <span className="text-warn">{finding.expectedVsActual.actual}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-ink">Expected: </span>
                      <span className="text-ink-soft">{finding.expectedVsActual.expected}</span>
                    </div>
                  </div>

                  {finding.resolution && (
                    <div className="mt-3 border-t border-rule pt-2 text-xs">
                      <span className="font-semibold text-pass">How to fix: </span>
                      <span className="text-ink">{finding.resolution}</span>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
