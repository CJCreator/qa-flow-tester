import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Breakpoint, PlanIntent, ReviewPlan, RoleCredential } from '@qa/types';
import { withIntentSwitched } from '../lib/intent-view';
import { SiteMap } from '../components/SiteMap';
import { Notice, Spinner } from '../components/text';
import { BottomActionBar, Disclosure, Page, PageHeader } from '../components/ui';
import { count } from '../lib/format';
import { siteTypeName } from '../lib/translate';
import { SIGN_IN_AGAIN_TEXT } from '../lib/form';
import { useDocumentTitle } from '../lib/title';
import { PlanDocument, type PlanActions } from '../components/plan/PlanDocument';
import { showItem } from '../components/plan/parts';
import {
  addPageToPlan,
  addSignInToPlan,
  applyPlanChange,
  downloadPlanMarkdown,
  downloadPlaywrightExport,
  includeHostInPlan,
  interpretSentence,
  patchPlan,
  replanEverything,
  replanItem,
  type PlanDelta,
} from '../api';
import type { ConfirmOptions } from '../components/ConfirmDialog';
import type { PlanNotice, PlanUpdateState } from '../lib/run-events';

export type { PlanNotice, PlanUpdateState } from '../lib/run-events';

/** How long a background change may be waited for before the plan can be approved again. */
export const PENDING_TIMEOUT_MS = 60_000;

export interface PlanReviewScreenProps {
  plan: ReviewPlan;
  /** Roles are the sign-in typed again, when the saved plan's details were forgotten. */
  onApprove: (roles?: RoleCredential[]) => void;
  /** The plan was saved with test sign-in consent but the details are gone: ask for them again. */
  needsSignIn?: boolean | string[];
  onPlanUpdated: (plan: ReviewPlan) => void;
  update: PlanUpdateState;
  approveError?: string | null;
  approving?: boolean;
  notice?: PlanNotice | null;
  /** Asks before something that can't be undone. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

/**
 * The plan as the person sees it: switches they just flipped show at once, before Release check-up has
 * saved them. An item's `skipped` comes from `switched`; the screen sizes from `sizes`.
 */
function withChanges(plan: ReviewPlan, switched: Record<string, boolean>, sizes: Breakpoint[] | null): ReviewPlan {
  if (Object.keys(switched).length === 0 && !sizes) return plan;
  const skip = <T extends { id: string; skipped?: boolean }>(item: T): T =>
    item.id in switched ? { ...item, skipped: switched[item.id] } : item;
  return {
    ...plan,
    screenSizes: sizes ?? plan.screenSizes,
    planPages: plan.planPages?.map((p) => skip({ ...p, tests: p.tests.map(skip) })),
    navigation: plan.navigation?.map(skip),
    flows: plan.flows.map((f) =>
      `journey:${f.id}` in switched ? { ...f, outOfScope: switched[`journey:${f.id}`] || undefined } : f
    ),
  };
}

const TABS = [
  ['plan', 'Plan'],
  ['map', 'Site map'],
] as const;

/** The one label for approving; phones show a shorter one. */
const APPROVE_LABEL = 'Approve the plan and start testing';

/**
 * The Plan Review. Leaving it keeps the plan waiting (the new check-up screen offers it again), so
 * there's no Back here that could throw it away.
 */
export function PlanReviewScreen({
  plan,
  onApprove,
  needsSignIn = false,
  onPlanUpdated,
  update,
  approveError,
  approving = false,
  notice,
  confirm,
}: PlanReviewScreenProps) {
  const [tab, setTab] = useState<'plan' | 'map'>(() => {
    try {
      const saved = sessionStorage.getItem('qa-plan-view-tab');
      return saved === 'map' ? 'map' : 'plan';
    } catch {
      return 'plan';
    }
  });

  const selectTab = (next: 'plan' | 'map') => {
    setTab(next);
    try {
      sessionStorage.setItem('qa-plan-view-tab', next);
    } catch {
      // Ignore
    }
  };

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switched, setSwitched] = useState<Record<string, boolean>>({});
  const [sizes, setSizes] = useState<Breakpoint[] | null>(null);
  // The Intents switched off: the Plan's own list, shown at once while a change is saved.
  const [sentOff, setSentOff] = useState<PlanIntent[] | null>(null);
  const [signInReady, setSignInReady] = useState(false);
  const intentsOff = sentOff ?? plan.intentsOff ?? [];
  const shown = useMemo(() => withChanges(plan, switched, sizes), [plan, switched, sizes]);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  // The plan a change is applied to: always the newest one, even when changes come back out of order.
  const latest = useRef(plan);
  latest.current = plan;

