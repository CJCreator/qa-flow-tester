import { useCallback, useEffect, useState } from 'react';
import type { CompetitorExample, CompetitorPageFacts, CompetitorsState } from '@qa/types/src/browser.js';
import { ErrorMessage, Spinner } from '../../../components/text';
import { crawlCompetitors, discoverCompetitors, loadCompetitors, type Fetch } from './competitors-api';

/** Why "Find similar sites" is disabled without a working AI key. */
export const COMPETITORS_NO_KEY_REASON = 'An AI key is needed to find similar sites. Add one in Settings.';

const PAGE_TYPE_LABEL: Record<string, string> = {
  home: 'Homepage',
  pricing: 'Pricing',
  services: 'Services',
  product: 'Products',
  about: 'About',
  contact: 'Contact',
};

const CONTACT_LABEL: Record<string, string> = {
  phone: 'phone',
  email: 'email',
  whatsapp: 'WhatsApp',
  form: 'contact form',
  address: 'address',
  chat: 'chat',
};

/** One page's facts as short lines: only what was seen on that page. */
export function factLines(page: CompetitorPageFacts | null): string[] {
  if (!page) return ['No such page read'];
  return [
    page.urlPath,
    `${page.sections.length} Sections`,
    page.ctas.length > 0 ? `Calls to action: ${page.ctas.slice(0, 3).join(', ')}` : 'No call to action seen',
    page.trustSignals.length > 0 ? `Trust signals: ${page.trustSignals.join(', ')}` : 'No trust signal seen',
    page.contactOptions.length > 0
      ? `Contact: ${page.contactOptions.map((c) => CONTACT_LABEL[c] ?? c).join(', ')}`
      : 'No contact option seen',
    page.speedMs === null ? 'Speed not measured' : `Arrived in ${page.speedMs} ms`,
  ];
}

export interface CompetitorsViewProps {
  state: CompetitorsState | null;
  busy: 'finding' | 'reading' | null;
  error: string | null;
  aiReady: boolean | null;
  /** Hosts the tool user keeps for the crawl. */
  kept: ReadonlySet<string>;
  onToggle: (host: string) => void;
  onFind: () => void;
  onRead: () => void;
  /** T-418: what each read site shows for each top finding. */
  examples?: CompetitorExample[];
}

