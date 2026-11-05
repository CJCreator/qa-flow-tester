import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { RunSummary } from '@qa/types';
import {
  checkDomainProof,
  checkReachable,
  convertDocx,
  estimateAi,
  RunnerError,
  type AiEstimate,
  type AiSetup,
  type DomainProofStatus,
  type RunnerStatus,
  type SiteFacts,
  type WaitingPlan,
} from '../api';
import { KeyField } from '../components/KeyField';
import { ErrorMessage, Notice, Question, Spinner } from '../components/text';
import { Badge, Disclosure, Page } from '../components/ui';
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
  withAddress,
  resetSignInChoices,
  type CheckupForm,
  type SignInEntry,
} from '../lib/form';
import { SignInRow } from '../components/SignInRow';
import { formatWhen, scrollBehavior } from '../lib/format';
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

type Visibility = NonNullable<StartFacts['visibility']>;

const CHECK_DELAY_MS = 600;

/** Ids the Start reason can take the person to, inside "Adjust the check-up". */
const CONSENT_BOX_ID = 'sign-in-consent-box';
const HEADERS_ID = 'custom-headers';
const AI_LIMIT_ID = 'ai-request-limit';

/**
 * Takes the person to a control inside "Adjust the check-up": opens the disclosure it sits in, scrolls it
 * into view and moves focus to it.
 */
function reveal(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const details = el.closest('details');
  if (details) details.open = true;
  el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  el.focus({ preventScroll: true });
}

/** The runner's own site facts decide whether the address is a Test Copy; the person can mark a live-looking one. */
function testCopyOf(facts: SiteFacts, form: CheckupForm): { natural: boolean; showMark: boolean; isTestCopy: boolean } {
  const natural = !!facts.testCopy && !facts.remembered?.markedTestCopy;
  return { natural, showMark: !natural, isTestCopy: natural || form.markedTestCopy };
}