  // Pending batched toggles
  const pendingTogglesRef = useRef<Map<string, boolean>>(new Map());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A background change started here waits until Release check-up says it has finished or failed.
  // Any PLAN_UPDATE_* event also ends the wait, and so does a timeout: Approve is never stuck disabled.
  useEffect(() => {
    if (!update.running) setPending(false);
  }, [update.running, update.seq]);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => {
      setPending(false);
      setError('The plan update is taking too long. Check the plan, then try again.');
    }, PENDING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);
  const busy = pending || update.running;

  const edit = async (change: () => Promise<ReviewPlan | PlanDelta>): Promise<boolean> => {
    setError(null);
    try {
      const result = await change();
      onPlanUpdated(applyPlanChange(latest.current, result));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The plan couldn’t be changed. Try again.');
      return false;
    }
  };
  const inBackground = async (start: () => Promise<void>) => {
    setError(null);
    setPending(true);
    try {
      await start();
    } catch (err) {
      setPending(false);
      setError(err instanceof Error ? err.message : 'The plan couldn’t be updated. Try again.');
    }
  };

  /** Saves the queued switches now. True when nothing was queued or the save worked. */
  const flushToggles = async (): Promise<boolean> => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (pendingTogglesRef.current.size === 0) return true;
    const items = Array.from(pendingTogglesRef.current.entries()).map(([id, skipped]) => ({ id, skipped }));
    pendingTogglesRef.current.clear();
    const affectedIds = items.map((i) => i.id);
    const ok = await edit(() => patchPlan({ items }));
    if (!ok) {
      setError('That change wasn’t saved, so it’s back as it was. Try it again.');
    }
    setSwitched((s) => Object.fromEntries(Object.entries(s).filter(([id]) => !affectedIds.includes(id))));
    return ok;
  };

  /** Approves only after every switch is saved: an unsaved switch-off would still run. */
  const approve = async (roles?: RoleCredential[]) => {
    if (!(await flushToggles())) return;
    onApprove(roles);
  };

  const switchItems = (ids: string[], skipped: boolean) => {
    // 1. Optimistic UI update immediately
    setSwitched((s) => ({ ...s, ...Object.fromEntries(ids.map((id) => [id, skipped])) }));

    // 2. Add to batch queue
    ids.forEach((id) => pendingTogglesRef.current.set(id, skipped));

    // 3. Clear existing debounce timer and schedule flush
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      void flushToggles();
    }, 300);
  };

  useEffect(() => {
    return () => {
      void flushToggles();
    };
  }, []);

  const budget = plan.budget;
  const actions: PlanActions = {
    busy,
    // Shown at once; kept until the saved plan comes back, or undone if saving fails.
    setSkipped: (id, skipped) => switchItems([id], skipped),
    setSkippedMany: switchItems,
    replan: (id, instructions) => void inBackground(() => replanItem(id, instructions)),
    promote: (id) => void inBackground(() => replanItem(id, undefined, true)),
    addPage: async (address) => {
      setError(null);
      setPending(true);
      try {
        await addPageToPlan(address);
      } catch (err) {
        setPending(false);
        throw err;
      }
    },
    includeHost: (host) => void inBackground(() => includeHostInPlan(host)),
    answer: (questionId, answer) => void edit(() => patchPlan({ answers: { [questionId]: answer } })),
    setScreenSizes: (chosen) => {
      setSizes(chosen);
      void edit(() => patchPlan({ screenSizes: chosen })).finally(() => setSizes(null));
    },
    replanEverything: () => {
      void (async () => {
        const tested = (plan.planPages || []).filter((p) => p.coverage !== 'covered').length;
        const about = Math.ceil(tested / 3) + 2;
        const ok = await confirm({
          title: 'Re-plan everything with the AI?',
          body: (
            <p>
              The AI plans every page, link and journey again, which takes about {about} AI requests
              {budget?.left !== undefined ? ` (you have ${budget.left} left today)` : ''}. What you switched off stays
              off, but changes you made to tests and journeys are replaced.
            </p>
          ),
          confirmLabel: 'Re-plan everything',
          cancelLabel: 'Keep the plan',
          danger: true,
        });
        if (ok) void inBackground(() => replanEverything());
      })().catch((err: unknown) => console.error(err));
    },
    saveDocsAndReplan: async (productContext, designNotes) => {
      await edit(() => patchPlan({ productContext, designNotes }));
      await inBackground(() => replanEverything(productContext));
    },
    describeTest: (sentence, urlPath) => interpretSentence({ sentence, urlPath }),
    addJourney: async (flow) => {
      // Read the latest list when the change is made, not the list of the render that created this handler.
      await edit(() => patchPlan({ flows: [...latest.current.flows, flow] }));
    },
    reorderJourneys: async (fromIndex: number, toIndex: number) => {
      const currentFlows = latest.current.flows;
      if (fromIndex < 0 || fromIndex >= currentFlows.length || toIndex < 0 || toIndex >= currentFlows.length) return;
      const reordered = [...currentFlows];
      const [removed] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, removed);
      await edit(() => patchPlan({ flows: reordered }));
    },
    renameJourney: async (flowId: string, newName: string) => {
      const currentFlows = latest.current.flows;
      const updated = currentFlows.map((f) => (f.id === flowId ? { ...f, name: newName } : f));
      await edit(() => patchPlan({ flows: updated }));
    },
    setExpectation: (itemId, text) => void edit(() => patchPlan({ expectations: [{ id: itemId, text }] })),
    addSignIn: async (signIn) => {
      setError(null);
      setPending(true);
      try {
        await addSignInToPlan(signIn);
      } catch (err) {
        setPending(false);
        throw err;
      }
    },
    quickCheck: () => void edit(() => patchPlan({ preset: 'quick' })),
    intentsOff,
    setIntentOff: (intent, off) => {
      const next = withIntentSwitched(intentsOff, intent, off);
      setSentOff(next);
      void edit(() => patchPlan({ intentsOff: next })).finally(() => setSentOff(null));
    },
    editSource: (edits) => void edit(() => patchPlan({ sourceEdits: edits })),
    editNotFound: (edits) => void edit(() => patchPlan({ notFoundEdits: edits })),
  };

  // The site's real links, for the map.
  const links = useMemo(
    () =>
      plan.pages.flatMap((p) =>
        (p.links || []).filter((l) => !l.leavesSite).map((l) => ({ from: p.urlPath, to: l.landsOn ?? l.to }))
      ),
    [plan.pages]
  );

  let host = plan.targetUrl;
  try {
    host = new URL(plan.targetUrl).host;
  } catch {
    // keep the address as it is
  }
  const lines = plan.summary?.lines || [];
  const tests = plan.summary?.tests;
  const minutes = plan.summary?.minutes;
  useDocumentTitle(`Plan for ${host}`);

  const moveTab = (from: 'plan' | 'map', by: number) => {
    const i = TABS.findIndex(([id]) => id === from);
    const next = TABS[(i + by + TABS.length) % TABS.length][0];
    selectTab(next);
    tabRefs.current[next]?.focus();
  };

  let panel: ReactNode;
  if (tab === 'plan') panel = <PlanDocument plan={shown} actions={actions} />;
  else
    panel = (
      <div className="flex h-[70vh]">
        <SiteMap
          pages={plan.pages}
          flows={plan.flows}
          mode="plan"
          links={links}
          maxCards={12}
          onSelectPage={(urlPath) => {
            selectTab('plan');
            window.setTimeout(() => showItem(`page:${urlPath}`), 60);
          }}
        />
      </div>
    );

  const pageCount = plan.planPages?.length ?? plan.pages.length;
  const about = `${count(pageCount, 'page', 'pages')}, ${count(plan.navigation?.length ?? 0, 'link', 'links')} and ${count(plan.flows.length, 'journey', 'journeys')}.`;
  const signingIn = !!needsSignIn;
  // Why Approve can't be pressed right now, said next to it.
  const approveOff = plan.noTests
    ? 'Nothing in the plan runs yet, so there is nothing to approve.'
    : busy
      ? 'Approve waits until the plan is updated.'
      : null;
  const editError = update.error || error;
  // The sign-in form already says why it's there: the same sentence isn't shown twice.
  const shownApproveError = signingIn && approveError === SIGN_IN_AGAIN_TEXT ? null : approveError;

  return (
    <Page width="workspace">
      <PageHeader
        title={<span className="break-words">Review the plan for {host}</span>}
        lede={
          <p className="text-base">
            {plan.siteType ? `${siteTypeName(plan.siteType)}, with ${about}` : about} Nothing runs until you approve.
          </p>
        }
        actions={
          <div role="tablist" aria-label="How to show the plan" className="segmented">
            {TABS.map(([id, name]) => (
              <button
                key={id}
                ref={(el) => {
                  tabRefs.current[id] = el;
                }}
                type="button"
                role="tab"
                id={`plan-tab-${id}`}
                aria-controls="plan-tabpanel"
                aria-selected={tab === id}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => selectTab(id)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    moveTab(id, 1);
                  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    moveTab(id, -1);
                  }
                }}
                className="min-h-[44px]"
              >
                {name}
              </button>
            ))}
          </div>
        }
      />
      {notice && (
        <div className="mb-6">
          <Notice tone={notice.tone} title={notice.title}>
            {notice.body}
          </Notice>
        </div>
      )}
      {plan.noTests && (
        <div className="mb-6">
          <Notice tone="warn" title="Nothing to test">
            {plan.noTests}
          </Notice>
        </div>
      )}

      <div role="tabpanel" id="plan-tabpanel" aria-labelledby={`plan-tab-${tab}`} className="[overflow-wrap:anywhere]">
        {panel}
      </div>

      <PlanFile />

      <BottomActionBar
        summary={
          <div className="grid gap-1">
            {busy && (
              <p className="flex items-center gap-2 font-bold text-stamp">
                <Spinner label={`Updating the plan: ${update.step || update.what || 'starting'}…`} />
              </p>
            )}
            {editError && (
              <p role="alert" className="font-bold text-fail">
                {editError}
              </p>
            )}
            {shownApproveError && (
              <p role="alert" className="font-bold text-fail">
                {shownApproveError}
              </p>
            )}
            {signingIn ? (
              <SignInAgain
                needsSignIn={needsSignIn}
                onReadyChange={setSignInReady}
                onSubmit={(roles) => void approve(roles)}
              />
            ) : (
              <>
                <p className="font-bold text-ink">
                  {/* Phones: just the count. The full line is in “What approving runs”, and the bar stays short. */}
                  <span className="sm:hidden">
                    {tests !== undefined ? count(tests, 'test', 'tests') : (lines[0]?.text ?? 'Ready to test')}
                  </span>
                  <span className="hidden sm:inline">
                    {lines[0]?.text ?? (tests !== undefined ? count(tests, 'test', 'tests') : 'Ready to test')}
                  </span>
                  {minutes ? <span className="font-normal text-ink-soft">, about {minutes} min</span> : null}
                </p>
                {approving ? (
                  <p role="status">Starting the tests…</p>
                ) : (
                  approveOff && <p id="approve-off-reason">{approveOff}</p>
                )}
              </>
            )}
          </div>
        }
      >
        {signingIn ? (
          <button
            type="submit"
            form="plan-sign-in-again"
            className="btn-primary"
            disabled={busy || approving || !signInReady}
            aria-describedby={signInReady ? undefined : 'sign-in-again-reason'}
          >
            {approving ? <Spinner label="Starting the tests…" /> : 'Approve with these details'}
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary shrink-0"
            disabled={busy || approving || !!plan.noTests}
            aria-describedby={approveOff && !approving ? 'approve-off-reason' : undefined}
            onClick={() => void approve()}
          >
            {approving ? (
              <Spinner label="Starting the tests…" />
            ) : (
              <>
                <span className="sm:hidden">Approve and test</span>
                <span className="hidden sm:inline">{APPROVE_LABEL}</span>
              </>
            )}
          </button>
        )}
      </BottomActionBar>
    </Page>
  );
}

