import { useEffect, useRef, useState } from 'react';
import type { RunSummary } from '@qa/types';
import {
  checkReachable,
  estimateAi,
  RunnerError,
  type AiEstimate,
  type AiSetup,
  type RunnerStatus,
  type SiteFacts,
  type WaitingPlan,
} from '../api';
import { KeyField } from '../components/KeyField';
import { ErrorMessage, Notice, Question, Spinner } from '../components/text';
import { rejectReason } from '../lib/context';
import { clampMaxPages, EMPTY_SIGN_IN, MAX_PAGES_LIMIT, type CheckupForm } from '../lib/form';
import { formatWhen } from '../lib/format';
import { Link, PATHS } from '../lib/router';
import { useDocumentTitle } from '../lib/title';
import { hostOf, normalizeUrl } from '../lib/url';

/** What the address check found, for the address as it is now. */
type AddressCheck =
  | { state: 'empty' }
  | { state: 'invalid'; reason: string }
  | { state: 'checking'; url: string }
  | { state: 'ok'; url: string; facts: SiteFacts }
  | { state: 'unreachable'; url: string; reason: string; suggestion?: string; facts: SiteFacts };

/** What starting needs from the address check. */
export interface StartFacts {
  url: string;
  /** Sent only when the address looks live, so the runner remembers the person's answer. */
  stagingHost?: boolean;
  /** Sent only when the person chose, so the runner remembers it for the site. */
  searchChecks?: boolean;
  visibility?: { search: boolean; answers: boolean; aiSearch: boolean; marketing: boolean };
  /** True when there is no AI key: no AI is used and fixed rules write the plan, so a first scan needs no setup. */
  noAI?: boolean;
}

const CHECK_DELAY_MS = 600;

/** The runner's own site facts decide whether the address is a Test Copy; the person can mark a live-looking one. */
function testCopyOf(facts: SiteFacts, form: CheckupForm): { natural: boolean; showMark: boolean; isTestCopy: boolean } {
  const natural = !!facts.testCopy && !facts.remembered?.markedTestCopy;
  return { natural, showMark: !natural, isTestCopy: natural || form.markedTestCopy };
}