/** About how many AI requests the scan needs, asked a moment after the address or page count settles. */
function useAiEstimate(url: string | null, maxPages: number): AiEstimate | null {
  const [estimate, setEstimate] = useState<AiEstimate | null>(null);
  useEffect(() => {
    setEstimate(null);
    if (!url) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void estimateAi(url, maxPages).then((e) => !cancelled && setEstimate(e));
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url, maxPages]);
  return estimate;
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
  const visibilityOn: Visibility = form.visibility ?? {
    search: searchChecksOn,
    answers: searchChecksOn,
    aiSearch: searchChecksOn,
    marketing: searchChecksOn,
  };

  const hasStagingIndicator =
    !!kind?.natural ||
    /(?:^|\.)(staging|stg|dev|test|preview|qa|uat)(?:\.|$)/i.test(checkedHost || '') ||
    /(?:-|\.)(staging|dev|test|preview)(?:\.|$)/i.test(checkedHost || '') ||
    /\.(vercel\.app|netlify\.app|fly\.dev|railway\.app|onrender\.com|run\.app)$/i.test(checkedHost || '');

  // Typed sign-in details (not on the shared copy) replace the Access choice with a consent notice.
  const consentFlow = !shared && hasSignInDetails(form);
  const blockedHint = scanBlockedHint(form);
  const headerErrors = headerErrorsOf(form);
  const needsProdConfirmation =
    !consentFlow && !!kind && !kind.natural && form.markedTestCopy && !hasStagingIndicator && !confirmedProd;
  // No key doesn't stop a scan: fixed rules write the plan, and the AI can be connected any time.
  // (Once the AI setup has been read, so the plan knows which way to go.)
  const canStart =
    ai !== null &&
    check.state === 'ok' &&
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
        : check.state === 'checking'
          ? 'Checking the address…'
          : check.state !== 'ok'
            ? 'Start is off until the address can be reached.'
            : needsProdConfirmation
              ? 'Say whether this is a test copy first.'
              : headerErrors.length > 0
                ? 'Fix the custom headers first, under Details for developers.'
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

  const estimate = useAiEstimate(keyReady && check.state === 'ok' ? check.url : null, form.maxPages);
  const estimateShort = !!estimate && estimate.left !== null && estimate.left < estimate.high;

  const added =
    [form.specs, form.designNotes, form.journeys, form.contextUrl].filter((t) => t.trim()).length +
    (readCount(form.contextFiles) > 0 ? 1 : 0);
  const signInCount = form.signIns.filter((s) => s.username.trim()).length;
  const usingSaved = !!remembered?.signIns?.length && form.useSavedSignIns && form.signIns.length === 0;
  // The current values, so a closed "Adjust the check-up" still says what it holds.
  const adjustHint = [
    `${form.maxPages} pages`,
    `search checks ${searchChecksOn ? 'on' : 'off'}`,
    signInCount > 0
      ? `${signInCount} ${signInCount === 1 ? 'sign-in' : 'sign-ins'}`
      : usingSaved
        ? 'saved sign-ins'
        : '',
    added > 0 ? 'Product context added' : '',
    form.capRequests.trim() ? `up to ${form.capRequests.trim()} AI requests` : '',
  ]
    .filter(Boolean)
    .join(', ');

  const setVisibility = (next: Visibility) =>
    onFormChange((f) => ({
      ...f,
      searchChecks: next.search || next.answers || next.aiSearch || next.marketing,
      visibility: next,
    }));

  // Folded into the chosen "test copy" card: the confirmation for a live-looking address, and on the shared copy
  // the Verified Domain line.
  const testCardExtra = (
    <>
      {needsProdConfirmation && (
        <div>
          <p className="font-bold text-warn">This looks like a live site</p>
          <p className="mt-1 text-sm text-ink">
            The address doesn’t look like a copy made for testing. Forms stay untouched unless you confirm it is a test
            copy.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <button type="button" className="btn-quiet btn-sm" onClick={() => setConfirmedProd(true)}>
              Yes, this is a test copy
            </button>
            <button
              type="button"
              className="btn-link text-sm"
              onClick={() => setChoice({ owner: false, markedTestCopy: false })}
            >
              Only look at it instead: nothing is sent or changed
            </button>
          </div>
        </div>
      )}
      {shared && check.state === 'ok' && form.owner && form.markedTestCopy && !kind?.natural && (
        <DomainProofPanel url={check.url} />
      )}
    </>
  );
  const hasTestCardExtra =
    needsProdConfirmation || (shared && check.state === 'ok' && form.owner && form.markedTestCopy && !kind?.natural);

  return (
    <Page width="form">
      {inProgress && <ResumeCard status={inProgress} />}
      {waitingPlans.length > 0 && (
        <aside
          aria-label="Plans waiting for review"
          className="mb-10 rounded-card border border-rule bg-surface px-5 py-4"
        >
          <p className="font-bold text-ink">
            {waitingPlans.length === 1
              ? 'A plan is also waiting for your review'
              : 'Plans are also waiting for your review'}
          </p>
          <ul className="mt-1 divide-y divide-rule">
            {waitingPlans.map((w) => (
              <li key={w.host} className="flex flex-wrap items-center justify-between gap-x-3">
                <span className="min-w-0 text-ink">
                  <span className="break-all font-bold">{w.host}</span>{' '}
                  <span className="text-sm text-ink-soft">
                    · {w.pages} pages · scanned {formatWhen(w.discoveredAt)}
                  </span>
                </span>
                <button type="button" className="btn-link text-sm" onClick={() => onResumePlan?.(w.host)}>
                  Open this plan
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <Question>Enter the address of the site to check</Question>
      <p className="mb-8 max-w-prose text-ink-soft">
        The site is explored and a plan is written for you to review. Nothing is tested until you approve the plan.
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

      <form
        id="new-checkup-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (check.state === 'ok') start();
          else setRecheck((n) => n + 1);
        }}
      >
        <label htmlFor="url-input" className="label text-ink">
          Site address
        </label>
        <p id="url-hint" className="-mt-1 mb-2 text-sm text-ink-soft">
          {shared ? 'A public address' : 'A public address, or one on your computer'}
        </p>
        <input
          id="url-input"
          type="text"
          autoFocus
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          className="field h-14 text-lg"
          placeholder={shared ? 'shop.example.com' : 'shop.example.com or localhost:5173'}
          value={form.address}
          onChange={(e) => {
            const address = e.target.value;
            const hostFor = (a: string) => {
              const n = normalizeUrl(a);
              return n.ok ? hostOf(n.url) : null;
            };
            onFormChange((f) => withAddress(f, address, hostFor));
          }}
          aria-describedby="url-hint url-status"
          aria-invalid={check.state === 'invalid' || check.state === 'unreachable'}
        />
        <div id="url-status" role="status" className="mt-2 min-h-[1.6em] text-sm">
          {check.state === 'checking' && <Spinner label="Checking the address…" announce={false} />}
          {check.state === 'invalid' && <span className="font-medium text-fail">{check.reason}</span>}
          {check.state === 'ok' && kind && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge tone="pass">Reachable</Badge>
              <span className="break-all font-mono text-xs text-ink">{check.url}</span>
              <Badge tone={kind.isTestCopy && form.owner ? 'warn' : 'neutral'}>
                {kind.isTestCopy && form.owner
                  ? 'Test copy: forms are filled in and sent'
                  : kind.isTestCopy
                    ? 'Only looks: nothing is sent or changed'
                    : 'Live site: only looks, nothing is sent or changed'}
              </Badge>
            </div>
          )}
          {check.state === 'ok' && check.startWarning && (
            <p className="mt-1 text-warn">
              {check.statusCode
                ? `This address answered with a ${check.statusCode}. There may be nothing here to check.`
                : 'This address answered, but not with a page. There may be nothing here to check.'}
            </p>
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

        {consentFlow && (
          <div className="mt-6 rounded-card border border-edge bg-surface p-4">
            <p className="font-bold">Forms are filled in and sent with your sign-in details</p>
            <p className="mt-1 text-sm text-ink-soft">
              You added sign-in details, so the check-up acts as that user. The notice to accept is under “Sign in to
              test pages behind a login”.
            </p>
            {!form.signInConsent && (
              <button type="button" className="btn-link text-sm" onClick={() => reveal(CONSENT_BOX_ID)}>
                Go to the notice
              </button>
            )}
          </div>
        )}

        {kind && !consentFlow && (
          <AccessChoice
            isTestCopyHost={kind.natural}
            form={form}
            onChange={setChoice}
            testCardExtra={hasTestCardExtra ? testCardExtra : undefined}
          />
        )}

        <Disclosure
          className="mt-8"
          summary={
            <h2 className="text-lg font-bold" data-testid="more-options">
              Adjust the check-up
            </h2>
          }
          hint={adjustHint}
        >
          <div className="grid gap-10">
            <OptionGroup title="Pages to explore">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <label htmlFor="max-pages">Explore up to</label>
                <input
                  id="max-pages"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_PAGES_LIMIT}
                  className="field w-28"
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
              </div>
              <p id="max-pages-hint" className="mt-2 text-sm text-ink-soft">
                Pages that share a layout are tested through a few samples, so big sites stay quick.
              </p>
            </OptionGroup>

            <OptionGroup title="Sign in to test pages behind a login">
              <SignInsSection
                form={form}
                saved={remembered?.signIns}
                consentFlow={consentFlow}
                onFormChange={onFormChange}
              />
            </OptionGroup>

            <OptionGroup title="Product context and design notes">
              <div className="space-y-6">
                <p className="text-sm text-ink-soft">
                  The AI plans with these, so the plan tests what the site is meant to do.
                </p>
                <MaterialField
                  id="specs"
                  label="Product context"
                  hint="Notes, requirements or user stories the site must meet, as text."
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
                  placeholder={
                    'For example:\nSign in as a manager, open Reports and check the open invoices are listed.'
                  }
                  value={form.journeys}
                  onChange={(value) => onFormChange((f) => ({ ...f, journeys: value }))}
                />
                <ReferenceDocuments form={form} onFormChange={onFormChange} keyReady={keyReady} />
              </div>
            </OptionGroup>

            <OptionGroup title="Search and AI visibility checks">
              {kind ? (
                <>
                  <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5 shrink-0 accent-stamp"
                      checked={searchChecksOn}
                      onChange={(e) => {
                        const on = e.target.checked;
                        onFormChange((f) => ({
                          ...f,
                          searchChecks: on,
                          visibility: { search: on, answers: on, aiSearch: on, marketing: on },
                        }));
                      }}
                      aria-describedby="search-checks-hint"
                    />
                    <span>
                      <span className="block font-bold text-ink">
                        Look at how search engines and AI assistants find the site
                      </span>
                      <span id="search-checks-hint" className="block text-sm text-ink-soft">
                        {kind.isTestCopy && form.owner
                          ? 'Off by default for test copies on your computer, but you can turn it on any time.'
                          : 'Looks at search tags, what AI assistants can read, and marketing basics.'}
                      </span>
                    </span>
                  </label>
                  {searchChecksOn && (
                    <fieldset className="mt-4 border-t border-rule pt-3">
                      <legend className="sr-only">Choose which to check</legend>
                      <p aria-hidden="true" className="mb-2 font-semibold text-ink">
                        Choose which to check
                      </p>
                      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                        {VISIBILITY_CHECKS.map((v) => (
                          <label key={v.key} className="flex min-h-[44px] cursor-pointer items-start gap-3 py-1">
                            <input
                              type="checkbox"
                              className="mt-1 h-5 w-5 shrink-0 accent-stamp"
                              checked={visibilityOn[v.key]}
                              onChange={(e) => setVisibility({ ...visibilityOn, [v.key]: e.target.checked })}
                            />
                            <span>
                              <span className="block font-semibold text-ink">{v.title}</span>
                              <span className="block text-sm text-ink-soft">{v.hint}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </>
              ) : (
                <p className="text-ink-soft">You can choose these once the address is checked.</p>
              )}
            </OptionGroup>

            {keyReady && (
              <OptionGroup title="AI requests limit" id={AI_LIMIT_ID}>
                {check.state === 'ok' && estimate ? (
                  <AiEstimateLine estimate={estimate} form={form} onFormChange={onFormChange} />
                ) : (
                  <p className="text-ink-soft">
                    How many AI requests the plan needs is shown once the address is checked.
                  </p>
                )}
              </OptionGroup>
            )}

            <OptionGroup title="Details for developers">
              <div className="space-y-6">
                <div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <label htmlFor="test-cap">Test cap</label>
                    <input
                      id="test-cap"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={100000}
                      placeholder="2000"
                      className="field w-28"
                      value={form.testCap}
                      onChange={(e) => onFormChange((f) => ({ ...f, testCap: e.target.value }))}
                      aria-describedby="test-cap-hint"
                    />
                    <span>tests at most</span>
                  </div>
                  <p id="test-cap-hint" className="mt-2 text-sm text-ink-soft">
                    Past this many tests, the rest are switched off in the plan. Leave it empty for 2000.
                  </p>
                </div>

                <fieldset>
                  <legend className="font-semibold text-ink">Exploring speed</legend>
                  <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
                    <div className="flex items-center gap-2">
                      <label htmlFor="crawl-concurrency">Pages at once</label>
                      <input
                        id="crawl-concurrency"
                        type="number"
                        min={1}
                        max={5}
                        className="field w-20"
                        value={form.crawlConcurrency}
                        onChange={(e) => {
                          const val = Math.max(1, Math.min(5, Number(e.target.value) || 2));
                          onFormChange((f) => ({ ...f, crawlConcurrency: val }));
                        }}
                      />
                      <span className="text-sm text-ink-soft">1 to 5</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label htmlFor="crawl-delay">Wait between pages</label>
                      <input
                        id="crawl-delay"
                        type="number"
                        min={0}
                        max={2000}
                        step={50}
                        className="field w-28"
                        value={form.crawlDelayMs}
                        onChange={(e) => {
                          const val = Math.max(0, Math.min(2000, Number(e.target.value) || 0));
                          onFormChange((f) => ({ ...f, crawlDelayMs: val }));
                        }}
                      />
                      <span className="text-sm text-ink-soft">ms, 0 to 2000</span>
                    </div>
                  </div>
                </fieldset>

                <div>
                  <label htmlFor={HEADERS_ID} className="block font-semibold text-ink">
                    Custom headers
                  </label>
                  <p id="custom-headers-hint" className="text-sm text-ink-soft">
                    For sites behind bot protection: headers sent with every request, such as an allowlist token.
                  </p>
                  <textarea
                    id={HEADERS_ID}
                    rows={2}
                    aria-describedby="custom-headers-hint"
                    aria-invalid={headerErrors.length > 0}
                    placeholder="X-QA-Bypass-Token: your-token&#10;User-Agent: MyCustomAgent"
                    className="field mt-2 w-full font-mono text-sm"
                    value={form.customHeaders}
                    onChange={(e) => onFormChange((f) => ({ ...f, customHeaders: e.target.value }))}
                  />
                  {headerErrors.map((err, idx) => (
                    <p key={idx} role="alert" className="mt-1 text-sm text-fail">
                      {err}
                    </p>
                  ))}
                </div>
              </div>
            </OptionGroup>
          </div>
        </Disclosure>
      </form>

      {ai && !keyReady && (
        <Disclosure className="mt-8" summary="Connect the AI for a smarter plan" hint="Optional">
          <p className="mb-4 text-sm text-ink-soft">
            Without it, fixed rules write the plan and you can start now. With it, the AI writes a plan that fits your
            site. It uses your own AI key, and Settings lets you pick the service.
            {' What you send may be kept and used to learn when the key is a free one (Settings explains). '}
            You only do this once, and anything you typed above is kept.
          </p>
          <KeyField
            primary={false}
            onSaved={(model) => {
              setKeyJustSaved(true);
              onKeySaved(model);
            }}
          />
        </Disclosure>
      )}
      {keyJustSaved && keyReady && (
        <div className="mt-8">
          <Notice tone="pass" title="The AI is connected.">
            You can change the key any time in Settings.
          </Notice>
        </div>
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

      {estimateShort && !form.planWithoutAI && (
        <p className="mt-6 text-sm text-warn">
          Fewer AI requests are left today than the plan may need. Past that, fixed rules plan the rest.{' '}
          <button type="button" className="btn-link text-sm" onClick={() => reveal(AI_LIMIT_ID)}>
            See the AI requests limit
          </button>
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="submit"
          form="new-checkup-form"
          className="btn-primary"
          disabled={starting || !canStart}
          aria-describedby={blockedHint ? 'scan-blocked-hint' : 'start-hint'}
        >
          {starting ? <Spinner label="Starting…" announce={false} /> : 'Start the check-up'}
        </button>
        {blockedHint ? (
          <p id="scan-blocked-hint" role="alert" className="text-sm font-semibold text-warn">
            {blockedHint}
            {', under “Sign in to test pages behind a login”. '}
            <button type="button" className="btn-link text-sm" onClick={() => reveal(CONSENT_BOX_ID)}>
              Go to the box
            </button>
          </p>
        ) : startOffReason ? (
          <p id="start-hint" className="text-sm text-ink-soft">
            {startOffReason}
            {headerErrors.length > 0 && check.state === 'ok' && ai !== null && !needsProdConfirmation && (
              <>
                {' '}
                <button type="button" className="btn-link text-sm" onClick={() => reveal(HEADERS_ID)}>
                  Go to the headers
                </button>
              </>
            )}
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

      {recent && recent.length > 0 && (
        <section aria-labelledby="recent-title" className="mt-16">
          <h2 id="recent-title" className="mb-3 text-xl font-bold">
            Recent check-ups
          </h2>
          <ul className="divide-y divide-rule rounded-card border border-rule bg-surface">
            {recent.slice(0, 5).map((run) => (
              <li key={run.runId}>
                <Link
                  to={PATHS.report(run.runId)}
                  className="flex min-h-[48px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 transition-colors duration-fast hover:bg-canvas"
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
    </Page>
  );
}

const VISIBILITY_CHECKS: Array<{ key: keyof Visibility; title: string; hint: string }> = [
  { key: 'search', title: 'Search engines', hint: 'Titles, descriptions, headings, robots and sitemap' },
  { key: 'answers', title: 'AI answers', hint: 'Question-and-answer markup that AI assistants read' },
  { key: 'aiSearch', title: 'AI search', hint: 'A guide file for AI assistants, whether they may visit, and sources' },
  { key: 'marketing', title: 'Marketing basics', hint: 'Share previews, picture, call to action, contact and privacy' },
];

/** One flat, headed group inside "Adjust the check-up". */
function OptionGroup({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} tabIndex={id ? -1 : undefined} aria-label={title} className="outline-none">
      <h3 className="mb-3 text-lg font-bold">{title}</h3>
      {children}
    </section>
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
      className="mb-10 flex flex-wrap items-center justify-between gap-3 rounded-card border border-stamp/40 bg-stamp-tint px-5 py-4"
    >
      <p className="font-bold text-ink">{card.text}</p>
      <Link to={card.to} className="btn-quiet btn-sm">
        {card.action} <span aria-hidden="true">→</span>
      </Link>
    </aside>
  );
}

/** The label that opens a file picker: keyboard users see where focus is. */
const FILE_LABEL =
  'inline-flex min-h-[44px] cursor-pointer items-center rounded-control text-sm font-bold text-stamp underline underline-offset-4 hover:text-stamp-dark focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-stamp';

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
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <label htmlFor={id} className="font-bold">
          {label}
        </label>
        <label className={FILE_LABEL}>
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
        className="field"
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
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <span className="font-bold">Product context files</span>
        <label className={FILE_LABEL}>
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
              <span className="break-all font-mono text-ink">{file.name}</span>
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
      <div>
        <label htmlFor="context-url" className="mb-1 block font-bold">
          Docs address <span className="font-normal text-ink-soft">Optional</span>
        </label>
        <input
          id="context-url"
          type="url"
          className="field"
          placeholder="https://docs.example.com/guide"
          value={form.contextUrl}
          onChange={(e) => onFormChange((f) => ({ ...f, contextUrl: e.target.value }))}
          aria-describedby="context-url-hint"
        />
        <p id="context-url-hint" className="mt-1 text-sm text-ink-soft">
          Up to 20 pages on that site are read. Pages that need a sign-in are skipped.
        </p>
      </div>
    </div>
  );
}

type Access = 'look' | 'live' | 'test';

/**
 * One question for what the check-up may do. On an address that is a test copy by nature (this
 * computer, a private network), two answers; on a live-looking one, three. Each answer is a card;
 * anything the chosen "test" answer still needs (a confirmation, the Verified Domain line) sits in its card.
 */
function AccessChoice({
  isTestCopyHost,
  form,
  onChange,
  testCardExtra,
}: {
  isTestCopyHost: boolean;
  form: CheckupForm;
  onChange: (change: Partial<Pick<CheckupForm, 'owner' | 'markedTestCopy'>>) => void;
  testCardExtra?: ReactNode;
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
    <fieldset className="mt-6">
      <legend className="label">What may the check-up do?</legend>
      <div className="grid gap-3">
        {options.map((o) => {
          const chosen = access === o.id;
          return (
            <div
              key={o.id}
              className={`rounded-card border bg-surface transition-colors duration-fast focus-within:ring-2 focus-within:ring-stamp/30 ${
                chosen ? 'border-ink' : 'border-edge hover:border-ink-soft'
              }`}
            >
              <label className="flex min-h-[44px] cursor-pointer items-start gap-3 p-4">
                <input
                  type="radio"
                  name="access"
                  className="mt-1 h-5 w-5 shrink-0 accent-stamp"
                  checked={chosen}
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
              {chosen && o.id === 'test' && testCardExtra && (
                <div className="space-y-4 border-t border-rule px-4 pb-4 pt-3">{testCardExtra}</div>
              )}
            </div>
          );
        })}
      </div>
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
  const run = async () => {
    setBusy(true);
    setProblem(null);
    try {
      setStatus(await checkDomainProof(url));
    } catch (err) {
      setProblem(err instanceof RunnerError ? err.message : 'The Verified Domain line couldn’t be checked.');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    setStatus(null);
    void run();
  }, [url]);

  if (status && (!status.required || status.verified)) {
    return status.verified && status.required ? (
      <p className="text-sm text-pass">Verified Domain: the line was found, so this test copy can be tested fully.</p>
    ) : null;
  }
  return (
    <div role="region" aria-label="Verified Domain">
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
      {problem && (
        <p role="alert" className="mt-2 text-sm text-fail">
          {problem}
        </p>
      )}
      <button type="button" className="btn-link mt-2 text-sm" disabled={busy} onClick={() => void run()}>
        {busy ? 'Checking…' : 'Check again'}
      </button>
    </div>
  );
}

/** A sign-in row that sets more than the username and password, so only the full rows can show it. */
function hasRowDetails(s: SignInEntry | undefined): boolean {
  return (
    !!s &&
    !!(
      s.role.trim() ||
      s.loginPath.trim() ||
      s.usernameSelector?.trim() ||
      s.passwordSelector?.trim() ||
      s.submitSelector?.trim()
    )
  );
}

/**
 * Sign-ins to explore and test the signed-in pages with, from the start: one or more roles. Either the
 * quick username and password, or the full rows (role, sign-in page...): never both for the same sign-in.
 * The consent notice sits right after the fields it is about.
 */
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
  const [detailed, setDetailed] = useState(false);
  const rows = detailed || form.signIns.length > 1 || hasRowDetails(form.signIns[0]);
  const set = (i: number, change: Partial<SignInEntry>) =>
    onFormChange((f) => ({ ...f, signIns: f.signIns.map((s, n) => (n === i ? { ...s, ...change } : s)) }));
  return (
    <div className="space-y-4">
      <p className="text-ink-soft">
        The check-up signs in as each role and explores what it sees, so pages behind the sign-in are planned and tested
        too.
      </p>
      {rows ? (
        form.signIns.map((s, i) => (
          <SignInRow
            key={i}
            value={s}
            legend={`Sign-in ${i + 1}`}
            rolePlaceholder={i === 0 ? 'member' : 'admin'}
            onChange={(patch) => set(i, patch)}
            onRemove={() => {
              setDetailed(true);
              onFormChange((f) => ({ ...f, signIns: f.signIns.filter((_, n) => n !== i) }));
            }}
          />
        ))
      ) : (
        <SignInFields form={form} onFormChange={onFormChange} />
      )}
      {consentFlow && <ConsentNotice form={form} onFormChange={onFormChange} />}
      {!!saved?.length && (
        <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 shrink-0 accent-stamp"
            checked={form.useSavedSignIns}
            onChange={(e) => onFormChange((f) => ({ ...f, useSavedSignIns: e.target.checked }))}
          />
          <span>Sign in as saved for this site: {saved.map((s) => `${s.role} (${s.username})`).join(', ')}</span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          className="btn-quiet btn-sm"
          onClick={() => {
            setDetailed(true);
            onFormChange((f) => ({
              ...f,
              signIns: rows || f.signIns.length > 0 ? [...f.signIns, { ...EMPTY_SIGN_IN }] : [{ ...EMPTY_SIGN_IN }],
            }));
          }}
        >
          {!rows
            ? 'Add a role or another sign-in'
            : form.signIns.length === 0
              ? 'Add a sign-in'
              : 'Add another sign-in'}
        </button>
        <ImportRoles onFormChange={onFormChange} />
      </div>
      <SavedSessions form={form} onFormChange={onFormChange} />
      {form.signIns.length > 0 && (
        <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 shrink-0 accent-stamp"
            checked={rememberSignInsOf(form, consentFlow)}
            onChange={(e) => onFormChange((f) => ({ ...f, rememberSignIns: e.target.checked, rememberTouched: true }))}
          />
          <span>Remember these sign-ins for this site (passwords are kept in this computer’s keychain)</span>
        </label>
      )}
    </div>
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
    <div className="w-full space-y-2 rounded-card border border-rule p-4">
      <label htmlFor="import-roles" className="block font-bold">
        Roles to import
      </label>
      <textarea
        id="import-roles"
        className="field font-mono text-sm"
        rows={4}
        autoComplete="off"
        spellCheck={false}
        placeholder="role,username,password"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-describedby="import-roles-hint"
      />
      <p id="import-roles-hint" className="text-sm text-ink-soft">
        One role per line: role,username,password. Used for this check-up only; nothing is saved from here.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" className="btn-quiet btn-sm" disabled={!text.trim()} onClick={() => apply(text)}>
          Fill in roles
        </button>
        <label className={FILE_LABEL}>
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
        <p role="status" className="text-sm">
          {note}
        </p>
      )}
    </div>
  );
}

/** The quick username and password: the first sign-in (role `member` unless named). */
function SignInFields({
  form,
  onFormChange,
}: {
  form: CheckupForm;
  onFormChange: (update: (form: CheckupForm) => CheckupForm) => void;
}) {
  const first = primarySignInOf(form);
  const set = (change: Partial<SignInEntry>) =>
    onFormChange((f) => {
      const signIns = f.signIns.length > 0 ? f.signIns : [{ ...EMPTY_SIGN_IN }];
      return { ...f, signIns: signIns.map((s, n) => (n === 0 ? { ...s, ...change } : s)) };
    });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor="sign-in-username" className="mb-1 block font-bold">
          Email or username
        </label>
        <input
          id="sign-in-username"
          className="field"
          autoComplete="off"
          spellCheck={false}
          value={first.username}
          onChange={(e) => set({ username: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor="sign-in-password" className="mb-1 block font-bold">
          Password
        </label>
        <input
          id="sign-in-password"
          className="field"
          type="password"
          autoComplete="off"
          value={first.password}
          onChange={(e) => set({ password: e.target.value })}
        />
      </div>
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
    <div className="rounded-card border border-warn/40 bg-warn-tint px-4 py-3" data-testid="sign-in-consent">
      <p className="font-bold text-warn">Fill in and send forms with these sign-in details</p>
      <p className="mt-1 text-sm text-ink">
        The check-up will fill in and send forms on this App with these sign-in details. Sensitive Actions, such as
        deleting or paying, are skipped.
      </p>
      <label className="mt-2 flex min-h-[44px] cursor-pointer items-start gap-3">
        <input
          id={CONSENT_BOX_ID}
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0 accent-stamp"
          checked={form.signInConsent}
          onChange={(e) => onFormChange((f) => ({ ...f, signInConsent: e.target.checked }))}
        />
        <span className="font-bold">I accept this</span>
      </label>
      <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0 accent-stamp"
          checked={form.reviewFirst}
          onChange={(e) => onFormChange((f) => ({ ...f, reviewFirst: e.target.checked }))}
        />
        <span>Let me review the plan before testing starts</span>
      </label>
      <button type="button" className="btn-link text-sm" onClick={() => onFormChange(lookOnly)}>
        Only look at it instead: nothing is sent or changed
      </button>
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
    <div className="space-y-2 border-t border-rule pt-4">
      <p className="font-bold">
        Use a saved session instead of a password <span className="font-normal text-ink-soft">Optional</span>
      </p>
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
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div>
          <label htmlFor="saved-session-role" className="mb-1 block text-sm font-bold">
            Role name
          </label>
          <input
            id="saved-session-role"
            className="field w-48"
            value={role}
            placeholder="admin"
            onChange={(e) => setRole(e.target.value)}
          />
        </div>
        <label className={FILE_LABEL}>
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
 * a limit, and the choice to plan with fixed rules now and re-plan with the AI later.
 */
function AiEstimateLine({
  estimate,
  form,
  onFormChange,
}: {
  estimate: AiEstimate;
  form: CheckupForm;
  onFormChange: (update: (form: CheckupForm) => CheckupForm) => void;
}) {
  const needed = estimate.low === estimate.high ? `${estimate.low}` : `${estimate.low} to ${estimate.high}`;
  const short = estimate.left !== null && estimate.left < estimate.high;
  const leftText =
    estimate.left !== null
      ? `You have ${estimate.left} left today${estimate.limit !== null ? ` of ${estimate.limit}` : ''}.`
      : estimate.free
        ? ''
        : 'Your AI account is charged for them.';
  return (
    <div className="space-y-3">
      <p className="text-ink">
        Planning needs about {needed} AI requests{estimate.seenBefore ? ' (fewer where the site hasn’t changed)' : ''},
        and looking over the screens afterwards up to {estimate.visualReview} more. {leftText}
      </p>
      {short && (
        <p className="text-warn">
          Past that, fixed rules plan the rest. You can re-plan any part with the AI once requests are available again.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div>
          <label htmlFor="cap-requests" className="mb-1 block font-bold">
            Limit AI requests <span className="font-normal text-ink-soft">Optional</span>
          </label>
          <input
            id="cap-requests"
            type="number"
            min={1}
            className="field w-32"
            value={form.capRequests}
            onChange={(e) => onFormChange((f) => ({ ...f, capRequests: e.target.value }))}
          />
        </div>
        {estimate.estimatedUsd != null && (
          <div>
            <label htmlFor="cap-dollars" className="mb-1 block font-bold">
              Limit spend in dollars <span className="font-normal text-ink-soft">Optional</span>
            </label>
            <input
              id="cap-dollars"
              type="number"
              min={0}
              step="0.01"
              className="field w-32"
              value={form.capDollars}
              onChange={(e) => onFormChange((f) => ({ ...f, capDollars: e.target.value }))}
            />
          </div>
        )}
      </div>
      <p className="text-sm text-ink">{capLine(estimate, capOf(form))}</p>
      <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0 accent-stamp"
          checked={form.planWithoutAI}
          onChange={(e) => onFormChange((f) => ({ ...f, planWithoutAI: e.target.checked }))}
        />
        <span>Plan with fixed rules now, using no AI requests, and re-plan with the AI later</span>
      </label>
    </div>
  );
}
