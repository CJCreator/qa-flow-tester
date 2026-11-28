import { useCallback, useEffect, useState } from 'react';
import {
  AUDIT_API,
  MAX_VARIANTS_PER_PAGE,
  auditPath,
  isRecord,
  type AuditVersion,
  type ImproveBestBody,
  type ImproveBestReply,
  type ImproveCreateBody,
  type ImproveCreateReply,
  type ImproveListReply,
  type ImproveVariant,
} from '@qa/types/src/browser.js';
import { getAiSetup } from '../../../api';
import { ErrorMessage, Notice, Spinner } from '../../../components/text';
import { LoadError, Page, PageHeader } from '../../../components/ui';
import { formatWhen } from '../../../lib/format';
import { Link, PATHS } from '../../../lib/router';
import { useDocumentTitle } from '../../../lib/title';
import { AuditTabs } from '../AuditTabs';
import { BeforeAfter } from './BeforeAfter';
import { callAudit, type AuditOutcome, type Fetch } from '../audit-call';
import { CompetitorsPanel } from './CompetitorsPanel';
import { FixOptionsPanel } from './FixOptionsPanel';
import { CopyVariantsPanel } from './CopyVariantsPanel';
import { loadVersion, versionsOldestFirst } from '../saved/saved-api';
import { SHARE_LANGUAGES, createPreview, languageName, previewUrl, type ShareLanguage } from '../saved/share-api';

/** The homepage panel: idle, being written, written, or refused. */
export type PreviewState =
  | { status: 'idle' }
  | { status: 'making' }
  | { status: 'made'; createdAt: string }
  | { status: 'failed'; message: string; noAiKey: boolean };

/** Why the make buttons are disabled when no AI key works (W20). */
export const NO_AI_KEY_REASON = 'An AI key is needed to make the Improved version. Add one in Settings.';

/** The design variants of one version: loading, refused, or listed. */
export type ImproveState =
  { status: 'loading' } | { status: 'failed'; message: string } | { status: 'loaded'; reply: ImproveListReply };

const REFUSALS = {
  ERR_NO_AI_KEY: NO_AI_KEY_REASON,
  ERR_AUDIT_NOT_FOUND: 'This Website Audit was not found. It may have been deleted.',
  ERR_AUDIT_RUNNING: 'This version of the Website Audit is still running. Try again when it has finished.',
  ERR_FORBIDDEN: 'Only the owner of this copy can make the Improved version: it uses their AI key.',
} as const;

// ---------------------------------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------------------------------

/** `GET /api/audits/:id/improve?version=n`: the pages, the variants made so far and the price of a request. */
export function listImprove(auditId: string, version: number, fetchImpl: Fetch = fetch) {
  return callAudit<ImproveListReply>(
    `${auditPath(AUDIT_API.listImprove.path, { id: auditId })}?version=${encodeURIComponent(String(version))}`,
    { method: AUDIT_API.listImprove.method },
    fetchImpl,
    'The Improved version could not be loaded. Try again.',
    (body) =>
      isRecord(body) && Array.isArray(body.pages) && Array.isArray(body.variants) && isRecord(body.estimate)
        ? (body as unknown as ImproveListReply)
        : null,
    REFUSALS
  );
}

