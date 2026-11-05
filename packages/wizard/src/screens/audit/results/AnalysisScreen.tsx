import { useEffect, useRef, useState } from 'react';
import type { AuditGetReply, AuditPage, PageContent, RouteSkipReason } from '@qa/types/src/browser.js';
import { ErrorMessage, Notice, Spinner } from '../../../components/text';
import { Page, PageHeader } from '../../../components/ui';
import { formatDay, scrollBehavior } from '../../../lib/format';
import { Link, PATHS } from '../../../lib/router';
import { AuditTabs } from '../AuditTabs';
import { useDocumentTitle } from '../../../lib/title';
import { AuditSummary, NotesBanner } from './AuditSummary';
import { FindingsList } from './FindingsList';
import { InternalLinkingView, LeavingSiteView, RoadmapView } from './RoadmapView';
import { SiteAreasView } from './SiteAreasView';
import { HierarchyView } from './HierarchyView';
import { PageContentView } from './PageContentView';
import { PageFactsView, SiteSignalsView } from './PageFactsView';
import { loadCallerIsHelper } from '../saved/caller-access';
import { getAuditResult, getPageContent } from './analysis-client';
import { titleText } from './analysis-text';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type AnalysisLoad =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'loaded'; reply: AuditGetReply };

export type ContentLoad =
  | { status: 'idle' }
  | { status: 'loading'; urlPath: string }
  | { status: 'error'; urlPath: string; message: string }
  | { status: 'loaded'; urlPath: string; content: PageContent };

/** Why a Skipped Page was not recorded, in plain words. Every reason says the page was not checked. */
export const SKIP_REASON_TEXT: Readonly<Record<RouteSkipReason, string>> = {
  'page-limit': 'over the max pages limit',
  'depth-limit': 'more link steps from the start address than the max depth allows',
  excluded: 'left out by the include or exclude paths',
  payment: 'a payment page: nothing on it is clicked or sent',
  'did-not-load': 'it did not load',
  robots: 'robots.txt asks tools not to open it',
  'sign-in': 'it needs a sign-in, and a Website Audit never signs in',
  'http-error': 'the website answered with an error',
  timeout: 'it took too long to load',
  'off-site-redirect': 'it sends visitors to another website',
  'time-limit': 'the time limit was reached',
  'trap-limit': 'stopped to avoid an endless loop of pages',
  'session-lost': 'the visit was cut off part-way',
  duplicate: 'the same page as another one',
};

/** What a page list entry says about where its checks come from. */
export function pageCheckText(page: AuditPage): string {
  if (page.coverage === 'sample') return 'Sample Page: checked itself';
  return page.sampleUrlPath ? `Checked on its Sample Page ${page.sampleUrlPath}` : 'Checked on its Sample Page';
}

function skipText(why: RouteSkipReason): string {
  return SKIP_REASON_TEXT[why] ?? 'reason not recorded';
}

export interface AnalysisViewProps {
  load: AnalysisLoad;
  selectedPath: string | null;
  content: ContentLoad;
  onSelect: (urlPath: string) => void;
  /** For the way back from an error; once loaded, the version's own id is used. */
  auditId?: string;
  /** Tries the load again; the error state shows a Retry button when given. */
  onRetry?: () => void;
  /** The caller is a Helper: the owner's "Preview and Shared Links" is not shown. null while the check is open: shown to no one yet (ADR 0037). */
  isHelper?: boolean | null;
}

/** "Version 2 results · example.org", for the tab title. */
function resultsTitle(reply: AuditGetReply): string {
  let host = reply.version.url;
  try {
    host = new URL(reply.version.url).host;
  } catch {
    // keep the address as written
  }
  return `Version ${reply.version.version} results · ${host}`;
}

const CARD = 'mt-8';