/** The plan as a file: a readable copy, and for developers a Playwright project. Quiet, at the end. */
function PlanFile() {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (download: () => Promise<unknown>, done: string) => {
    setStatus(null);
    download()
      .then(() => setStatus({ ok: true, text: done }))
      .catch((err: unknown) =>
        setStatus({
          ok: false,
          text: `${err instanceof Error ? err.message : 'The file couldn’t be downloaded.'} Try again.`,
        })
      );
  };
  return (
    <Disclosure summary="Plan file" hint="Download the plan or export it" className="mt-12">
      <div className="grid gap-4">
        <div>
          <button
            type="button"
            className="btn-quiet btn-sm"
            onClick={() => run(downloadPlanMarkdown, 'Plan downloaded.')}
          >
            Download the plan
          </button>
          <p className="hint mt-1 text-sm">A readable copy of everything above.</p>
        </div>
        <Disclosure summary="Details for developers">
          <button
            type="button"
            className="btn-quiet btn-sm"
            onClick={() => run(downloadPlaywrightExport, 'Playwright tests downloaded.')}
          >
            Export as Playwright tests
          </button>
          <p className="hint mt-1 text-sm">The plan as a Playwright project you can run in your own pipeline.</p>
        </Disclosure>
        {status && (
          <p role={status.ok ? 'status' : 'alert'} className={`text-sm ${status.ok ? 'text-pass' : 'text-fail'}`}>
            {status.text}
          </p>
        )}
      </div>
    </Disclosure>
  );
}

