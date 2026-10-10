import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Breakpoint, ReviewPlan, RoleCredential } from '@qa/types';
import { SiteMap } from '../components/SiteMap';
import { FocusHeading, Notice, Spinner } from '../components/text';
import { count } from '../lib/format';
import { approveRolesOf } from '../lib/form';
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
import { Link, PATHS } from '../lib/router';
import type { ConfirmOptions } from '../components/ConfirmDialog';

/** A background change to the plan (re-planning, adding pages), as the QA Tool reports it. */
export interface PlanUpdateState {
  running: boolean;
  what?: string;
  step?: string;
  error?: string | null;
}

/** A banner over the plan: testing stopped or failed, or the site changed since the plan was approved. */
export interface PlanNotice {
  tone: 'fail' | 'warn' | 'stamp';
  title: string;
  body?: string;
}

export interface PlanReviewScreenProps {
  plan: ReviewPlan;
  /** Roles are the sign-in typed again, when the saved plan's details were forgotten. */
  onApprove: (roles?: RoleCredential[]) => void;
  /** The plan was saved with test sign-in consent but the details are gone: ask for them again. */
  needsSignIn?: boolean;
  onPlanUpdated: (plan: ReviewPlan) => void;
  update: PlanUpdateState;
  approveError?: string | null;
  approving?: boolean;
  notice?: PlanNotice | null;
  /** Asks before something that can't be undone. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

/**
 * The plan as the person sees it: switches they just flipped show at once, before the QA Tool has
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
  ['plan', 'Full plan'],
  ['map', 'Map'],
] as const;

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
  const [barOpen, setBarOpen] = useState(false);
  const shown = useMemo(() => withChanges(plan, switched, sizes), [plan, switched, sizes]);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  // The plan a change is applied to: always the newest one, even when changes come back out of order.
  const latest = useRef(plan);
  latest.current = plan;

  // Pending batched toggles
  const pendingTogglesRef = useRef<Map<string, boolean>>(new Map());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A background change started here waits until the QA Tool says it has finished or failed.
  useEffect(() => {
    if (!update.running) setPending(false);
  }, [update.running]);
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

  const flushToggles = async () => {
    if (pendingTogglesRef.current.size === 0) return;
    const items = Array.from(pendingTogglesRef.current.entries()).map(([id, skipped]) => ({ id, skipped }));
    pendingTogglesRef.current.clear();
    const affectedIds = items.map((i) => i.id);
    const ok = await edit(() => patchPlan({ items }));
    if (!ok) {
      setError('Failed to update selection on the server. Your changes have been rolled back.');
    }
    setSwitched((s) => Object.fromEntries(Object.entries(s).filter(([id]) => !affectedIds.includes(id))));
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
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        void flushToggles();
      }
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
    replanEverything: async () => {
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
    },
    saveDocsAndReplan: async (productContext, designNotes) => {
      await edit(() => patchPlan({ productContext, designNotes }));
      await inBackground(() => replanEverything(productContext));
    },
    describeTest: (sentence, urlPath) => interpretSentence({ sentence, urlPath }),
    addJourney: async (flow) => {
      await edit(() => patchPlan({ flows: [...plan.flows, flow] }));
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

  const approveButton = (
    <button type="button" className="btn-primary shrink-0" disabled={busy || approving} onClick={() => onApprove()}>
      {approving ? <Spinner label="Starting the tests…" /> : 'Approve the plan and start testing'}
    </button>
  );
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

  return (
    <div className="flex min-h-[calc(100vh-7rem)] w-full flex-col bg-canvas">
      <div className="border-b border-rule bg-surface px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <nav aria-label="Breadcrumbs" className="mb-2 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
              <Link to={PATHS.new} className="hover:text-ink transition-colors">
                New check-up
              </Link>
              <span aria-hidden="true" className="text-rule">
                /
              </span>
              <span className="font-semibold text-ink">{host}</span>
              <span aria-hidden="true" className="text-rule">
                /
              </span>
              <span className="text-ink-soft">Plan review</span>
            </nav>
            <FocusHeading className="break-words text-2xl font-bold text-ink sm:text-3xl">
              Review the plan for {host}
            </FocusHeading>
            <p className="text-sm text-ink-soft">
              {plan.siteType ? `${plan.siteType} · ` : ''}
              {count(plan.planPages?.length ?? plan.pages.length, 'page', 'pages')} ·{' '}
              {count(plan.navigation?.length ?? 0, 'link', 'links')} · {count(plan.flows.length, 'journey', 'journeys')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="tablist"
              aria-label="How to show the plan"
              className="flex rounded border border-rule bg-panel p-0.5 text-sm"
            >
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
                  className={`min-h-[44px] rounded px-3 font-bold ${tab === id ? 'bg-stamp text-surface' : 'text-ink-soft hover:text-ink'}`}
                >
                  {name}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-quiet min-h-[44px] px-3 text-sm"
              onClick={() => downloadPlanMarkdown().catch((err: Error) => setError(err.message))}
            >
              Download the plan
            </button>
            <button
              type="button"
              className="btn-quiet min-h-[44px] px-3 text-sm"
              title="Download the Plan as a Playwright project"
              onClick={() => downloadPlaywrightExport().catch((err: Error) => setError(err.message))}
            >
              Export as Playwright tests
            </button>
          </div>
        </div>
        {notice && (
          <div className="mx-auto mt-4 max-w-6xl">
            <Notice tone={notice.tone} title={notice.title}>
              {notice.body}
            </Notice>
          </div>
        )}
        {busy && (
          <p role="status" className="mx-auto mt-3 flex max-w-6xl items-center gap-2 text-sm text-stamp">
            <Spinner label={`Updating the plan: ${update.step || update.what || 'starting'}…`} />
          </p>
        )}
        {(update.error || error) && (
          <p role="alert" className="mx-auto mt-3 max-w-6xl text-sm text-fail">
            {update.error || error}
          </p>
        )}
      </div>

      <div className="flex-1" role="tabpanel" id="plan-tabpanel" aria-labelledby={`plan-tab-${tab}`}>
        {panel}
      </div>

      <div className="sticky bottom-0 z-40 border-t border-rule bg-surface/95 px-4 py-2 backdrop-blur sm:px-6 sm:py-3">
        {/* Phones: one line that opens into the summary, so the bar doesn't cover the plan. */}
        <div className="flex items-center justify-between gap-3 sm:hidden">
          <button
            type="button"
            className="min-h-[44px] min-w-0 flex-1 text-left text-sm font-bold text-ink"
            aria-expanded={barOpen}
            onClick={() => setBarOpen((o) => !o)}
          >
            {tests !== undefined
              ? `${count(tests, 'test', 'tests')}${minutes ? ` · about ${minutes} min` : ''}`
              : 'Ready to test'}{' '}
            {barOpen ? '▾' : '▸'}
          </button>
          <button
            type="button"
            className="btn-primary min-h-[44px] shrink-0 px-4"
            disabled={busy || approving}
            onClick={() => onApprove()}
          >
            {approving ? <Spinner label="Starting…" /> : 'Approve'}
          </button>
        </div>
        {barOpen && (
          <p className="pb-2 text-sm text-ink-soft sm:hidden">
            {lines.length > 1
              ? lines
                  .slice(1)
                  .map((l) => l.text)
                  .join(' · ')
              : 'Nothing runs until you approve.'}
          </p>
        )}
        <div className="mx-auto hidden max-w-6xl flex-wrap items-center justify-between gap-3 sm:flex">
          <div className="min-w-0 flex-1 text-sm text-ink">
            <p className="font-bold">
              {lines[0]?.text ?? 'Ready to test'}
              {minutes ? <span className="font-normal text-ink-soft"> · about {minutes} min</span> : null}
            </p>
            <p className="text-ink-soft">
              {lines.length > 1
                ? lines
                    .slice(1)
                    .map((l) => l.text)
                    .join(' · ')
                : 'Nothing runs until you approve.'}
            </p>
          </div>
          {approveButton}
        </div>
        {approveError && (
          <p role="alert" className="mx-auto max-w-6xl text-sm font-bold text-fail">
            {approveError}
          </p>
        )}
        {needsSignIn && <SignInAgain busy={busy || approving} onSubmit={(roles) => onApprove(roles)} />}
      </div>
    </div>
  );
}

/** The sign-in fields shown again at approval. Typed values live here only and are cleared once sent. */
function SignInAgain({ busy, onSubmit }: { busy: boolean; onSubmit: (roles: RoleCredential[]) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const roles = approveRolesOf(username, password);
  return (
    <form
      className="mx-auto mt-2 flex max-w-6xl flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (roles.length === 0) return;
        onSubmit(roles);
        setPassword('');
      }}
    >
      <label className="text-sm font-bold text-ink">
        Sign-in username
        <input
          className="input mt-1 block"
          autoComplete="off"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      <label className="text-sm font-bold text-ink">
        Sign-in password
        <input
          className="input mt-1 block"
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button type="submit" className="btn-primary" disabled={busy || roles.length === 0}>
        Approve with these details
      </button>
    </form>
  );
}