/** `POST /api/audits/:id/improve`: makes pages × variants, one AI request each, or one variant (`only`). */
export function createImprove(
  auditId: string,
  body: ImproveCreateBody,
  fetchImpl: Fetch = fetch
): Promise<AuditOutcome<ImproveCreateReply>> {
  return callAudit<ImproveCreateReply>(
    auditPath(AUDIT_API.createImprove.path, { id: auditId }),
    {
      method: AUDIT_API.createImprove.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    fetchImpl,
    'The design variants could not be made. Try again.',
    (reply) => (isRecord(reply) && Array.isArray(reply.variants) ? (reply as unknown as ImproveCreateReply) : null),
    REFUSALS
  );
}

/** The address of one variant, opened by the browser in a new tab. */
export function variantUrl(auditId: string, version: number, page: string, variant: number): string {
  const path = auditPath(AUDIT_API.getImprove.path, { id: auditId, page, variant: String(variant) });
  return `${path}?version=${encodeURIComponent(String(version))}`;
}

/** What a batch costs before it starts: the AI requests, and dollars when the model's price is known. */
export function costText(pages: number, variants: number, usdPerRequest: number | null): string {
  const requests = pages * variants;
  const count = `${requests} AI ${requests === 1 ? 'request' : 'requests'} (${pages} ${pages === 1 ? 'page' : 'pages'} × ${variants} ${variants === 1 ? 'variant' : 'variants'})`;
  if (usdPerRequest === null) return `${count}, charged to your own AI key. The price of your model is not known.`;
  return `${count}, about $${(requests * usdPerRequest).toFixed(2)} on your own AI key at the model's list price.`;
}

// ---------------------------------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------------------------------

export interface ImprovedVersionViewProps {
  auditId: string;
  /** Finished versions, oldest first. */
  versions: AuditVersion[];
  version: number;
  /** Whether a working AI key is set up; null while unknown. */
  aiReady: boolean | null;
  onVersion: (version: number) => void;
  /** Design variants (ADR 0049). */
  improve: ImproveState;
  /** The page keys ticked. */
  chosen: string[];
  /** Variants per page, 1 to 5. */
  variantCount: number;
  making: boolean;
  message: { tone: 'pass' | 'fail'; text: string } | null;
  onTogglePage: (key: string) => void;
  onVariantCount: (count: number) => void;
  onMakeVariants: () => void;
  /** Makes one variant again: one AI request (T-414). */
  onTryAgain: (page: string, variant: number) => void;
  /** The before/after view (T-415). */
  opened?: OpenedVariant | null;
  onOpen?: (page: string, variant: number) => void;
  onStar?: (page: string, variant: number) => void;
  findingTitles?: Readonly<Record<string, string>>;
  /** The homepage page for a preview Shared Link (REQ-024). */
  language: ShareLanguage;
  preview: PreviewState;
  onLanguage: (language: ShareLanguage) => void;
  onMake: () => void;
}

function readLanguage(value: string): ShareLanguage {
  return (SHARE_LANGUAGES as readonly string[]).includes(value) ? (value as ShareLanguage) : 'en';
}

function NoKeyReason({ id }: { id: string }) {
  return (
    <p id={id} className="mt-2 text-sm text-ink-soft">
      {NO_AI_KEY_REASON}{' '}
      <Link to={PATHS.settings} className="btn-link">
        Open Settings
      </Link>
    </p>
  );
}

/** The variant open in the before/after view, and its page once loaded. */
export interface OpenedVariant {
  page: string;
  variant: number;
  html: string | null;
}

/** The best variant for the Pitch Glimpse: the one starred, else the first that passed the checks (T-415). */
export function bestVariant(reply: ImproveListReply): { page: string; variant: number } | null {
  const starred = reply.best;
  if (
    starred &&
    reply.variants.some((v) => v.page === starred.page && v.variant === starred.variant && variantShown(v))
  )
    return starred;
  const first = reply.variants.find(variantShown);
  return first ? { page: first.page, variant: first.variant } : null;
}

/** `PUT /api/audits/:id/improve-best`: stars one variant as the best. */
export function setBest(auditId: string, body: ImproveBestBody, fetchImpl: Fetch = fetch) {
  return callAudit<ImproveBestReply>(
    auditPath(AUDIT_API.setImproveBest.path, { id: auditId }),
    {
      method: AUDIT_API.setImproveBest.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    fetchImpl,
    'The best variant could not be saved. Try again.',
    (reply) => (isRecord(reply) && isRecord(reply.best) ? (reply as unknown as ImproveBestReply) : null),
    REFUSALS
  );
}

/** The zip of every variant that passed the checks, with a README naming the findings. */
export function improvedZipUrl(auditId: string, version: number): string {
  return `${auditPath(AUDIT_API.exportImproved.path, { id: auditId })}?version=${encodeURIComponent(String(version))}`;
}

/** Whether a variant may be shown: made, and not refused by the quality gate (T-414). */
export function variantShown(v: ImproveVariant): boolean {
  return v.status === 'made' && v.gate?.passed !== false;
}

function VariantList({
  auditId,
  reply,
  busy,
  noKey,
  onTryAgain,
  opened,
  onOpen,
  onStar,
  findingTitles,
}: {
  auditId: string;
  reply: ImproveListReply;
  busy: boolean;
  noKey: boolean;
  onTryAgain: (page: string, variant: number) => void;
  opened: OpenedVariant | null;
  onOpen: (page: string, variant: number) => void;
  onStar: (page: string, variant: number) => void;
  findingTitles?: Readonly<Record<string, string>>;
}) {
  const best = bestVariant(reply);
  const isBest = (v: ImproveVariant) => !!best && best.page === v.page && best.variant === v.variant;
  const isOpen = (v: ImproveVariant) => !!opened && opened.page === v.page && opened.variant === v.variant;
  if (reply.variants.length === 0)
    return <p className="mt-3 text-sm text-ink-soft">No design variant has been made for this version yet.</p>;
  const byPage = new Map<string, ImproveVariant[]>();
  for (const v of reply.variants) byPage.set(v.page, [...(byPage.get(v.page) ?? []), v]);
  return (
    <ul className="mt-4 space-y-4">
      {reply.pages
        .filter((p) => byPage.has(p.key))
        .map((page) => (
          <li key={page.key}>
            <h3 className="font-semibold">
              {page.layoutGroup ? `${page.urlPath} (${page.layoutGroup})` : `${page.urlPath} (homepage)`}
            </h3>
            <ul className="mt-1 space-y-2">
              {byPage.get(page.key)!.map((v) => {
                const reasonId = `variant-${v.page}-${v.variant}-why`;
                return (
                  <li key={v.variant}>
                    {variantShown(v) ? (
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={variantUrl(auditId, reply.version, v.page, v.variant)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-quiet btn-sm"
                            aria-label={`Open variant ${v.variant} (${v.style}) of ${page.urlPath} (opens in a new tab)`}
                          >
                            {`Variant ${v.variant}: ${v.style}`}
                          </a>
                          <button
                            type="button"
                            className="btn-quiet btn-sm"
                            aria-expanded={isOpen(v)}
                            onClick={() => onOpen(v.page, v.variant)}
                          >
                            {isOpen(v) ? 'Hide before and after' : 'Before and after'}
                          </button>
                          <a
                            href={variantUrl(auditId, reply.version, v.page, v.variant)}
                            download={`${v.page}-${v.variant}-${v.style}.html`}
                            className="btn-quiet btn-sm"
                            aria-label={`Download variant ${v.variant} of ${page.urlPath} as HTML`}
                          >
                            Download HTML
                          </a>
                          <span className="inline-flex min-h-[44px] items-center gap-2">
                            <input
                              id={`best-${v.page}-${v.variant}`}
                              type="radio"
                              name="best-variant"
                              checked={isBest(v)}
                              disabled={busy}
                              onChange={() => onStar(v.page, v.variant)}
                              className="h-5 w-5 accent-stamp"
                            />
                            <label htmlFor={`best-${v.page}-${v.variant}`} className="text-sm">
                              Best, for the Pitch Glimpse
                            </label>
                          </span>
                        </div>
                        {isOpen(v) && (
                          <BeforeAfter
                            auditId={auditId}
                            version={reply.version}
                            page={page}
                            variant={v}
                            html={opened?.html ?? null}
                            findingTitles={findingTitles}
                          />
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span id={reasonId} className="text-sm text-ink-soft">
                          {v.status === 'made'
                            ? `Variant ${v.variant} is not shown: ${(v.gate?.reasons ?? []).join(' ')}`
                            : `Variant ${v.variant}: ${v.problem === 'budget-spent' ? 'not made, the AI Request Budget is spent' : 'the AI gave no usable page'}`}
                        </span>
                        <button
                          type="button"
                          className="btn-quiet btn-sm"
                          disabled={busy || noKey}
                          aria-describedby={noKey ? 'variants-make-reason' : reasonId}
                          aria-label={`Try again: variant ${v.variant} of ${page.urlPath}, one AI request`}
                          onClick={() => onTryAgain(v.page, v.variant)}
                        >
                          Try again
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
    </ul>
  );
}

/** The Improved version panels, without state. */
export function ImprovedVersionView(props: ImprovedVersionViewProps) {
  const { auditId, versions, version, preview, aiReady, improve } = props;
  if (versions.length === 0) {
    return (
      <p className="max-w-prose text-ink-soft">
        This Website Audit has no finished version yet. Come back when a version has finished.
      </p>
    );
  }
  const noKey = aiReady === false;
  const making = preview.status === 'making';
  const usd = improve.status === 'loaded' ? improve.reply.estimate.usdPerRequest : null;
  const nothingChosen = props.chosen.length === 0;
  return (
    <div className="space-y-10">
      <div>
        <label htmlFor="improved-version" className="label text-ink">
          Version
        </label>
        <select
          id="improved-version"
          className="field mt-1"
          value={String(version)}
          onChange={(e) => props.onVersion(Number(e.target.value))}
        >
          {versions.map((v) => (
            <option key={v.version} value={v.version}>
              {`Version ${v.version}, ${formatWhen(v.startedAt)}`}
            </option>
          ))}
        </select>
      </div>

      <section aria-labelledby="variants-title" className="card-1 bg-surface p-4">
        <h2 id="variants-title" className="text-xl font-bold">
          Design variants
        </h2>
        <p className="mt-1 max-w-prose text-sm text-ink-soft">
          The AI writes each page again from this version's findings, in a different design direction per variant. It
          keeps the site's menu links, logo and colours, and marks every change with the finding or Section it answers.
          A suggestion for the site owner: nothing on the live site changes.
        </p>
        {improve.status === 'loading' && <Spinner label="Loading the pages…" />}
        {improve.status === 'failed' && <ErrorMessage>{improve.message}</ErrorMessage>}
        {improve.status === 'loaded' && (
          <>
            <fieldset className="mt-4">
              <legend className="label text-ink">Pages</legend>
              <ul className="mt-1 space-y-1">
                {improve.reply.pages.map((page) => (
                  <li key={page.key} className="flex min-h-[44px] items-center gap-2">
                    <input
                      id={`improve-page-${page.key}`}
                      type="checkbox"
                      checked={props.chosen.includes(page.key)}
                      onChange={() => props.onTogglePage(page.key)}
                      className="h-5 w-5 accent-stamp"
                    />
                    <label htmlFor={`improve-page-${page.key}`}>
                      {page.layoutGroup
                        ? `${page.urlPath}, the Sample Page of the Layout Group "${page.layoutGroup}"`
                        : `${page.urlPath}, the homepage`}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="improve-variants" className="label text-ink">
                  Variants per page
                </label>
                <select
                  id="improve-variants"
                  className="field mt-1"
                  value={String(props.variantCount)}
                  onChange={(e) => props.onVariantCount(Number(e.target.value))}
                >
                  {Array.from({ length: MAX_VARIANTS_PER_PAGE }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="btn-primary"
                disabled={noKey || props.making || nothingChosen}
                aria-describedby={
                  noKey ? 'variants-make-reason' : nothingChosen ? 'variants-pick-reason' : 'variants-cost'
                }
                onClick={props.onMakeVariants}
              >
                {props.making ? <Spinner label="Making the design variants…" /> : 'Make the design variants'}
              </button>
            </div>
            <p id="variants-cost" className="mt-2 text-sm font-semibold">
              {costText(props.chosen.length, props.variantCount, usd)}
            </p>
            {noKey && <NoKeyReason id="variants-make-reason" />}
            {!noKey && nothingChosen && (
              <p id="variants-pick-reason" className="mt-2 text-sm text-ink-soft">
                Tick at least one page.
              </p>
            )}
            {props.message &&
              (props.message.tone === 'fail' ? (
                <ErrorMessage>{props.message.text}</ErrorMessage>
              ) : (
                <p role="status" className="mt-3 text-sm font-semibold text-pass">
                  {props.message.text}
                </p>
              ))}
            <VariantList
              auditId={auditId}
              reply={improve.reply}
              busy={props.making}
              noKey={noKey}
              onTryAgain={props.onTryAgain}
              opened={props.opened ?? null}
              onOpen={props.onOpen ?? (() => undefined)}
              onStar={props.onStar ?? (() => undefined)}
              findingTitles={props.findingTitles}
            />
            {improve.reply.variants.some(variantShown) && (
              <p className="mt-4">
                <a href={improvedZipUrl(auditId, improve.reply.version)} className="btn-quiet btn-sm" download>
                  Download every variant that passed (zip)
                </a>
              </p>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="improved-title" className="card-1 bg-surface p-4">
        <h2 id="improved-title" className="text-xl font-bold">
          Improved homepage for a Shared Link
        </h2>
        <p className="mt-1 max-w-prose text-sm text-ink-soft">
          One improved homepage, in the language you pick, that a Shared Link to the improved homepage opens. Nothing on
          the live site changes.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="improved-language" className="label text-ink">
              Language
            </label>
            <select
              id="improved-language"
              className="field mt-1"
              value={props.language}
              onChange={(e) => props.onLanguage(readLanguage(e.target.value))}
            >
              {SHARE_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {languageName(language)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn-quiet"
            disabled={noKey || making}
            aria-describedby={noKey ? 'improved-make-reason' : undefined}
            onClick={props.onMake}
          >
            {making ? <Spinner label="Making the Improved version…" /> : 'Make the Improved version'}
          </button>
          {/* Always a link: a page made in an earlier visit can still be opened. */}
          <a
            href={previewUrl(auditId, version)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-quiet"
            aria-label={`Open the Improved version of version ${version} (opens in a new tab)`}
            aria-describedby={preview.status !== 'made' ? 'improved-open-reason' : undefined}
          >
            Open it
          </a>
        </div>
        {noKey && <NoKeyReason id="improved-make-reason" />}
        {preview.status !== 'made' && (
          <p id="improved-open-reason" className="mt-2 text-sm text-ink-soft">
            Opens the last one made for this version. If there isn’t one yet, make it first.
          </p>
        )}
        {preview.status === 'made' && (
          <p role="status" className="mt-3 text-sm font-semibold text-pass">
            {`The Improved version is ready (${formatWhen(preview.createdAt)}). Open it to check it.`}
          </p>
        )}
        {preview.status === 'failed' && (
          <div className="mt-3">
            {preview.noAiKey ? (
              <Notice
                title="An AI key is needed"
                actions={
                  <Link to={PATHS.settings} className="btn-link">
                    Add an AI key in Settings
                  </Link>
                }
              >
                {preview.message}
              </Notice>
            ) : (
              <ErrorMessage>{preview.message}</ErrorMessage>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------------------------------

export interface ImprovedVersionScreenProps {
  auditId: string;
  /** For tests: the requests. */
  fetchImpl?: Fetch;
  /** For tests: whether an AI key is set up. */
  aiSetup?: () => Promise<{ configured: boolean }>;
}

type Versions =
  { status: 'loading' } | { status: 'failed'; message: string } | { status: 'loaded'; versions: AuditVersion[] };

/** The Improved version of a Website Audit (ADR 0049): the AI-written improved pages of one version. */
export function ImprovedVersionScreen({ auditId, fetchImpl, aiSetup = getAiSetup }: ImprovedVersionScreenProps) {
  const [versions, setVersions] = useState<Versions>({ status: 'loading' });
  const [version, setVersion] = useState(0);
  const [language, setLanguage] = useState<ShareLanguage>('en');
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [improve, setImprove] = useState<ImproveState>({ status: 'loading' });
  const [chosen, setChosen] = useState<string[]>([]);
  const [variantCount, setVariantCount] = useState(3);
  const [making, setMaking] = useState(false);
  const [message, setMessage] = useState<ImprovedVersionViewProps['message']>(null);
  const [opened, setOpened] = useState<OpenedVariant | null>(null);
  const [findingTitles, setFindingTitles] = useState<Record<string, string>>({});
  useDocumentTitle('Improved version');

  useEffect(() => {
    let live = true;
    setVersions({ status: 'loading' });
    void loadVersion(auditId, undefined, fetchImpl).then((loaded) => {
      if (!live) return;
      if (!loaded.ok) return setVersions({ status: 'failed', message: loaded.message });
      const done = versionsOldestFirst(loaded.value.summary).filter((v) => v.status === 'done');
      setVersions({ status: 'loaded', versions: done });
      setVersion((current) =>
        done.some((v) => v.version === current) ? current : (done[done.length - 1]?.version ?? 0)
      );
    });
    return () => {
      live = false;
    };
  }, [auditId, fetchImpl, attempt]);

  useEffect(() => {
    if (version <= 0) return;
    let live = true;
    setImprove({ status: 'loading' });
    void listImprove(auditId, version, fetchImpl).then((outcome) => {
      if (!live) return;
      if (!outcome.ok) return setImprove({ status: 'failed', message: outcome.message });
      setImprove({ status: 'loaded', reply: outcome.value });
      // Every page is ticked to start with; the user unticks the ones not wanted.
      setChosen(outcome.value.pages.map((p) => p.key));
    });
    return () => {
      live = false;
    };
  }, [auditId, version, fetchImpl]);

  // Unknown (a failed read) leaves the buttons on: the runner answers with its own reason.
  useEffect(() => {
    let live = true;
    void aiSetup().then(
      (setup) => live && setAiReady(setup.configured),
      () => undefined
    );
    return () => {
      live = false;
    };
  }, [aiSetup]);

  const make = useCallback(async () => {
    setPreview({ status: 'making' });
    const outcome = await createPreview(auditId, version, language, fetchImpl);
    setPreview(
      outcome.ok
        ? { status: 'made', createdAt: outcome.value.createdAt }
        : { status: 'failed', message: outcome.message, noAiKey: outcome.code === 'ERR_NO_AI_KEY' }
    );
  }, [auditId, version, language, fetchImpl]);

  const makeVariants = useCallback(async () => {
    setMaking(true);
    setMessage(null);
    const outcome = await createImprove(auditId, { version, pages: chosen, variants: variantCount }, fetchImpl);
    if (outcome.ok) {
      const shown = outcome.value.variants.filter(variantShown).length;
      setMessage({
        tone: 'pass',
        text: `${shown} of ${outcome.value.variants.length} design variants were made and passed the checks.`,
      });
      const listed = await listImprove(auditId, version, fetchImpl);
      if (listed.ok) setImprove({ status: 'loaded', reply: listed.value });
    } else {
      setMessage({ tone: 'fail', text: outcome.message });
    }
    setMaking(false);
  }, [auditId, version, chosen, variantCount, fetchImpl]);

  // Finding titles of the version, for the before/after change list.
  useEffect(() => {
    if (version <= 0) return;
    let live = true;
    void loadVersion(auditId, version, fetchImpl).then((loaded) => {
      if (!live || !loaded.ok || !loaded.value.result) return;
      setFindingTitles(Object.fromEntries(loaded.value.result.findings.map((f) => [f.id, f.title])));
    });
    return () => {
      live = false;
    };
  }, [auditId, version, fetchImpl]);

  const open = useCallback(
    async (page: string, variant: number) => {
      if (opened && opened.page === page && opened.variant === variant) return setOpened(null);
      setOpened({ page, variant, html: null });
      try {
        const res = await (fetchImpl ?? fetch)(variantUrl(auditId, version, page, variant));
        const html = res.ok ? await res.text() : '';
        setOpened((current) =>
          current && current.page === page && current.variant === variant ? { page, variant, html } : current
        );
      } catch {
        setOpened((current) => (current && current.page === page ? { page, variant, html: '' } : current));
      }
    },
    [auditId, version, fetchImpl, opened]
  );

  const star = useCallback(
    async (page: string, variant: number) => {
      const outcome = await setBest(auditId, { version, page, variant }, fetchImpl);
      if (!outcome.ok) return setMessage({ tone: 'fail', text: outcome.message });
      setImprove((current) =>
        current.status === 'loaded'
          ? { status: 'loaded', reply: { ...current.reply, best: outcome.value.best } }
          : current
      );
      setMessage({ tone: 'pass', text: `Variant ${variant} of this page goes in the Pitch Glimpse.` });
    },
    [auditId, version, fetchImpl]
  );

  const tryAgain = useCallback(
    async (page: string, variant: number) => {
      setMaking(true);
      setMessage(null);
      const outcome = await createImprove(
        auditId,
        { version, pages: [page], variants: variant, only: variant },
        fetchImpl
      );
      if (outcome.ok) {
        const v = outcome.value.variants[0];
        setMessage(
          v && variantShown(v)
            ? { tone: 'pass', text: `Variant ${variant} was made again and passed the checks.` }
            : { tone: 'fail', text: `Variant ${variant} was made again but still did not pass the checks.` }
        );
        const listed = await listImprove(auditId, version, fetchImpl);
        if (listed.ok) setImprove({ status: 'loaded', reply: listed.value });
      } else {
        setMessage({ tone: 'fail', text: outcome.message });
      }
      setMaking(false);
    },
    [auditId, version, fetchImpl]
  );

  return (
    <Page width="workspace">
      <PageHeader
        back={{ to: PATHS.audit(auditId), label: 'Back to this Website Audit' }}
        title="Improved version"
        lede="AI-written improvements of this Website Audit's pages, each citing the findings it answers. A suggestion for the site owner: the live site never changes."
      />
      <AuditTabs
        auditId={auditId}
        version={version > 0 ? version : undefined}
        current="improved"
        hide={['share', 'helpers']}
      />
      {versions.status === 'loading' && <Spinner label="Loading the Website Audit…" />}
      {versions.status === 'failed' && (
        <LoadError title="The Website Audit could not be loaded" onRetry={() => setAttempt((n) => n + 1)}>
          {versions.message}
        </LoadError>
      )}
      {versions.status === 'loaded' && (
        <ImprovedVersionView
          auditId={auditId}
          versions={versions.versions}
          version={version}
          aiReady={aiReady}
          onVersion={(next) => {
            setVersion(next);
            setPreview({ status: 'idle' });
            setMessage(null);
          }}
          improve={improve}
          chosen={chosen}
          variantCount={variantCount}
          making={making}
          message={message}
          onTogglePage={(key) =>
            setChosen((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]))
          }
          onVariantCount={setVariantCount}
          onMakeVariants={() => void makeVariants()}
          onTryAgain={(page, variant) => void tryAgain(page, variant)}
          opened={opened}
          onOpen={(page, variant) => void open(page, variant)}
          onStar={(page, variant) => void star(page, variant)}
          findingTitles={findingTitles}
          language={language}
          preview={preview}
          onLanguage={setLanguage}
          onMake={() => void make()}
        />
      )}
      {versions.status === 'loaded' && version > 0 && (
        <div className="mt-10 space-y-10">
          <FixOptionsPanel auditId={auditId} version={version} fetchImpl={fetchImpl} />
          <CopyVariantsPanel auditId={auditId} version={version} aiReady={aiReady} fetchImpl={fetchImpl} />
          <CompetitorsPanel auditId={auditId} version={version} aiReady={aiReady} fetchImpl={fetchImpl} />
        </div>
      )}
    </Page>
  );
}