export function NewCheckupScreen({
  ai,
  onKeySaved,
  form,
  onFormChange,
  onStart,
  starting,
  startError,
  inProgress,
  recent,
  waitingPlans = [],
  onResumePlan,
  shared = false,
  busy = false,
}: {
  /** null while it's being read. */
  ai: AiSetup | null;
  onKeySaved: (model: string) => void;
  form: CheckupForm;
  onFormChange: (update: (form: CheckupForm) => CheckupForm) => void;
  onStart: (facts: StartFacts) => void;
  starting: boolean;
  startError: string | null;
  /** The runner's state, when a check-up is in progress: shown as a Resume card. */
  inProgress: RunnerStatus | null;
  recent: RunSummary[] | null;
  /** Plans kept aside for other sites, each waiting for review. */
  waitingPlans?: WaitingPlan[];
  onResumePlan?: (host: string) => void;
  /** This is the free shared copy: everyone shares one server, but each visitor sees only their own check-ups. */
  shared?: boolean;
  /** Someone else's check-up is running on the shared copy, so a new one has to wait. */
  busy?: boolean;
}) {
  useDocumentTitle('New check-up');
  const [check, setCheck] = useState<AddressCheck>({ state: 'empty' });
  const [recheck, setRecheck] = useState(0);
  const latest = useRef(0);
  const keyReady = !!ai?.configured;
  const [keyJustSaved, setKeyJustSaved] = useState(false);
  const [maxPagesText, setMaxPagesText] = useState(String(form.maxPages));
  useEffect(() => setMaxPagesText(String(form.maxPages)), [form.maxPages]);

  // The address is checked a moment after typing stops, like the key.
  useEffect(() => {
    const typed = form.address.trim();
    if (!typed) {
      setCheck({ state: 'empty' });
      return;
    }
    const normal = normalizeUrl(typed);
    const id = ++latest.current;
    if (!normal.ok) {
      const timer = setTimeout(
        () => id === latest.current && setCheck({ state: 'invalid', reason: normal.reason }),
        CHECK_DELAY_MS
      );
      return () => clearTimeout(timer);
    }
    setCheck({ state: 'checking', url: normal.url });
    const timer = setTimeout(async () => {
      try {
        const result = await checkReachable(normal.url);
        if (id !== latest.current) return;
        const facts: SiteFacts = { host: result.host, testCopy: result.testCopy, remembered: result.remembered };
        setCheck(
          result.ok
            ? { state: 'ok', url: normal.url, facts }
            : { state: 'unreachable', url: normal.url, reason: result.reason, suggestion: result.suggestion, facts }
        );
      } catch (err) {
        if (id !== latest.current) return;
        setCheck({
          state: 'unreachable',
          url: normal.url,
          reason: err instanceof RunnerError ? err.message : 'The address couldn’t be checked. Try again.',
          facts: {},
        });
      }
    }, CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [form.address, recheck]);

  // A site checked before starts from the choices made for it last time; a new one starts unticked.
  const checkedHost =
    check.state === 'ok' || check.state === 'unreachable' ? (check.facts.host ?? hostOf(check.url)) : null;
  const remembered = check.state === 'ok' || check.state === 'unreachable' ? check.facts.remembered : undefined;
  useEffect(() => {
    if (!checkedHost) return;
    onFormChange((f) =>
      f.choicesFor === checkedHost
        ? f
        : {
            ...f,
            owner: remembered?.owner ?? false,
            markedTestCopy: remembered?.markedTestCopy ?? false,
            searchChecks: remembered?.searchChecks ?? null,
            // Another site's sign-ins don't carry over.
            signIns: f.choicesFor ? [] : f.signIns,
            choicesFor: checkedHost,
          }
    );
  }, [checkedHost, remembered?.owner, remembered?.markedTestCopy, remembered?.searchChecks, onFormChange]);

  const hostNow = (() => {
    const normal = normalizeUrl(form.address);
    return normal.ok ? hostOf(normal.url) : null;
  })();
  const setChoice = (change: Partial<Pick<CheckupForm, 'owner' | 'markedTestCopy'>>) =>
    onFormChange((f) => ({ ...f, ...change, choicesFor: hostNow ?? f.choicesFor }));

  const [confirmedProd, setConfirmedProd] = useState(false);
  useEffect(() => {
    setConfirmedProd(false);
  }, [form.address]);

  const kind = check.state === 'ok' ? testCopyOf(check.facts, form) : null;
  // Search is checked on a live site and not on a test copy, unless the person says otherwise.
  const searchChecksOn = form.searchChecks ?? !(kind?.isTestCopy && form.owner);
  const visibilityOn = form.visibility ?? {
    search: searchChecksOn,
    answers: searchChecksOn,
    aiSearch: searchChecksOn,
    marketing: searchChecksOn,
  };

  const hasStagingIndicator =
    !!kind?.natural ||
    /(?:^|\.)(staging|stg|dev|test|preview|qa|uat)(?:\.|$)/i.test(checkedHost || '') ||
    /(?:-|\.)(staging|dev|test|preview)(?:\.|$)/i.test(checkedHost || '') ||
    /\.(vercel\.app|netlify\.app|fly\.dev|railway\.app|onrender\.com)$/i.test(checkedHost || '');

  const needsProdConfirmation =
    !!kind && !kind.natural && form.markedTestCopy && !hasStagingIndicator && !confirmedProd;
  // No key doesn't stop a scan: fixed rules write the plan, and the AI can be connected any time.
  // (Once the AI setup has been read, so the plan knows which way to go.)
  const canStart = ai !== null && check.state === 'ok' && !starting && !needsProdConfirmation;
  const start = () => {
    if (check.state !== 'ok' || !kind || !canStart) return;
    onStart({
      url: check.url,
      stagingHost: kind.showMark ? form.markedTestCopy : undefined,
      searchChecks: searchChecksOn,
      visibility: searchChecksOn ? visibilityOn : { search: false, answers: false, aiSearch: false, marketing: false },
      noAI: ai && !keyReady ? true : undefined,
    });
  };

  const added = [form.specs, form.designNotes, form.journeys].filter((t) => t.trim()).length;

  return (
    <div className="mx-auto max-w-[44rem] px-4 py-10 sm:px-6 sm:py-14">
      {inProgress && <ResumeCard status={inProgress} />}
      {waitingPlans.length > 0 && (
        <aside
          aria-label="Plans waiting for review"
          className="mb-10 space-y-2 rounded-lg border-2 border-edge bg-surface px-5 py-4"
        >
          <p className="font-bold text-ink">
            {waitingPlans.length === 1
              ? 'A plan is also waiting for your review'
              : 'Plans are also waiting for your review'}
          </p>
          <ul className="space-y-1">
            {waitingPlans.map((w) => (
              <li key={w.host} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-ink">
                  <span className="font-bold">{w.host}</span>{' '}
                  <span className="text-sm text-ink-soft">
                    · {w.pages} pages · scanned {formatWhen(w.discoveredAt)}
                  </span>
                </span>
                <button type="button" className="btn-link" onClick={() => onResumePlan?.(w.host)}>
                  Open this plan
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <Question>Enter the address of the site to check</Question>
      <p className="mb-8 max-w-prose text-ink-soft">
        The site is scanned and a test plan is written for you to review. Nothing is tested until you approve the plan.
      </p>

      {shared && (
        <div className="mb-8">
          <Notice tone="warn" title="This is a shared copy">
            <p>
              Other people use this copy too, but you only see your own check-ups and reports. They share one server, so
              only one check-up runs at a time. Only public sites can be checked.
            </p>
            {busy && (
              <p className="mt-2 font-bold">
                Someone else’s check-up is running right now. Yours can start when it finishes: try again in a few
                minutes.
              </p>
            )}
          </Notice>
        </div>
      )}

      {ai && !keyReady && (
        <section aria-labelledby="key-title" className="mb-8 rounded-lg border-2 border-stamp bg-surface p-5">
          <h2 id="key-title" className="mb-1 text-xl font-bold">
            Connect the AI for a smarter plan
          </h2>
          <p className="mb-4 text-sm text-ink-soft">
            Optional. Without it, fixed rules write the test plan and you can scan now. With it, the AI writes a plan
            that fits your site. It runs on OpenRouter’s free models, so it costs nothing. You only do this once, and
            anything you type below is kept.
          </p>
          <KeyField
            onSaved={(model) => {
              setKeyJustSaved(true);
              onKeySaved(model);
            }}
          />
        </section>
      )}
      {keyJustSaved && keyReady && (
        <div className="mb-6">
          <Notice tone="pass" title="The AI is connected.">
            You can change the key any time in Settings.
          </Notice>
        </div>
      )}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (check.state === 'ok') start();
          else setRecheck((n) => n + 1);
        }}
      >
        <label htmlFor="url-input" className="label">
          Site address
        </label>
        <input
          id="url-input"
          type="text"
          autoFocus
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          className="field h-14 text-lg"
          placeholder="shop.example.com or localhost:3050"
          value={form.address}
          onChange={(e) => onFormChange((f) => ({ ...f, address: e.target.value }))}
          aria-describedby="url-status"
          aria-invalid={check.state === 'invalid' || check.state === 'unreachable'}
        />
        <div id="url-status" role="status" className="mt-2 min-h-[1.6em] text-sm">
          {check.state === 'checking' && <Spinner label="Checking the address…" />}
          {check.state === 'invalid' && <span className="text-fail">{check.reason}</span>}
          {check.state === 'ok' && kind && (
            <span className="block space-y-0.5">
              <span className="block text-ink-soft">
                <span className="font-bold text-pass">✓ Found</span>{' '}
                <span className="break-all font-mono text-ink">{check.url}</span>
              </span>
              <span className="block font-bold text-ink">
                {kind.isTestCopy && form.owner
                  ? 'Test copy: forms can be filled in and sent.'
                  : kind.isTestCopy
                    ? 'Only looked at, nothing is sent or changed. Choose “Test it fully” below to fill in and send forms.'
                    : 'Live site: only looked at, nothing is sent or changed.'}
              </span>
            </span>
          )}
        </div>
        {check.state === 'unreachable' && (
          <ErrorMessage>
            <span className="block font-bold">{check.reason}</span>
            {check.suggestion && <span className="block text-ink">{check.suggestion}</span>}
            <button type="button" className="btn-link mt-1 text-sm" onClick={() => setRecheck((n) => n + 1)}>
              Check again
            </button>
          </ErrorMessage>
        )}

        {kind && <AccessChoice isTestCopyHost={kind.natural} form={form} onChange={setChoice} />}

        {needsProdConfirmation && (
          <div className="mt-4">
            <Notice tone="warn" title="This appears to be a live production site">
              <p>
                The address doesn’t match typical staging or dev indicators. Form submissions and state-changing actions
                will be muted unless confirmed.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn-quiet rounded-control border border-stamp/50 px-3 py-1.5 text-xs font-bold text-stamp hover:text-stamp-dark"
                  onClick={() => setConfirmedProd(true)}
                >
                  ✓ I confirm this is safe to test
                </button>
                <button
                  type="button"
                  className="text-xs text-ink-soft hover:underline"
                  onClick={() => setChoice({ owner: true, markedTestCopy: false })}
                >
                  Switch to safe inspection mode
                </button>
              </div>
            </Notice>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <label htmlFor="max-pages">Explore up to</label>
          <input
            id="max-pages"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_PAGES_LIMIT}
            className="field w-24 py-1.5 text-sm"
            value={maxPagesText}
            // The number is kept as typed, so it can be cleared and retyped; it's checked on leaving the box.
            onChange={(e) => setMaxPagesText(e.target.value)}
            onBlur={() => {
              const n = clampMaxPages(maxPagesText);
              setMaxPagesText(String(n));
              onFormChange((f) => ({ ...f, maxPages: n }));
            }}
            aria-describedby="max-pages-hint"
          />
          <span>pages</span>
          <span id="max-pages-hint" className="basis-full text-ink-soft">
            Pages that share a layout are tested through a few samples, so big sites stay quick.
          </span>
        </div>

        <SignInsSection form={form} saved={remembered?.signIns} onFormChange={onFormChange} />

        {kind && (
          <div className="mt-4 rounded-lg border border-edge bg-surface p-4">
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 accent-[#6C9BF2]"
                checked={searchChecksOn}
                onChange={(e) => {
                  const on = e.target.checked;
                  onFormChange((f) => ({
                    ...f,
                    searchChecks: on,
                    visibility: { search: on, answers: on, aiSearch: on, marketing: on },
                  }));
                }}
              />
              <span className="flex-1">
                <span className="block font-bold text-ink">Check how search engines and AI find the site</span>
                <span className="block text-xs font-medium text-ink-soft">
                  Search (SEO) · AI answers (AEO) · AI search (GEO) · Marketing (MKT)
                </span>
                <span className="mt-1 block text-xs text-ink-soft">
                  {kind.isTestCopy && form.owner
                    ? 'Off by default for local test copies, but you can turn it on anytime to audit SEO, AI discovery, and Marketing.'
                    : 'Audits search engine tags, AI assistant schemas, crawler access, and marketing readiness.'}
                </span>
              </span>
            </label>

            {searchChecksOn && (
              <details className="mt-3 border-t border-rule pt-3 text-sm" open>
                <summary className="cursor-pointer text-xs font-semibold text-accent hover:underline">
                  Choose which to check
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-start gap-2.5 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[#6C9BF2]"
                      checked={visibilityOn.search}
                      onChange={(e) => {
                        const next = { ...visibilityOn, search: e.target.checked };
                        onFormChange((f) => ({
                          ...f,
                          searchChecks: next.search || next.answers || next.aiSearch || next.marketing,
                          visibility: next,
                        }));
                      }}
                    />
                    <div>
                      <span className="font-semibold text-ink">Search (SEO)</span>
                      <span className="block text-ink-soft">
                        Titles, descriptions, headings, canonical, robots & sitemap
                      </span>
                    </div>
                  </label>

                  <label className="flex cursor-pointer items-start gap-2.5 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[#6C9BF2]"
                      checked={visibilityOn.answers}
                      onChange={(e) => {
                        const next = { ...visibilityOn, answers: e.target.checked };
                        onFormChange((f) => ({
                          ...f,
                          searchChecks: next.search || next.answers || next.aiSearch || next.marketing,
                          visibility: next,
                        }));
                      }}
                    />
                    <div>
                      <span className="font-semibold text-ink">AI answers (AEO)</span>
                      <span className="block text-ink-soft">FAQPage, HowTo, Organization JSON-LD markup</span>
                    </div>
                  </label>

                  <label className="flex cursor-pointer items-start gap-2.5 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[#6C9BF2]"
                      checked={visibilityOn.aiSearch}
                      onChange={(e) => {
                        const next = { ...visibilityOn, aiSearch: e.target.checked };
                        onFormChange((f) => ({
                          ...f,
                          searchChecks: next.search || next.answers || next.aiSearch || next.marketing,
                          visibility: next,
                        }));
                      }}
                    />
                    <div>
                      <span className="font-semibold text-ink">AI search (GEO)</span>
                      <span className="block text-ink-soft">llms.txt, AI crawlers (GPTBot, ClaudeBot), citations</span>
                    </div>
                  </label>

                  <label className="flex cursor-pointer items-start gap-2.5 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[#6C9BF2]"
                      checked={visibilityOn.marketing}
                      onChange={(e) => {
                        const next = { ...visibilityOn, marketing: e.target.checked };
                        onFormChange((f) => ({
                          ...f,
                          searchChecks: next.search || next.answers || next.aiSearch || next.marketing,
                          visibility: next,
                        }));
                      }}
                    />
                    <div>
                      <span className="font-semibold text-ink">Marketing (MKT)</span>
                      <span className="block text-ink-soft">
                        Share previews, picture, call to action, contact & privacy
                      </span>
                    </div>
                  </label>
                </div>
              </details>
            )}
          </div>
        )}

        <details className="mt-6 rounded-lg border-2 border-edge bg-surface" open={added > 0 || undefined}>
          <summary className="flex min-h-[48px] cursor-pointer flex-wrap items-center gap-x-2 px-4 py-3 font-bold">
            Add specs, design notes or journeys
            <span className="font-normal text-ink-soft">(optional)</span>
            {added > 0 && <span className="rounded border border-pass px-1.5 text-xs text-pass">Added</span>}
          </summary>
          <div className="space-y-5 border-t border-rule p-4">
            <p className="text-sm text-ink-soft">
              The AI plans with these, so the plan tests what the site is meant to do.
            </p>
            <MaterialField
              id="specs"
              label="Specs"
              hint="Requirements, user stories or acceptance criteria."
              placeholder={
                'For example:\n- Only managers can see reports\n- A new invoice needs a client name and an amount above zero'
              }
              value={form.specs}
              onChange={(value) => onFormChange((f) => ({ ...f, specs: value }))}
            />
            <MaterialField
              id="design-notes"
              label="Design notes"
              hint="Colours, type and layout rules the site should follow."
              placeholder={'For example:\n- The main colour is #2E6BFF\n- Nothing scrolls sideways on a phone'}
              value={form.designNotes}
              onChange={(value) => onFormChange((f) => ({ ...f, designNotes: value }))}
            />
            <MaterialField
              id="journeys"
              label="Journeys to test"
              hint="Things people do across pages that matter most."
              placeholder={'For example:\nSign in as a manager, open Reports and check the open invoices are listed.'}
              value={form.journeys}
              onChange={(value) => onFormChange((f) => ({ ...f, journeys: value }))}
            />
          </div>
        </details>

        {keyReady && check.state === 'ok' && (
          <AiEstimateLine url={check.url} maxPages={form.maxPages} form={form} onFormChange={onFormChange} />
        )}

        {startError && <ErrorMessage>{startError}</ErrorMessage>}

        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="submit" className="btn-primary px-8" disabled={starting} aria-describedby="start-hint">
            {starting ? <Spinner label="Starting…" /> : 'Scan the site'}
          </button>
          <p id="start-hint" className="text-sm text-ink-soft">
            {ai && !keyReady
              ? 'No AI key yet, so fixed rules will write the plan. Nothing is tested until you approve it.'
              : 'Nothing is tested until you approve the plan.'}
          </p>
        </div>
      </form>

      {recent && recent.length > 0 && (
        <section aria-labelledby="recent-title" className="mt-14">
          <h2 id="recent-title" className="mb-3 text-lg font-bold">
            Recent check-ups
          </h2>
          <ul className="divide-y divide-rule rounded-lg border border-rule bg-surface/60">
            {recent.slice(0, 5).map((run) => (
              <li key={run.runId}>
                <Link
                  to={PATHS.report(run.runId)}
                  className="flex min-h-[48px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 hover:bg-surface"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-bold text-ink">{run.host}</span>
                    <span className="block text-sm text-ink-soft">{formatWhen(run.timestamp)}</span>
                  </span>
                  <span className={`text-sm font-bold ${run.ready ? 'text-pass' : 'text-fail'}`}>{run.stamp}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link to={PATHS.reports} className="btn-link mt-2 text-sm">
            See all past check-ups
          </Link>
        </section>
      )}
    </div>
  );
}

/** "Your check-up of shop.example.com is waiting for your review → Open the plan". */
function ResumeCard({ status }: { status: RunnerStatus }) {
  const host = status.targetUrl ? hostOf(status.targetUrl) : 'your site';
  const card =
    status.phase === 'scanning'
      ? { text: `Your check-up of ${host} is scanning the site.`, to: PATHS.scan, action: 'Watch the scan' }
      : status.phase === 'awaiting-review'
        ? { text: `Your check-up of ${host} is waiting for your review.`, to: PATHS.plan, action: 'Open the plan' }
        : status.phase === 'testing'
          ? { text: `Your check-up of ${host} is being tested.`, to: PATHS.testing, action: 'Watch the testing' }
          : null;
  if (!card) return null;
  return (
    <aside
      data-transient="true"
      aria-label="Check-up in progress"
      className="mb-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-stamp bg-stamp-tint px-5 py-4"
    >
      <p className="font-bold text-ink">{card.text}</p>
      <Link to={card.to} className="btn-primary">
        {card.action} <span aria-hidden="true">→</span>
      </Link>
    </aside>
  );
}

/** A text box for reference material, with a file to add to it. */
function MaterialField({
  id,
  label,
  hint,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [fileError, setFileError] = useState<string | null>(null);
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={id} className="font-bold">
          {label}
        </label>
        <label className="cursor-pointer text-sm font-bold text-stamp underline underline-offset-4 hover:text-stamp-dark focus-within:outline focus-within:outline-2 focus-within:outline-stamp">
          Add a file
          <input
            type="file"
            accept=".md,.markdown,.txt"
            className="hidden"
            aria-label={`Add a file to ${label}`}
            onChange={async (e) => {
              const input = e.currentTarget;
              const file = input.files?.[0];
              input.value = '';
              if (!file) return;
              const reason = rejectReason(file.name, file.size);
              if (reason) {
                setFileError(reason);
                return;
              }
              setFileError(null);
              const text = await file.text();
              onChange(value.trim() ? `${value.trim()}\n\n${text}` : text);
            }}
          />
        </label>
      </div>
      <p id={`${id}-hint`} className="mb-2 text-sm text-ink-soft">
        {hint}
      </p>
      <textarea
        id={id}
        rows={4}
        className="field text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-hint`}
      />
      {fileError && (
        <p role="alert" className="mt-1 text-sm text-fail">
          {fileError}
        </p>
      )}
    </div>
  );
}

type Access = 'look' | 'live' | 'test';

/**
 * One question for what the check-up may do. On an address that is a test copy by nature (this
 * computer, a private network), two answers; on a live-looking one, three.
 */
function AccessChoice({
  isTestCopyHost,
  form,
  onChange,
}: {
  isTestCopyHost: boolean;
  form: CheckupForm;
  onChange: (change: Partial<Pick<CheckupForm, 'owner' | 'markedTestCopy'>>) => void;
}) {
  const access: Access = !form.owner ? 'look' : isTestCopyHost || form.markedTestCopy ? 'test' : 'live';
  const options: Array<{
    id: Access;
    title: string;
    hint: string;
    set: Partial<Pick<CheckupForm, 'owner' | 'markedTestCopy'>>;
  }> = isTestCopyHost
    ? [
        { id: 'look', title: 'Only look at it', hint: 'Nothing is filled in, sent or changed.', set: { owner: false } },
        {
          id: 'test',
          title: 'Test it fully: it’s my test copy',
          hint: 'Forms are filled in and sent, as a person would. Nothing is deleted or paid for.',
          set: { owner: true },
        },
      ]
    : [
        {
          id: 'look',
          title: 'Only look at it',
          hint: 'Someone else’s site, or you’re not sure. Nothing is sent or changed.',
          set: { owner: false, markedTestCopy: false },
        },
        {
          id: 'live',
          title: 'It’s my live site: only look at it',
          hint: 'Nothing is sent or changed on the real site.',
          set: { owner: true, markedTestCopy: false },
        },
        {
          id: 'test',
          title: 'It’s a test copy I’m allowed to test fully',
          hint: 'A copy that’s safe to fill in and send forms on, such as a staging site.',
          set: { owner: true, markedTestCopy: true },
        },
      ];
  return (
    <fieldset className="mt-6 space-y-3">
      <legend className="label">What may the check-up do?</legend>
      {options.map((o) => (
        <label
          key={o.id}
          className="flex cursor-pointer items-start gap-3 rounded-lg border-2 border-edge bg-surface p-4 hover:border-stamp"
        >
          <input
            type="radio"
            name="access"
            className="mt-1 h-5 w-5 shrink-0 accent-[#6C9BF2]"
            checked={access === o.id}
            onChange={() => onChange(o.set)}
            aria-describedby={`access-${o.id}-hint`}
          />
          <span>
            <span className="block font-bold">{o.title}</span>
            <span id={`access-${o.id}-hint`} className="block text-sm text-ink-soft">
              {o.hint}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Sign-ins to explore and test the signed-in pages with, from the start: one or more roles. */
function SignInsSection({
  form,
  saved,
  onFormChange,
}: {
  form: CheckupForm;
  saved?: Array<{ role: string; username: string }>;
  onFormChange: (update: (form: CheckupForm) => CheckupForm) => void;
}) {
  const filled = form.signIns.filter((s) => s.username.trim()).length;
  const usingSaved = !!saved?.length && form.useSavedSignIns && form.signIns.length === 0;
  const set = (i: number, change: Partial<CheckupForm['signIns'][number]>) =>
    onFormChange((f) => ({ ...f, signIns: f.signIns.map((s, n) => (n === i ? { ...s, ...change } : s)) }));
  return (
    <details className="mt-6 rounded-lg border-2 border-edge bg-surface" open={filled > 0 || undefined}>
      <summary className="flex min-h-[48px] cursor-pointer flex-wrap items-center gap-x-2 px-4 py-3 font-bold">
        Test signed-in pages
        <span className="font-normal text-ink-soft">(optional)</span>
        {(filled > 0 || usingSaved) && (
          <span className="rounded border border-pass px-1.5 text-xs text-pass">{usingSaved ? 'Saved' : 'Added'}</span>
        )}
      </summary>
      <div className="space-y-4 border-t border-rule p-4">
        <p className="text-sm text-ink-soft">
          The scan signs in as each role and explores what it sees, so pages behind the sign-in are planned and tested
          too.
        </p>
        {!!saved?.length && (
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[#6C9BF2]"
              checked={form.useSavedSignIns}
              onChange={(e) => onFormChange((f) => ({ ...f, useSavedSignIns: e.target.checked }))}
            />
            <span>Sign in as saved for this site: {saved.map((s) => `${s.role} (${s.username})`).join(', ')}</span>
          </label>
        )}
        {form.signIns.map((s, i) => (
          <fieldset key={i} className="grid gap-3 rounded-md border border-rule p-3 sm:grid-cols-2">
            <legend className="px-1 text-sm font-bold">Sign-in {i + 1}</legend>
            <label className="text-sm">
              <span className="mb-1 block font-bold">Role name</span>
              <input
                className="field py-2 text-sm"
                value={s.role}
                placeholder={i === 0 ? 'member' : 'admin'}
                onChange={(e) => set(i, { role: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">Sign-in page (optional)</span>
              <input
                className="field py-2 text-sm"
                value={s.loginPath}
                placeholder="/login"
                onChange={(e) => set(i, { loginPath: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">Email or username</span>
              <input
                className="field py-2 text-sm"
                autoComplete="off"
                value={s.username}
                onChange={(e) => set(i, { username: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">Password</span>
              <input
                className="field py-2 text-sm"
                type="password"
                autoComplete="off"
                value={s.password}
                onChange={(e) => set(i, { password: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="btn-link justify-self-start text-sm"
              onClick={() => onFormChange((f) => ({ ...f, signIns: f.signIns.filter((_, n) => n !== i) }))}
            >
              Remove this sign-in
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="btn-quiet"
          onClick={() => onFormChange((f) => ({ ...f, signIns: [...f.signIns, { ...EMPTY_SIGN_IN }] }))}
        >
          {form.signIns.length === 0 ? 'Add a sign-in' : 'Add another sign-in'}
        </button>
        {form.signIns.length > 0 && (
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[#6C9BF2]"
              checked={form.rememberSignIns}
              onChange={(e) => onFormChange((f) => ({ ...f, rememberSignIns: e.target.checked }))}
            />
            <span>Remember these sign-ins for this site (passwords are kept in this computer’s keychain)</span>
          </label>
        )}
      </div>
    </details>
  );
}

/**
 * About how many AI requests the scan needs, against what's left today, said before it starts; with
 * the choice to plan with fixed rules now and re-plan with the AI later.
 */
function AiEstimateLine({
  url,
  maxPages,
  form,
  onFormChange,
}: {
  url: string;
  maxPages: number;
  form: CheckupForm;
  onFormChange: (update: (form: CheckupForm) => CheckupForm) => void;
}) {
  const [estimate, setEstimate] = useState<AiEstimate | null>(null);
  useEffect(() => {
    let cancelled = false;
    setEstimate(null);
    const timer = setTimeout(() => {
      void estimateAi(url, maxPages).then((e) => !cancelled && setEstimate(e));
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url, maxPages]);
  if (!estimate) return null;
  const needed = estimate.low === estimate.high ? `${estimate.low}` : `${estimate.low} to ${estimate.high}`;
  const short = estimate.left !== null && estimate.left < estimate.high;
  const leftText =
    estimate.left !== null
      ? `You have ${estimate.left} left today${estimate.limit !== null ? ` of ${estimate.limit}` : ''}.`
      : estimate.free
        ? ''
        : 'Your AI account is charged for them.';
  return (
    <div
      className={`mt-6 rounded-md border-l-4 px-4 py-3 text-sm ${short ? 'border-warn bg-warn-tint' : 'border-rule bg-surface'}`}
      role="status"
    >
      <p className="text-ink">
        Planning needs about {needed} AI requests{estimate.seenBefore ? ' (fewer where the site hasn’t changed)' : ''},
        and looking over the screens afterwards up to {estimate.visualReview} more. {leftText}
      </p>
      {short && (
        <p className="mt-1 text-ink">
          Past that, fixed rules plan the rest. You can re-plan any part with the AI once requests are available again.
        </p>
      )}
      <label className="mt-2 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0 accent-[#6C9BF2]"
          checked={form.planWithoutAI}
          onChange={(e) => onFormChange((f) => ({ ...f, planWithoutAI: e.target.checked }))}
        />
        <span>Plan with fixed rules now, using no AI requests, and re-plan with the AI later</span>
      </label>
    </div>
  );
}
