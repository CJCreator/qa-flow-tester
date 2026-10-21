import { useEffect, useRef, useState } from 'react';
import type { RunSummary } from '@qa/types';
import {
  checkDomainProof,
  checkReachable,
  convertDocx,
  estimateAi,
  plainError,
  type AiEstimate,
  type AiSetup,
  type DomainProofStatus,
  type RunnerStatus,
  type SiteFacts,
  type WaitingPlan,
} from '../api';
import { KeyField } from '../components/KeyField';
import { ErrorMessage, Notice, Question, Spinner } from '../components/text';
import { capLine } from '../lib/cap';
import {
  describeSummary,
  MAX_CONTEXT_FILES,
  readContextFiles,
  readCount,
  rejectReason,
  unreadMessage,
} from '../lib/context';
import { fillRoleRows, parseRoleList } from '../lib/import-roles';
import { parseSessionFile } from '../lib/session-file';
import {
  capOf,
  clampMaxPages,
  EMPTY_SIGN_IN,
  hasSignInDetails,
  headerErrorsOf,
  lookOnly,
  MAX_PAGES_LIMIT,
  primarySignInOf,
  rememberSignInsOf,
  scanBlockedHint,
  settleConsent,
  signInConsentGiven,
  withAddress,
  resetSignInChoices,
  type CheckupForm,
} from '../lib/form';
import { SignInRow } from '../components/SignInRow';
import { formatWhen } from '../lib/format';
import { hasNonDefaultOptions } from '../lib/onboarding';
import { Link, PATHS } from '../lib/router';
import { useDocumentTitle } from '../lib/title';
import { hostOf, normalizeUrl } from '../lib/url';

/** What the address check found, for the address as it is now. */
type AddressCheck =
  | { state: 'empty' }
  | { state: 'invalid'; reason: string }
  | { state: 'checking'; url: string }
  | { state: 'ok'; url: string; facts: SiteFacts; statusCode?: number; startWarning?: 'start-4xx' }
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