function PageList({
  pages,
  selectedPath,
  onSelect,
}: {
  pages: AuditPage[];
  selectedPath: string | null;
  onSelect: (urlPath: string) => void;
}) {
  return (
    <section aria-labelledby="audit-pages-title" className={`${CARD} space-y-3`}>
      <h2 id="audit-pages-title" className="text-xl font-bold">
        Pages
      </h2>
      {pages.length === 0 ? (
        <p className="text-sm text-ink-soft">No pages were recorded.</p>
      ) : (
        <>
          <p className="text-sm text-ink-soft">Pick a page to see its facts and its Page Content.</p>
          <ul className="space-y-2">
            {pages.map((page) => {
              const selected = page.urlPath === selectedPath;
              return (
                <li key={page.urlPath}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelect(page.urlPath)}
                    className={`min-h-[44px] w-full rounded-control border px-3 py-2 text-left transition-colors duration-fast ${
                      selected ? 'border-stamp bg-stamp-tint' : 'border-edge bg-surface hover:border-ink'
                    }`}
                  >
                    <span className="block break-all font-mono text-sm font-bold">{page.urlPath}</span>
                    <span className="block text-sm">{titleText(page.title)}</span>
                    <span className="block text-sm text-ink-soft">{pageCheckText(page)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function SkippedPages({ reply }: { reply: AuditGetReply }) {
  const coverage = reply.result!.coverage;
  return (
    <section aria-labelledby="audit-skipped-title" className={`${CARD} space-y-3`}>
      <h2 id="audit-skipped-title" className="text-xl font-bold">
        Skipped Pages
      </h2>
      <p className="text-sm text-ink-soft">
        {`Pages found: ${coverage.found} · recorded: ${coverage.reached} · skipped: ${coverage.skipped.length}`}
      </p>
      {coverage.skipped.length === 0 ? (
        <p className="text-sm text-ink-soft">No pages were skipped.</p>
      ) : (
        <>
          <p className="text-sm text-ink-soft">
            A Skipped Page was found but not recorded, so it was not checked: it is not a clean result.
          </p>
          <ul className="space-y-1 text-sm">
            {coverage.skipped.map((page, i) => (
              <li key={`${page.urlPath}-${i}`}>
                <span className="break-all font-mono">{page.urlPath}</span>
                {` · Not checked: ${skipText(page.why)}`}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function SelectedPage({
  reply,
  selectedPath,
  content,
}: {
  reply: AuditGetReply;
  selectedPath: string | null;
  content: ContentLoad;
}) {
  const result = reply.result!;
  const page = selectedPath === null ? undefined : result.pages.find((p) => p.urlPath === selectedPath);
  if (!page) {
    return result.pages.length === 0 ? null : <p className={`${CARD} text-sm text-ink-soft`}>No page is picked yet.</p>;
  }
  return (
    <div className={`${CARD} space-y-8`}>
      {page.coverage === 'covered' && (
        <Notice tone="stamp" title={`${pageCheckText(page)}.`}>
          Its checks, notes and recommendation come from that Sample Page, which shares its layout.
        </Notice>
      )}
      <PageFactsView page={page} auditId={reply.version.auditId} version={reply.version.version} />
      {content.status === 'loading' && (
        <p className="text-sm text-ink-soft">
          <Spinner label={`Loading the Page Content of ${content.urlPath}…`} />
        </p>
      )}
      {content.status === 'error' && (
        <ErrorMessage>{`The Page Content of ${content.urlPath} could not be loaded. ${content.message}`}</ErrorMessage>
      )}
      {content.status === 'loaded' && content.urlPath === page.urlPath && <PageContentView content={content.content} />}
    </div>
  );
}

function versionStatusText(reply: AuditGetReply): string {
  const { version } = reply;
  if (version.status === 'running') {
    return 'This Website Audit is still in progress. Its analysis shows once it has finished.';
  }
  const why = version.error ? ` ${version.error}` : '';
  return `This Website Audit version stopped before it finished, so it has no analysis.${why}`;
}

/** The analysis of one Website Audit version, from what is already loaded. Takes props only. */
export function AnalysisView({
  load,
  selectedPath,
  content,
  onSelect,
  auditId,
  onRetry,
  isHelper = false,
}: AnalysisViewProps) {
  useDocumentTitle(load.status === 'loaded' ? resultsTitle(load.reply) : 'Website Audit results');
  const id = auditId ?? (load.status === 'loaded' ? load.reply.version.auditId : '');
  const backTo = PATHS.audit(id);
  const reply = load.status === 'loaded' ? load.reply : null;
  const result = reply?.result ?? null;
  const owner = isHelper === false;
  const meta = reply && (
    <>
      <span className="break-all font-mono">{reply.version.url}</span>
      {` · version ${reply.version.version}`}
      {reply.version.finishedAt ? ` · ${formatDay(reply.version.finishedAt)}` : ''}
    </>
  );
  return (
    <Page width="workspace">
      <PageHeader
        back={{ to: PATHS.audits, label: 'All Website Audits' }}
        meta={meta}
        title="Website Audit results"
        actions={
          reply &&
          result && (
            <Link to={PATHS.auditReview(reply.version.auditId, reply.version.version)} className="btn-primary btn-sm">
              Review documents
            </Link>
          )
        }
      />
      {id && (
        <AuditTabs
          auditId={id}
          version={reply?.version.version}
          current="results"
          hide={owner ? [] : ['share', 'helpers']}
        />
      )}
      {load.status === 'loading' && (
        <p className="text-ink-soft">
          <Spinner label="Loading the Website Audit…" />
        </p>
      )}
      {load.status === 'error' && (
        <div className="max-w-prose">
          <Notice
            title={load.message}
            actions={
              <>
                {onRetry && (
                  <button type="button" className="btn-quiet btn-sm" onClick={onRetry}>
                    Try again
                  </button>
                )}
                {auditId && (
                  <Link to={backTo} className="btn-link">
                    Back to this Website Audit
                  </Link>
                )}
              </>
            }
          />
        </div>
      )}
      {reply && result === null && (
        <div className="max-w-prose">
          <Notice tone="stamp" title={versionStatusText(reply)} />
          <p className="mt-3">
            <Link to={backTo} className="btn-link">
              Back to this Website Audit
            </Link>
          </p>
        </div>
      )}
      {reply && result && (
        <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
          <SectionIndex />
          <div className="min-w-0">
            {result.notes.length > 0 && (
              <div className="mb-8">
                <NotesBanner notes={result.notes} />
              </div>
            )}
            <div>
              <AuditSummary result={result} />
            </div>
            <div className={CARD}>
              <FindingsList
                findings={result.findings}
                auditId={reply.version.auditId}
                version={reply.version.version}
              />
            </div>
            <div className={CARD}>
              <SiteAreasView areas={result.siteAreas} />
            </div>
            <div className={CARD}>
              <RoadmapView roadmap={result.roadmap} />
            </div>
            <div className={CARD}>
              <SiteSignalsView technology={result.technology} signals={result.marketing.signals} />
            </div>
            <div className={CARD}>
              <HierarchyView hierarchy={result.hierarchy} />
            </div>
            <PageList pages={result.pages} selectedPath={selectedPath} onSelect={onSelect} />
            <SkippedPages reply={reply} />
            <SelectedPage reply={reply} selectedPath={selectedPath} content={content} />
            <div className={CARD}>
              <InternalLinkingView linking={result.internalLinking} />
            </div>
            <div className={CARD}>
              <LeavingSiteView links={result.leavingSite ?? []} />
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

/** The sections of the results, in page order, by the id of each heading. */
export const RESULT_SECTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'audit-summary-title', label: 'Summary' },
  { id: 'audit-findings-title', label: 'Findings' },
  { id: 'audit-areas-title', label: 'Site areas' },
  { id: 'audit-roadmap-title', label: 'Improvement Roadmap' },
  { id: 'audit-site-signals-title', label: 'Technology and marketing' },
  { id: 'audit-hierarchy-title', label: 'Page hierarchy' },
  { id: 'audit-pages-title', label: 'Pages' },
  { id: 'audit-skipped-title', label: 'Skipped Pages' },
  { id: 'audit-linking-title', label: 'Internal linking' },
  { id: 'audit-leaving-title', label: 'Links that leave the website' },
];

/** Scrolls to a section and moves focus to its heading, so keyboard and screen-reader users land there too. */
function goToSection(id: string) {
  const heading = document.getElementById(id);
  if (!heading) return;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  heading.focus({ preventScroll: true });
}

/** An index of the sections: a sticky column on wide screens, a row that scrolls sideways on phones. */
function SectionIndex() {
  return (
    <nav aria-label="Sections of the results" className="mb-8 lg:mb-0">
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0 lg:sticky lg:top-24 lg:grid lg:gap-0 lg:overflow-visible lg:pb-0">
        {RESULT_SECTIONS.map((section) => (
          <li key={section.id} className="shrink-0">
            <button
              type="button"
              onClick={() => goToSection(section.id)}
              className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-control border border-edge bg-surface px-3 text-sm font-semibold text-ink hover:border-ink lg:w-full lg:border-0 lg:border-l-2 lg:border-rule lg:bg-transparent lg:text-ink-soft lg:hover:border-stamp lg:hover:text-ink"
            >
              {section.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export interface AnalysisScreenProps {
  auditId: string;
  /** The latest version when not given. */
  version?: number;
  /** For tests; the browser's fetch otherwise. */
  fetchImpl?: Fetch;
}

/** Loads one Website Audit version, then the Page Content of each page as it is picked (REQ-007, REQ-009, REQ-014). */
export function AnalysisScreen({ auditId, version, fetchImpl }: AnalysisScreenProps) {
  const [load, setLoad] = useState<AnalysisLoad>({ status: 'loading' });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<ContentLoad>({ status: 'idle' });
  /** The page whose Page Content is wanted now: a late answer for another page is dropped. */
  const wanted = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [isHelper, setIsHelper] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    void loadCallerIsHelper(fetchImpl).then((helper) => live && setIsHelper(helper));
    return () => {
      live = false;
    };
  }, [fetchImpl]);

  useEffect(() => {
    let current = true;
    setLoad({ status: 'loading' });
    setSelectedPath(null);
    setContent({ status: 'idle' });
    wanted.current = null;
    void getAuditResult(auditId, version, fetchImpl).then((outcome) => {
      if (!current) return;
      setLoad(outcome.ok ? { status: 'loaded', reply: outcome.reply } : { status: 'error', message: outcome.error });
    });
    return () => {
      current = false;
    };
  }, [auditId, version, fetchImpl, attempt]);

  const select = (urlPath: string) => {
    setSelectedPath(urlPath);
    if (wanted.current === urlPath && content.status !== 'error') return;
    wanted.current = urlPath;
    setContent({ status: 'loading', urlPath });
    void getPageContent(auditId, urlPath, version, fetchImpl).then((outcome) => {
      if (wanted.current !== urlPath) return;
      setContent(
        outcome.ok
          ? { status: 'loaded', urlPath, content: outcome.reply.content }
          : { status: 'error', urlPath, message: outcome.error }
      );
    });
  };

  return (
    <AnalysisView
      load={load}
      selectedPath={selectedPath}
      content={content}
      onSelect={select}
      auditId={auditId}
      onRetry={() => setAttempt((n) => n + 1)}
      isHelper={isHelper}
    />
  );
}
