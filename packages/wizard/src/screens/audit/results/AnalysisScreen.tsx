import { useEffect, useRef, useState } from 'react';
import type { AuditGetReply, AuditPage, PageContent, RouteSkipReason } from '@qa/types/src/browser.js';
import { FindingsList } from './FindingsList';
import { HierarchyView } from './HierarchyView';
import { PageContentView } from './PageContentView';
import { PageFactsView } from './PageFactsView';
import { getAuditResult, getPageContent } from './analysis-client';
import { titleText } from './analysis-text';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type AnalysisLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; reply: AuditGetReply };

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
}

const CARD = 'mt-8';
const NOTICE = 'mt-6 max-w-prose rounded-md border-l-4 border-stamp bg-panel px-4 py-3 text-ink';
const ERROR = 'mt-6 max-w-prose rounded-md border-l-4 border-fail bg-fail-tint px-4 py-3 text-fail';

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
                    className={`w-full rounded-md border px-3 py-2 text-left ${
                      selected ? 'border-stamp bg-panel' : 'border-edge'
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
    return result.pages.length === 0 ? null : (
      <p className={`${CARD} text-sm text-ink-soft`}>No page is picked yet.</p>
    );
  }
  return (
    <div className={`${CARD} space-y-8`}>
      {page.coverage === 'covered' && (
        <p className={NOTICE}>
          {`${pageCheckText(page)}. Its checks, notes and recommendation come from that Sample Page, which shares its layout.`}
        </p>
      )}
      <PageFactsView page={page} technology={result.technology} signals={result.marketing.signals} />
      {content.status === 'loading' && (
        <p role="status" className="text-sm text-ink-soft">
          {`Loading the Page Content of ${content.urlPath}…`}
        </p>
      )}
      {content.status === 'error' && (
        <p role="alert" className={ERROR}>
          {`The Page Content of ${content.urlPath} could not be loaded. ${content.message}`}
        </p>
      )}
      {content.status === 'loaded' && content.urlPath === page.urlPath && (
        <PageContentView content={content.content} />
      )}
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
export function AnalysisView({ load, selectedPath, content, onSelect }: AnalysisViewProps) {
  return (
    <main className="mx-auto max-w-[64rem] px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="mb-2 break-words text-question font-bold">Website Audit analysis</h1>
      {load.status === 'loading' && (
        <p role="status" className="text-ink-soft">
          Loading the Website Audit…
        </p>
      )}
      {load.status === 'error' && (
        <p role="alert" className={ERROR}>
          {load.message}
        </p>
      )}
      {load.status === 'loaded' && (
        <>
          <p className="break-all text-ink-soft">
            {`${load.reply.version.url} · version ${load.reply.version.version}`}
          </p>
          {load.reply.result === null ? (
            <p role="status" className={NOTICE}>
              {versionStatusText(load.reply)}
            </p>
          ) : (
            <>
              <div className={CARD}>
                <HierarchyView hierarchy={load.reply.result.hierarchy} />
              </div>
              <PageList pages={load.reply.result.pages} selectedPath={selectedPath} onSelect={onSelect} />
              <SkippedPages reply={load.reply} />
              <SelectedPage reply={load.reply} selectedPath={selectedPath} content={content} />
              <div className={CARD}>
                <FindingsList findings={load.reply.result.findings} />
              </div>
            </>
          )}
        </>
      )}
    </main>
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
  }, [auditId, version, fetchImpl]);

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

  return <AnalysisView load={load} selectedPath={selectedPath} content={content} onSelect={select} />;
}