/** The fixture app that ships with the tool: `pnpm fixture` serves it here. */
const BUILT_IN_TEST_APP = 'http://localhost:3050';

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
  onRetryAi,
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
  /** Asks the AI setup again, after it failed to load. */
  onRetryAi?: () => void;
}) {
  useDocumentTitle('New check-up');
  const [check, setCheck] = useState<AddressCheck>({ state: 'empty' });
  const [recheck, setRecheck] = useState(0);
  const latest = useRef(0);
  const keyReady = !!ai?.configured;
  const [keyJustSaved, setKeyJustSaved] = useState(false);
  const [maxPagesText, setMaxPagesText] = useState(String(form.maxPages));
  useEffect(() => setMaxPagesText(String(form.maxPages)), [form.maxPages]);
  // The exploring numbers are kept as typed too, so a field can be cleared; they are checked on leaving the box.
  const [crawlText, setCrawlText] = useState({ pages: String(form.crawlConcurrency), delay: String(form.crawlDelayMs) });
  useEffect(
    () => setCrawlText({ pages: String(form.crawlConcurrency), delay: String(form.crawlDelayMs) }),
    [form.crawlConcurrency, form.crawlDelayMs]
  );
  // A typed number is used at once (so Enter starts with it); an empty box is set to the clamped value on leaving.
  const clampTo = (typed: string, min: number, max: number, fallback: number) =>
    Math.max(min, Math.min(max, Number(typed) || fallback));
  const commitMaxPages = () => {
    const n = clampMaxPages(maxPagesText);
    setMaxPagesText(String(n));
    onFormChange((f) => ({ ...f, maxPages: n }));
  };

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
            ? {
                state: 'ok',
                url: normal.url,
                facts,
                statusCode: result.statusCode,
                startWarning: result.startWarning,
              }
            : { state: 'unreachable', url: normal.url, reason: result.reason, suggestion: result.suggestion, facts }
        );
      } catch (err) {
        if (id !== latest.current) return;
        setCheck({
          state: 'unreachable',
          url: normal.url,
          reason: plainError(err, 'The address couldn’t be looked at. Try again.'),
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
            // Consent given for another App never carries over.
            ...resetSignInChoices(f),
            rememberTouched: false,
            owner: remembered?.owner ?? false,
            markedTestCopy: remembered?.markedTestCopy ?? false,
            searchChecks: remembered?.searchChecks ?? null,
            // Another site's sign-ins don't carry over.
            signIns: f.choicesFor ? [] : f.signIns,
            choicesFor: checkedHost,
          }
    );
  }, [checkedHost, remembered?.owner, remembered?.markedTestCopy, remembered?.searchChecks, onFormChange]);

  // Consent lasts only while the sign-in details are there.
  useEffect(() => {
    onFormChange(settleConsent);
  }, [form.signIns, form.signInConsent, form.reviewFirst, onFormChange]);

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

  // Typed sign-in details (not on the shared copy) replace the Access choice with a consent notice.
  const consentFlow = !shared && hasSignInDetails(form);
  const blockedHint = scanBlockedHint(form);
  const headerErrors = headerErrorsOf(form);
  const needsProdConfirmation =
    !consentFlow && !!kind && !kind.natural && form.markedTestCopy && !hasStagingIndicator && !confirmedProd;
  // No key doesn't stop a scan: fixed rules write the plan, and the AI can be connected any time.
  // (Once the AI setup has been read, so the plan knows which way to go.)
  // The check must be for the address as it is now: a check of an older address never starts a run.
  const addressNow = normalizeUrl(form.address);
  const checkIsCurrent = addressNow.ok && check.state === 'ok' && check.url === addressNow.url;
  const canStart =
    ai !== null &&
    checkIsCurrent &&
    !starting &&
    !needsProdConfirmation &&
    !blockedHint &&
    headerErrors.length === 0;
  // Why Start is off, in words: a disabled button alone never says.
  const startOffReason: string | null = starting
    ? null
    : ai === null
      ? 'Waiting for Release check-up to answer. Start is on as soon as it does.'
      : check.state === 'empty'
        ? 'Enter the address of the site first.'
        : check.state === 'checking' || !checkIsCurrent
          ? 'Looking at the address…'
          : check.state !== 'ok'
            ? 'Start is off until the address can be reached.'
            : needsProdConfirmation
              ? 'Say whether this is a test copy first.'
              : headerErrors.length > 0
                ? 'Fix the custom headers first.'
                : null;
  const start = () => {
    if (check.state !== 'ok' || !kind || !canStart) return;
    onStart({
      url: check.url,
      // With the consent notice the Access choice is not shown: its test-copy mark must not be remembered for the site.
      stagingHost: kind.showMark && !consentFlow ? form.markedTestCopy : undefined,
      searchChecks: searchChecksOn,
      visibility: searchChecksOn ? visibilityOn : { search: false, answers: false, aiSearch: false, marketing: false },
      noAI: ai && !keyReady ? true : undefined,
    });
  };

  const added =
    [form.specs, form.designNotes, form.journeys, form.contextUrl].filter((t) => t.trim()).length +
    (readCount(form.contextFiles) > 0 ? 1 : 0);

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
                    · {w.pages} pages · explored {formatWhen(w.discoveredAt)}
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

      <Question>Enter the address of the site for a check-up</Question>
      <p className="mb-8 max-w-prose text-ink-soft">
        The site is explored and a plan is written for you to review. Nothing is tested until you approve the plan.
      </p>

      {shared && (
        <div className="mb-8">
          <Notice tone="warn" title="This is a shared copy">
            <p>
              Other people use this copy too, but you only see your own check-ups and reports. They share one server, so
              only one check-up runs at a time. Only public sites can get a check-up.
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
        <label htmlFor="url-input" className="label text-ink flex items-center justify-between">
          <span>Site address</span>
          <span className="text-ink-soft normal-case font-sans font-normal">
            A public address, or one on your computer
          </span>
        </label>
        <input
          id="url-input"
          type="text"
          autoFocus
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          className="field h-14 text-lg font-mono placeholder:font-sans focus:border-stamp focus:ring-2 focus:ring-stamp/40 shadow-inner"
          placeholder="shop.example.com or localhost:3050"
          value={form.address}
          onChange={(e) => {
            const address = e.target.value;
            const hostFor = (a: string) => {
              const n = normalizeUrl(a);
              return n.ok ? hostOf(n.url) : null;
            };
            onFormChange((f) => withAddress(f, address, hostFor));
          }}
          aria-describedby="url-status"
          aria-invalid={check.state === 'invalid' || check.state === 'unreachable'}
        />
        {!form.address.trim() && (
          <p className="mt-2 text-sm text-ink-soft">
            No site handy?{' '}
            <button
              type="button"
              className="btn-link text-sm"
              onClick={() =>
                onFormChange((f) =>
                  withAddress(f, BUILT_IN_TEST_APP, (a) => {
                    const n = normalizeUrl(a);
                    return n.ok ? hostOf(n.url) : null;
                  })
                )
              }
            >
              Try the built-in test app
            </button>{' '}
            (start it first with <code className="font-mono">pnpm fixture</code>).
          </p>
        )}
        <div id="url-status" role="status" className="mt-2 min-h-[1.6em] text-sm">
          {check.state === 'checking' && <Spinner label="Looking at the address…" />}
          {check.state === 'invalid' && <span className="text-fail font-medium">{check.reason}</span>}
          {check.state === 'ok' && kind && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="badge-tech-pass">
                <span className="h-1.5 w-1.5 rounded-full bg-pass" />
                Reachable
              </span>
              <span className="font-mono text-xs text-ink break-all px-2 py-0.5 rounded bg-panel border border-rule">
                {check.url}
              </span>
              <span className={kind.isTestCopy && form.owner ? 'badge-tech-warn' : 'badge-tech'}>
                {kind.isTestCopy && form.owner
                  ? 'Test copy: forms are filled in and sent'
                  : kind.isTestCopy
                    ? 'Only looks: nothing is sent or changed'
                    : 'Live site: only looks, nothing is sent or changed'}
              </span>
            </div>
          )}
          {check.state === 'ok' && check.startWarning && (
            <p className="mt-1 text-warn">
              {check.statusCode
                ? `This address answered with a ${check.statusCode}. There may be nothing here to look at.`
                : 'This address answered, but not with a page. There may be nothing here to look at.'}
            </p>
          )}
        </div>
        {check.state === 'unreachable' && (
          <ErrorMessage>
            <span className="block font-bold">{check.reason}</span>
            {check.suggestion && <span className="block text-ink">{check.suggestion}</span>}
            <button type="button" className="btn-link mt-1 text-sm" onClick={() => setRecheck((n) => n + 1)}>
              Look again
            </button>
          </ErrorMessage>
        )}

        {consentFlow && <ConsentNotice form={form} onFormChange={onFormChange} />}

        {kind && !consentFlow && <AccessChoice isTestCopyHost={kind.natural} form={form} onChange={setChoice} />}

        {shared && check.state === 'ok' && form.owner && form.markedTestCopy && !kind?.natural && (
          <DomainProofPanel url={check.url} />
        )}

        {needsProdConfirmation && (
          <div className="mt-4">
            <Notice tone="warn" title="This looks like a live site">
              <p>
                The address doesn’t look like a copy made for testing. Forms stay untouched unless you say it is a test
                copy.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn-quiet rounded-control min-h-[44px] border border-stamp/50 px-4 py-2.5 text-xs font-bold text-stamp hover:text-stamp-dark"
                  onClick={() => setConfirmedProd(true)}
                >
                  Yes, this is a test copy
                </button>
                <button
                  type="button"
                  className="min-h-[44px] px-2 py-2.5 text-xs text-ink-soft hover:underline"
                  onClick={() => setChoice({ owner: false, markedTestCopy: false })}
                >
                  Only look at it instead: nothing is sent or changed
                </button>
              </div>
            </Notice>
          </div>
        )}

        <details
          className="mt-6 blueprint-card overflow-hidden"
          open={hasNonDefaultOptions(form) || undefined}
          data-testid="more-options"
        >
          <summary className="flex min-h-[48px] cursor-pointer flex-wrap items-center gap-x-2 px-5 py-3.5 font-bold hover:bg-panel/40 transition-colors">
            <span>More options</span>
            <span className="font-normal text-xs text-ink-soft font-mono">(optional)</span>
          </summary>
          <div className="border-t border-rule px-4 pb-4">
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
                // The number is kept as typed, so it can be cleared and retyped; it's checked on leaving the box or on Enter.
                onChange={(e) => setMaxPagesText(e.target.value)}
                onBlur={commitMaxPages}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  commitMaxPages();
                }}
                aria-describedby="max-pages-hint"
              />
              <span>pages</span>
              <span id="max-pages-hint" className="basis-full text-ink-soft">
                Pages that share a layout are tested through a few samples, so big sites stay quick.
              </span>
            </div>

            <SignInsSection
              form={form}
              saved={remembered?.signIns}
              consentFlow={consentFlow}
              onFormChange={onFormChange}
            />

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
                    <span className="block font-bold text-ink">
                      Look at how search engines and AI assistants find the site
                    </span>
                    <span className="block text-xs font-medium text-ink-soft">
                      Search engines · AI answers · AI search · Marketing basics
                    </span>
                    <span className="mt-1 block text-xs text-ink-soft">
                      {kind.isTestCopy && form.owner
                        ? 'Off by default for test copies on your computer, but you can turn it on any time.'
                        : 'Looks at search tags, what AI assistants can read, and marketing basics.'}
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
                          <span className="font-semibold text-ink">Search engines</span>
                          <span className="block text-ink-soft">
                            Titles, descriptions, headings, robots and sitemap
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
                          <span className="font-semibold text-ink">AI answers</span>
                          <span className="block text-ink-soft">
                            Question-and-answer markup that AI assistants read
                          </span>
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
                          <span className="font-semibold text-ink">AI search</span>
                          <span className="block text-ink-soft">
                            A guide file for AI assistants, whether they may visit, and sources
                          </span>
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
                          <span className="font-semibold text-ink">Marketing basics</span>
                          <span className="block text-ink-soft">
                            Share previews, picture, call to action, contact and privacy
                          </span>
                        </div>
                      </label>
                    </div>
                  </details>
                )}
              </div>
            )}

            <details
              className="mt-6 rounded-card border border-rule/80 bg-surface/60 overflow-hidden"
              open={added > 0 || undefined}
            >
              <summary className="flex min-h-[48px] cursor-pointer flex-wrap items-center gap-x-2 px-5 py-3 font-bold hover:bg-panel/40 transition-colors">
                <span>Add notes, design rules or user flows</span>
                <span className="font-normal text-xs text-ink-soft font-mono">(optional)</span>
                {added > 0 && <span className="badge-tech-pass text-[10px] py-0 px-2">Added</span>}
              </summary>
              <div className="space-y-5 border-t border-rule p-4">
                <p className="text-sm text-ink-soft">
                  The AI plans with these, so the plan tests what the site is meant to do.
                </p>
                <MaterialField
                  id="specs"
                  label="Product Context"
                  hint="Requirements or user stories the site must meet, as text."
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
                  label="User flows to test"
                  hint="Things people do across pages that matter most."
                  placeholder={
                    'For example:\nSign in as a manager, open Reports and confirm the open invoices are listed.'
                  }
                  value={form.journeys}
                  onChange={(value) => onFormChange((f) => ({ ...f, journeys: value }))}
                />
                <ReferenceDocuments form={form} onFormChange={onFormChange} keyReady={keyReady} />
              </div>
            </details>

            <details
              className="mt-6 rounded-card border border-rule/80 bg-surface/60 overflow-hidden"
              open={!!form.testCap || !!form.customHeaders.trim() || undefined}
            >
              <summary className="flex min-h-[48px] cursor-pointer items-center px-5 py-3 font-bold hover:bg-panel/40 transition-colors">
                For developers
              </summary>
              <div className="space-y-4 border-t border-rule p-4 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <label htmlFor="test-cap">Test cap</label>
                  <input
                    id="test-cap"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100000}
                    placeholder="2000"
                    className="field w-24 py-1.5 text-sm"
                    value={form.testCap}
                    onChange={(e) => onFormChange((f) => ({ ...f, testCap: e.target.value }))}
                    aria-describedby="test-cap-hint"
                  />
                  <span>tests at most</span>
                  <span id="test-cap-hint" className="basis-full text-ink-soft">
                    Past this many tests, the rest are switched off in the plan. Leave it empty for 2000.
                  </span>
                </div>

                <div>
                  <span className="block font-semibold text-ink">Exploring speed</span>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="flex items-center gap-2">
                      <label htmlFor="crawl-concurrency">Pages at once</label>
                      <input
                        id="crawl-concurrency"
                        type="number"
                        min={1}
                        max={5}
                        className="field w-20 py-1.5 text-sm"
                        value={crawlText.pages}
                        onChange={(e) => {
                          setCrawlText((t) => ({ ...t, pages: e.target.value }));
                          if (e.target.value.trim()) {
                            const val = clampTo(e.target.value, 1, 5, 2);
                            onFormChange((f) => ({ ...f, crawlConcurrency: val }));
                          }
                        }}
                        onBlur={() => {
                          const val = clampTo(crawlText.pages, 1, 5, 2);
                          setCrawlText((t) => ({ ...t, pages: String(val) }));
                          onFormChange((f) => ({ ...f, crawlConcurrency: val }));
                        }}
                      />
                      <span className="text-xs text-ink-soft">(1–5)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label htmlFor="crawl-delay">Wait between pages</label>
                      <input
                        id="crawl-delay"
                        type="number"
                        min={0}
                        max={2000}
                        step={50}
                        className="field w-24 py-1.5 text-sm"
                        value={crawlText.delay}
                        onChange={(e) => {
                          setCrawlText((t) => ({ ...t, delay: e.target.value }));
                          if (e.target.value.trim()) {
                            const val = clampTo(e.target.value, 0, 2000, 0);
                            onFormChange((f) => ({ ...f, crawlDelayMs: val }));
                          }
                        }}
                        onBlur={() => {
                          const val = clampTo(crawlText.delay, 0, 2000, 0);
                          setCrawlText((t) => ({ ...t, delay: String(val) }));
                          onFormChange((f) => ({ ...f, crawlDelayMs: val }));
                        }}
                      />
                      <span className="text-xs text-ink-soft">ms (0–2000)</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label htmlFor="custom-headers" className="block font-semibold text-ink">
                    Custom headers
                  </label>
                  <p id="custom-headers-hint" className="text-ink-soft">
                    For sites behind bot protection: headers sent with every request, such as an allowlist token.
                  </p>
                  <textarea
                    id="custom-headers"
                    rows={2}
                    aria-describedby="custom-headers-hint"
                    placeholder="X-QA-Bypass-Token: your-token&#10;User-Agent: MyCustomAgent"
                    className="field mt-1 w-full font-mono text-xs"
                    value={form.customHeaders}
                    onChange={(e) => onFormChange((f) => ({ ...f, customHeaders: e.target.value }))}
                  />
                  {headerErrors.map((err, idx) => (
                    <p key={idx} role="alert" className="mt-1 text-xs text-fail">
                      {err}
                    </p>
                  ))}
                </div>
              </div>
            </details>
          </div>
        </details>

        {keyReady && check.state === 'ok' && (
          <AiEstimateLine url={check.url} maxPages={form.maxPages} form={form} onFormChange={onFormChange} />
        )}

        {startError && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <ErrorMessage>{startError}</ErrorMessage>
            {ai === null && onRetryAi && (
              <button type="button" className="btn-quiet" onClick={onRetryAi}>
                Retry
              </button>
            )}
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="submit"
            className="btn-primary min-h-[50px] px-8 font-bold shadow-level-2 hover:shadow-level-3"
            disabled={starting || !canStart}
            aria-describedby={blockedHint ? 'scan-blocked-hint' : 'start-hint'}
          >
            {starting ? <Spinner label="Starting…" /> : 'Start the check-up'}
          </button>
          {blockedHint ? (
            <p id="scan-blocked-hint" role="alert" className="text-sm font-semibold text-warn">
              {blockedHint}
            </p>
          ) : startOffReason ? (
            <p id="start-hint" className="text-sm text-ink-soft">
              {startOffReason}
            </p>
          ) : (
            <p id="start-hint" className="text-sm text-ink-soft">
              {consentFlow && !form.reviewFirst
                ? 'With these sign-in details, testing starts as soon as the plan is written. You will not review the plan first.'
                : ai && !keyReady
                  ? 'No AI key yet, so fixed rules will write the plan. Nothing is tested until you approve it.'
                  : 'Nothing is tested until you approve the plan.'}
            </p>
          )}
        </div>
      </form>

      {ai && !keyReady && (
        <details className="mt-8 blueprint-card overflow-hidden">
          <summary className="flex min-h-[48px] cursor-pointer flex-wrap items-center gap-x-2 px-5 py-3.5 font-bold hover:bg-panel/40 transition-colors">
            <span>Connect the AI for a smarter plan</span>
            <span className="font-normal text-xs text-ink-soft font-mono">(optional)</span>
          </summary>
          <div className="border-t border-rule p-5">
            <p className="mb-4 text-sm text-ink-soft">
              Without it, fixed rules write the plan and you can start now. With it, the AI writes a plan that fits your
              site. It runs on OpenRouter’s free models. What you send may be kept and used to learn (Settings
              explains). You only do this once, and anything you typed above is kept.
            </p>
            <KeyField
              onSaved={(model) => {
                setKeyJustSaved(true);
                onKeySaved(model);
              }}
            />
          </div>
        </details>
      )}

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
      ? { text: `Your check-up of ${host} is exploring the site.`, to: PATHS.scan, action: 'Watch the progress' }
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
            className="sr-only"
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
              try {
                const text = await file.text();
                onChange(value.trim() ? `${value.trim()}\n\n${text}` : text);
              } catch {
                setFileError('Could not read the file.');
              }
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

/**
 * Documents the plan is checked against: several .md / .txt files and/or a docs address. Each file
 * keeps its own name so a Source in the plan can say which document it came from.
 */
function ReferenceDocuments({
  form,
  onFormChange,
  keyReady,
}: {
  form: CheckupForm;
  /** An AI key is set: without one, Plan Items from documents are written by fixed rules. */
  keyReady: boolean;
  onFormChange: (update: (form: CheckupForm) => CheckupForm) => void;
}) {
  const [rejected, setRejected] = useState<string[]>([]);
  return (
    <div className="space-y-3 border-t border-rule pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-bold">Product Context files</span>
        <label className="cursor-pointer text-sm font-bold text-stamp underline underline-offset-4 hover:text-stamp-dark focus-within:outline focus-within:outline-2 focus-within:outline-stamp">
          Add files
          <input
            type="file"
            multiple
            accept=".md,.markdown,.txt,.docx"
            className="sr-only"
            aria-label="Add documents (.md, .txt or .docx)"
            onChange={async (e) => {
              const input = e.currentTarget;
              const picked = Array.from(input.files ?? []);
              input.value = '';
              if (picked.length === 0) return;
              const result = await readContextFiles(picked, form.contextFiles.length, { convertDocx });
              setRejected(result.rejected);
              if (result.accepted.length > 0) {
                onFormChange((f) => ({
                  ...f,
                  contextFiles: [
                    ...f.contextFiles.filter((old) => !result.accepted.some((a) => a.name === old.name)),
                    ...result.accepted,
                  ].slice(0, MAX_CONTEXT_FILES),
                }));
              }
            }}
          />
        </label>
      </div>
      <p className="text-sm text-ink-soft">
        Markdown, text or Word files, up to {MAX_CONTEXT_FILES}. Plan Items link back to the document and section they
        came from.
      </p>
      {form.contextFiles.length > 0 && (
        <ul className="space-y-1 text-sm">
          {form.contextFiles.map((file) => (
            <li key={file.name} className="flex flex-wrap items-center gap-x-3">
              <span className="font-mono text-ink">{file.name}</span>
              {file.summary && !file.unread && <span className="text-ink-soft">{describeSummary(file.summary)}</span>}
              {file.unread && (
                <span role="alert" className="text-fail">
                  {unreadMessage(file.name)}
                </span>
              )}
              {file.warnings?.map((w, n) => (
                <span key={n} className="text-ink-soft">
                  {w}
                </span>
              ))}
              <button
                type="button"
                className="btn-link text-sm"
                aria-label={`Remove ${file.name}`}
                onClick={() =>
                  onFormChange((f) => ({ ...f, contextFiles: f.contextFiles.filter((c) => c.name !== file.name) }))
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {form.contextFiles.length > 0 && !keyReady && (
        <p className="text-sm text-ink-soft">
          Plan Items from your documents are written by fixed rules. Steps that cannot be matched to a control, and
          free-text expectations, are listed under Needs your judgement.
        </p>
      )}
      {rejected.length > 0 && (
        <ul role="alert" className="space-y-1 text-sm text-fail">
          {rejected.map((message, i) => (
            <li key={i}>{message}</li>
          ))}
        </ul>
      )}
      <label className="block text-sm">
        <span className="mb-1 block font-bold">Docs address (optional)</span>
        <input
          type="url"
          className="field py-2 text-sm"
          placeholder="https://docs.example.com/guide"
          value={form.contextUrl}
          onChange={(e) => onFormChange((f) => ({ ...f, contextUrl: e.target.value }))}
          aria-describedby="context-url-hint"
        />
        <span id="context-url-hint" className="mt-1 block text-ink-soft">
          Up to 20 pages on that site are read. Pages that need a sign-in are skipped.
        </span>
      </label>
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
        {
          id: 'look',
          title: 'Only look at it: nothing is sent or changed',
          hint: 'Nothing is filled in, sent or changed. Nothing is recorded about who owns it.',
          set: { owner: false },
        },
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
          title: 'Only look at it: nothing is sent or changed',
          hint: 'Someone else’s site, or you’re not sure. Nothing is recorded about who owns it.',
          set: { owner: false, markedTestCopy: false },
        },
        {
          id: 'live',
          title: 'It’s my live site: only look at it',
          hint: 'Nothing is sent or changed on the real site. It is remembered as yours.',
          set: { owner: true, markedTestCopy: false },
        },
        {
          id: 'test',
          title: 'It’s a test copy I’m allowed to test fully',
          hint: 'A copy you set up for testing, so forms can be filled in and sent without touching real customers or data.',
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

/**
 * On the shared copy a test copy is tested fully only after its Verified Domain line is published:
 * until then the check-up only looks. Shows the line and where it goes, and checks it again on request.
 */
function DomainProofPanel({ url }: { url: string }) {
  const [status, setStatus] = useState<DomainProofStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A reply for an address the person has since changed is dropped, so it never shows against the new one.
  const urlNow = useRef(url);
  urlNow.current = url;
  const run = async () => {
    const asked = url;
    setBusy(true);
    setProblem(null);
    try {
      const result = await checkDomainProof(asked);
      if (asked === urlNow.current) setStatus(result);
    } catch (err) {
      if (asked === urlNow.current) setProblem(plainError(err, 'The Verified Domain line couldn’t be looked at.'));
    } finally {
      if (asked === urlNow.current) setBusy(false);
    }
  };
  useEffect(() => {
    setStatus(null);
    void run();
  }, [url]);

  if (status && (!status.required || status.verified)) {
    return status.verified && status.required ? (
      <p className="mt-4 text-sm text-pass">
        Verified Domain: the line was found, so this test copy can be tested fully.
      </p>
    ) : null;
  }
  return (
    <div className="mt-4 rounded-lg border-2 border-edge bg-surface p-4" role="region" aria-label="Verified Domain">
      <p className="font-bold">This test copy isn’t verified yet, so it is only looked at</p>
      {status?.line ? (
        <>
          <p className="mt-2 text-sm text-ink-soft">
            To test it fully, publish this one line as a file at the address below, on this exact address. It works for
            this visit only.
          </p>
          <p className="mt-2 break-all font-mono text-sm">{status.line}</p>
          <p className="mt-1 break-all font-mono text-sm">{status.proofUrl}</p>
        </>
      ) : (
        status && (
          <p className="mt-2 text-sm text-ink-soft">
            This address can’t be verified (a Verified Domain needs an https address on the public internet), so it is
            only looked at.
          </p>
        )
      )}
      {problem && <p className="mt-2 text-sm text-fail">{problem}</p>}
      <button type="button" className="btn-link mt-2 text-sm" disabled={busy} onClick={() => void run()}>
        {busy ? 'Looking…' : 'Look again'}
      </button>
    </div>
  );
}

/** Sign-ins to explore and test the signed-in pages with, from the start: one or more roles. */
function SignInsSection({
  form,
  saved,
  consentFlow,
  onFormChange,
}: {
  form: CheckupForm;
  saved?: Array<{ role: string; username: string }>;
  /** The consent notice is shown: the keychain is used only if the person ticks remember. */
  consentFlow: boolean;
  onFormChange: (update: (form: CheckupForm) => CheckupForm) => void;
}) {
  const filled = form.signIns.filter((s) => s.username.trim()).length;
  const usingSaved = !!saved?.length && form.useSavedSignIns && form.signIns.length === 0;
  const set = (i: number, change: Partial<CheckupForm['signIns'][number]>) =>
    onFormChange((f) => ({ ...f, signIns: f.signIns.map((s, n) => (n === i ? { ...s, ...change } : s)) }));
  return (
    <details className="mt-6 rounded-lg border-2 border-edge bg-surface" open={filled > 0 || undefined}>
      <summary className="flex min-h-[48px] cursor-pointer flex-wrap items-center gap-x-2 px-4 py-3 font-bold">
        Sign in to test pages behind a login
        <span className="font-normal text-ink-soft">(optional)</span>
        {(filled > 0 || usingSaved) && (
          <span className="rounded border border-pass px-1.5 text-xs text-pass">{usingSaved ? 'Saved' : 'Added'}</span>
        )}
      </summary>
      <div className="space-y-4 border-t border-rule p-4">
        <p className="text-sm text-ink-soft">
          The check-up signs in as each role and explores what it sees, so pages behind the sign-in are planned and
          tested too.
        </p>
        <SignInFields form={form} onFormChange={onFormChange} />
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
          <SignInRow
            key={i}
            value={s}
            legend={`Sign-in ${i + 1}`}
            rolePlaceholder={i === 0 ? 'member' : 'admin'}
            onChange={(patch) => set(i, patch)}
            onRemove={() => onFormChange((f) => ({ ...f, signIns: f.signIns.filter((_, n) => n !== i) }))}
          />
        ))}
        <button
          type="button"
          className="btn-quiet"
          onClick={() => onFormChange((f) => ({ ...f, signIns: [...f.signIns, { ...EMPTY_SIGN_IN }] }))}
        >
          {form.signIns.length === 0 ? 'Add a sign-in' : 'Add another sign-in'}
        </button>
        <ImportRoles onFormChange={onFormChange} />
        <SavedSessions form={form} onFormChange={onFormChange} />
        {form.signIns.length > 0 && (
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[#6C9BF2]"
              checked={rememberSignInsOf(form, consentFlow)}
              onChange={(e) =>
                onFormChange((f) => ({ ...f, rememberSignIns: e.target.checked, rememberTouched: true }))
              }
            />
            <span>Remember these sign-ins for this site (passwords are kept in this computer’s keychain)</span>
          </label>
        )}
      </div>
    </details>
  );
}

/**
 * Import roles: a list of `role,username,password` lines typed, pasted or picked by the person
 * fills the sign-in rows above. Form state only: never saved, logged or sent from here.
 */
function ImportRoles({ onFormChange }: { onFormChange: (update: (form: CheckupForm) => CheckupForm) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const apply = (source: string) => {
    const { roles, skipped } = parseRoleList(source);
    if (roles.length > 0) {
      onFormChange((f) => ({ ...f, signIns: fillRoleRows(f.signIns, roles) }));
      setText('');
    }
    const done =
      roles.length > 0 ? `${roles.length} ${roles.length === 1 ? 'role' : 'roles'} filled in.` : 'No roles found.';
    setNote([done, ...skipped].join(' '));
  };
  if (!open) {
    return (
      <button type="button" className="btn-link text-sm" onClick={() => setOpen(true)}>
        Import roles
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-rule p-3">
      <label className="block text-sm">
        <span className="mb-1 block font-bold">Roles to import</span>
        <textarea
          className="field py-2 font-mono text-sm"
          rows={4}
          autoComplete="off"
          spellCheck={false}
          placeholder="role,username,password"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className="text-sm text-ink-soft">
        One role per line: role,username,password. Used for this check-up only; nothing is saved from here.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-quiet" disabled={!text.trim()} onClick={() => apply(text)}>
          Fill in roles
        </button>
        <label className="cursor-pointer text-sm font-bold text-stamp underline underline-offset-4 hover:text-stamp-dark focus-within:outline focus-within:outline-2 focus-within:outline-stamp">
          Pick a list file
          <input
            type="file"
            accept=".csv,.txt"
            className="sr-only"
            aria-label="Pick a role list file (.csv or .txt)"
            onChange={async (e) => {
              const input = e.currentTarget;
              const file = input.files?.[0];
              input.value = '';
              if (!file) return;
              try {
                apply(await file.text());
              } catch {
                setNote('The file couldn’t be read. Try again.');
              }
            }}
          />
        </label>
        <button
          type="button"
          className="btn-link text-sm"
          onClick={() => {
            setOpen(false);
            setText('');
            setNote(null);
          }}
        >
          Close
        </button>
      </div>
      {note && (
        <p role="alert" className="text-sm">
          {note}
        </p>
      )}
    </div>
  );
}

/** Username and password at the top of the sign-in section: the first sign-in (role `member` unless named). */
function SignInFields({
  form,
  onFormChange,
}: {
  form: CheckupForm;
  onFormChange: (update: (form: CheckupForm) => CheckupForm) => void;
}) {
  const first = primarySignInOf(form);
  const set = (change: Partial<CheckupForm['signIns'][number]>) =>
    onFormChange((f) => {
      const signIns = f.signIns.length > 0 ? f.signIns : [{ ...EMPTY_SIGN_IN }];
      return { ...f, signIns: signIns.map((s, n) => (n === 0 ? { ...s, ...change } : s)) };
    });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">
        <span className="mb-1 block font-bold">
          Email or username <span className="font-normal text-ink-soft">(optional)</span>
        </span>
        <input
          className="field py-2 text-sm"
          autoComplete="off"
          spellCheck={false}
          value={first.username}
          onChange={(e) => set({ username: e.target.value })}
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-bold">
          Password <span className="font-normal text-ink-soft">(optional)</span>
        </span>
        <input
          className="field py-2 text-sm"
          type="password"
          autoComplete="off"
          value={first.password}
          onChange={(e) => set({ password: e.target.value })}
        />
      </label>
    </div>
  );
}

/** Shown when sign-in details are typed: the person accepts that forms are filled in and sent as that user. */
function ConsentNotice({
  form,
  onFormChange,
}: {
  form: CheckupForm;
  onFormChange: (update: (form: CheckupForm) => CheckupForm) => void;
}) {
  return (
    <div className="mt-4" data-testid="sign-in-consent">
      <Notice tone="warn" title="Fill in and send forms with these sign-in details">
        <p>
          The check-up will fill in and send forms on this App with these sign-in details. Sensitive Actions, such as
          deleting or paying, are skipped.
        </p>
        <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0 accent-[#6C9BF2]"
            checked={form.signInConsent}
            onChange={(e) => onFormChange((f) => ({ ...f, signInConsent: e.target.checked }))}
          />
          <span className="font-bold">I accept this</span>
        </label>
        <label className="mt-2 flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0 accent-[#6C9BF2]"
            checked={form.reviewFirst}
            onChange={(e) => onFormChange((f) => ({ ...f, reviewFirst: e.target.checked }))}
          />
          <span>Let me review the plan before testing starts</span>
        </label>
        <button type="button" className="btn-link mt-3 text-sm" onClick={() => onFormChange(lookOnly)}>
          Only look at it instead: nothing is sent or changed
        </button>
      </Notice>
    </div>
  );
}

/**
 * "Use a saved session" for a role: the file is read into this screen's state only, shown as
 * "Saved session added" (never its contents), sent once and then dropped.
 */
function SavedSessions({
  form,
  onFormChange,
}: {
  form: CheckupForm;
  onFormChange: (update: (form: CheckupForm) => CheckupForm) => void;
}) {
  const [role, setRole] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2 border-t border-rule pt-3">
      <p className="text-sm font-bold">Use a saved session instead of a password (optional)</p>
      <p className="text-sm text-ink-soft">
        For sites with two-step sign-in. The file is used for this check-up only and is never saved.
      </p>
      {form.savedSessions.map((s, i) => (
        <p key={i} className="flex flex-wrap items-center gap-x-3 text-sm">
          <span className="font-bold">{s.role || 'member'}:</span>
          <span className="text-pass">Saved session added</span>
          <button
            type="button"
            className="btn-link text-sm"
            onClick={() => onFormChange((f) => ({ ...f, savedSessions: f.savedSessions.filter((_, n) => n !== i) }))}
          >
            Remove
          </button>
        </p>
      ))}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-bold">Role name</span>
          <input
            className="field py-2 text-sm"
            value={role}
            placeholder="admin"
            onChange={(e) => setRole(e.target.value)}
          />
        </label>
        <label className="cursor-pointer text-sm font-bold text-stamp underline underline-offset-4">
          Add a saved session
          <input
            type="file"
            accept=".json,application/json"
            className="sr-only"
            aria-label="Add a saved session file"
            onChange={async (e) => {
              const input = e.currentTarget;
              const file = input.files?.[0];
              input.value = '';
              if (!file) return;
              try {
                const text = await file.text();
                const result = parseSessionFile(file.name, file.size, text);
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                setError(null);
                const name = role.trim();
                onFormChange((f) => ({
                  ...f,
                  savedSessions: [
                    ...f.savedSessions.filter((s) => s.role !== name),
                    { role: name, fileName: file.name, state: result.state },
                  ],
                }));
                setRole('');
              } catch {
                setError('The file couldn’t be read. Try again.');
              }
            }}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-fail">
          {error}
        </p>
      )}
    </div>
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
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label>
          <span className="mb-1 block font-bold">Limit AI requests (optional)</span>
          <input
            type="number"
            min={1}
            className="field w-28 py-1.5 text-sm"
            value={form.capRequests}
            onChange={(e) => onFormChange((f) => ({ ...f, capRequests: e.target.value }))}
          />
        </label>
        {estimate.estimatedUsd != null && (
          <label>
            <span className="mb-1 block font-bold">Limit spend in dollars (optional)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className="field w-28 py-1.5 text-sm"
              value={form.capDollars}
              onChange={(e) => onFormChange((f) => ({ ...f, capDollars: e.target.value }))}
            />
          </label>
        )}
      </div>
      <p className="mt-1 text-ink">{capLine(estimate, capOf(form))}</p>
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