/** T-418: the examples grouped by finding, each line citing its site and page. */
export function ExamplesByFinding({ examples }: { examples: readonly CompetitorExample[] }) {
  const byFinding = new Map<string, CompetitorExample[]>();
  for (const e of examples) byFinding.set(e.findingId, [...(byFinding.get(e.findingId) ?? []), e]);
  if (byFinding.size === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="font-semibold">What similar sites show, beside the top findings</h3>
      <p className="text-sm text-ink-soft">Only what was seen on each page; nothing is copied into a variant.</p>
      <ul className="mt-2 space-y-2 text-sm">
        {[...byFinding].map(([findingId, list]) => (
          <li key={findingId}>
            <span className="font-semibold">{findingId}</span>
            <ul className="list-disc pl-5">
              {list.map((e, i) => (
                <li key={i}>{e.text}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The similar-sites panel, without state. */
export function CompetitorsView(props: CompetitorsViewProps) {
  const { state, busy, error, aiReady, kept } = props;
  const noKey = aiReady === false;
  const usable = state?.candidates.filter((c) => c.status === 'ok') ?? [];
  return (
    <section aria-labelledby="competitors-title" className="card-1 bg-surface p-4">
      <h2 id="competitors-title" className="text-xl font-bold">
        Similar sites
      </h2>
      <p className="mt-1 max-w-prose text-sm text-ink-soft">
        The AI names 3 similar public websites (one AI request with your key). Remove any you do not want, then the tool
        reads each homepage and up to 10 key pages: read only, paced, and robots.txt is followed.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <button
          type="button"
          className="btn-quiet"
          disabled={noKey || busy !== null}
          aria-describedby={noKey ? 'competitors-find-reason' : undefined}
          onClick={props.onFind}
        >
          {busy === 'finding' ? <Spinner label="Finding similar sites…" /> : 'Find similar sites'}
        </button>
        {usable.length > 0 && (
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== null || kept.size === 0}
            aria-describedby={kept.size === 0 ? 'competitors-read-reason' : undefined}
            onClick={props.onRead}
          >
            {busy === 'reading' ? <Spinner label="Reading the similar sites…" /> : 'Read the ticked sites'}
          </button>
        )}
      </div>
      {noKey && (
        <p id="competitors-find-reason" className="mt-2 text-sm text-ink-soft">
          {COMPETITORS_NO_KEY_REASON}
        </p>
      )}
      {usable.length > 0 && kept.size === 0 && (
        <p id="competitors-read-reason" className="mt-2 text-sm text-ink-soft">
          Tick at least one site to read.
        </p>
      )}
      {error && (
        <div className="mt-3">
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      )}
      {state && state.candidates.length > 0 && (
        <ul className="mt-4 space-y-2">
          {state.candidates.map((c) => (
            <li key={c.host}>
              {c.status === 'ok' ? (
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={kept.has(c.host)} onChange={() => props.onToggle(c.host)} />
                  <span>
                    <span className="font-semibold">{c.host}</span>
                    {c.reason && <span className="block text-sm text-ink-soft">{c.reason}</span>}
                  </span>
                </label>
              ) : (
                <p>
                  <span className="font-semibold">{c.host}</span>
                  <span className="block text-sm text-ink-soft">{c.refusal}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {state?.sites && state.sites.some((s) => s.status === 'not-read') && (
        <ul className="mt-3 text-sm text-ink-soft">
          {state.sites
            .filter((s) => s.status === 'not-read')
            .map((s) => (
              <li key={s.host}>{`${s.host}: not read. ${s.notReadReason ?? ''}`}</li>
            ))}
        </ul>
      )}
      {state?.comparison && state.comparison.length > 0 && state.sites && (
        <div className="mt-4 overflow-x-auto">
          <table className="text-sm">
            <caption className="text-left font-semibold">Side by side, page by page</caption>
            <thead>
              <tr>
                <th scope="col">Page</th>
                <th scope="col">This site</th>
                {state.sites.map((s) => (
                  <th scope="col" key={s.host}>
                    {s.host}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.comparison.map((row) => (
                <tr key={row.pageType}>
                  <th scope="row">{PAGE_TYPE_LABEL[row.pageType] ?? row.pageType}</th>
                  {[row.audited, ...row.competitors.map((c) => c.page)].map((page, i) => (
                    <td key={i} className="align-top">
                      <ul>
                        {factLines(page).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {props.examples && <ExamplesByFinding examples={props.examples} />}
    </section>
  );
}

export interface CompetitorsPanelProps {
  auditId: string;
  version: number;
  aiReady: boolean | null;
  fetchImpl?: Fetch;
}

/** Similar sites for one version (T-416): started here, never as a pipeline stage. */
export function CompetitorsPanel({ auditId, version, aiReady, fetchImpl }: CompetitorsPanelProps) {
  const [state, setState] = useState<CompetitorsState | null>(null);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'finding' | 'reading' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [examples, setExamples] = useState<CompetitorExample[]>([]);
  const show = useCallback((next: CompetitorsState | null, found: CompetitorExample[] = []) => {
    setExamples(found);
    setState(next);
    const read = next?.sites?.map((s) => s.host);
    setKept(new Set(read ?? next?.candidates.filter((c) => c.status === 'ok').map((c) => c.host) ?? []));
  }, []);

  useEffect(() => {
    let live = true;
    if (version <= 0) return;
    void loadCompetitors(auditId, version, fetchImpl).then((got) => {
      if (!live) return;
      if (got.ok) show(got.value, got.examples);
    });
    return () => {
      live = false;
    };
  }, [auditId, version, fetchImpl, show]);

  const find = async () => {
    setBusy('finding');
    setError(null);
    const got = await discoverCompetitors(auditId, version, fetchImpl);
    setBusy(null);
    if (got.ok) show(got.value, got.examples);
    else setError(got.message);
  };

  const read = async () => {
    setBusy('reading');
    setError(null);
    const got = await crawlCompetitors(auditId, version, [...kept], fetchImpl);
    setBusy(null);
    if (got.ok) show(got.value, got.examples);
    else setError(got.message);
  };

  return (
    <CompetitorsView
      state={state}
      examples={examples}
      busy={busy}
      error={error}
      aiReady={aiReady}
      kept={kept}
      onToggle={(host) =>
        setKept((current) => {
          const next = new Set(current);
          if (next.has(host)) next.delete(host);
          else next.add(host);
          return next;
        })
      }
      onFind={() => void find()}
      onRead={() => void read()}
    />
  );
}