/** The sign-in fields shown again at approval. Typed values live here only and are cleared once sent. */
function SignInAgain({
  needsSignIn,
  onReadyChange,
  onSubmit,
}: {
  needsSignIn?: boolean | string[];
  /** Whether every field is filled in: the bar's Approve button waits for it. */
  onReadyChange: (ready: boolean) => void;
  onSubmit: (roles: RoleCredential[]) => void;
}) {
  const pendingRoles = Array.isArray(needsSignIn) && needsSignIn.length > 0 ? needsSignIn : ['member'];
  const [roleInputs, setRoleInputs] = useState<Record<string, { username: string; password: string }>>({});

  const allRoles: RoleCredential[] = pendingRoles
    .map((role) => ({
      role,
      username: (roleInputs[role]?.username || '').trim(),
      password: roleInputs[role]?.password || '',
    }))
    .filter((r) => r.username && r.password);

  const canSubmit = allRoles.length === pendingRoles.length && allRoles.length > 0;
  useEffect(() => onReadyChange(canSubmit), [canSubmit, onReadyChange]);

  return (
    <form
      id="plan-sign-in-again"
      className="grid gap-3 text-base text-ink"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit(allRoles);
        setRoleInputs({});
      }}
    >
      <p className="font-bold">{SIGN_IN_AGAIN_TEXT}</p>
      {pendingRoles.map((role) => (
        <fieldset key={role} className="grid gap-3 sm:grid-cols-2">
          {pendingRoles.length > 1 && <legend className="mb-1 text-sm font-bold">Role: {role}</legend>}
          <label className="block">
            <span className="label text-sm">Sign-in username</span>
            <input
              className="field py-2"
              autoComplete="off"
              value={roleInputs[role]?.username || ''}
              onChange={(e) =>
                setRoleInputs((prev) => ({
                  ...prev,
                  [role]: { ...prev[role], username: e.target.value, password: prev[role]?.password || '' },
                }))
              }
            />
          </label>
          <label className="block">
            <span className="label text-sm">Sign-in password</span>
            <input
              className="field py-2"
              type="password"
              autoComplete="off"
              value={roleInputs[role]?.password || ''}
              onChange={(e) =>
                setRoleInputs((prev) => ({
                  ...prev,
                  [role]: { ...prev[role], password: e.target.value, username: prev[role]?.username || '' },
                }))
              }
            />
          </label>
        </fieldset>
      ))}
      {!canSubmit && (
        <p id="sign-in-again-reason" className="text-sm text-ink-soft">
          Fill in every field to approve.
        </p>
      )}
    </form>
  );
}
