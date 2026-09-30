import { useEffect, useMemo, useState } from 'react';
import type { Breakpoint, ReviewPlan } from '@qa/types';
import { SiteMap } from '../components/SiteMap';
import { FocusHeading, Notice, Spinner } from '../components/text';
import { useTitle } from '../lib/router';
import { hostOf } from '../lib/url';
import { PlanDocument, type PlanActions } from '../components/plan/PlanDocument';
import { showItem } from '../components/plan/parts';
import { patchPlan, replanItem, replanEverything, addPageToPlan, includeHostInPlan, downloadPlanMarkdown, interpretSentence } from '../api';

/** A background change to the plan (re-planning, adding pages), as the QA Tool reports it. */
export interface PlanUpdateState {
  running: boolean;
  what?: string;
  step?: string;
  error?: string | null;
}

/** A banner over the plan: testing stopped or failed and the plan was kept, or the site changed since it was approved. */
export interface PlanNotice {
  tone: 'fail' | 'warn' | 'stamp';
  title: string;
  body: string;
}

export interface PlanReviewScreenProps {
  plan: ReviewPlan;
  onApprove: () => Promise<void> | void;
  onPlanUpdated: (plan: ReviewPlan) => void;
  update: PlanUpdateState;
  approveError?: string | null;
  notice?: PlanNotice | null;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The plan as the person sees it: switches they just flipped show at once, before the QA Tool has
 * saved them. An item's `skipped` comes from `switched`; the screen sizes from `sizes`.
 */
function withChanges(plan: ReviewPlan, switched: Record<string, boolean>, sizes: Breakpoint[] | null): ReviewPlan {
  if (Object.keys(switched).length === 0 && !sizes) return plan;
  const skip = <T extends { id: string; skipped?: boolean }>(item: T): T => (item.id in switched ? { ...item, skipped: switched[item.id] } : item);
  return {
    ...plan,
    screenSizes: sizes ?? plan.screenSizes,
    planPages: plan.planPages?.map((p) => skip({ ...p, tests: p.tests.map(skip) })),
    navigation: plan.navigation?.map(skip),
    flows: plan.flows.map((f) => (`journey:${f.id}` in switched ? { ...f, outOfScope: switched[`journey:${f.id}`] || undefined } : f)),
  };
}

/**
 * /check/plan: the plan the AI wrote, to change and approve. Nothing is tested until it's approved,
 * and leaving this screen keeps the plan waiting.
 */
export function PlanReviewScreen({ plan, onApprove, onPlanUpdated, update, approveError, notice }: PlanReviewScreenProps) {
  const [tab, setTab] = useState<'plan' | 'map'>('plan');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switched, setSwitched] = useState<Record<string, boolean>>({});
  const [sizes, setSizes] = useState<Breakpoint[] | null>(null);
  const shown = useMemo(() => withChanges(plan, switched, sizes), [plan, switched, sizes]);

  // A background change started here waits until the QA Tool says it has finished or failed.
  useEffect(() => {
    if (!update.running) setPending(false);
  }, [update.running]);
  const busy = pending || update.running;

  const edit = async (change: () => Promise<ReviewPlan>) => {
    setError(null);
    try {
      onPlanUpdated(await change());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The plan couldn’t be changed. Try again.');
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

  const actions: PlanActions = {
    busy,
    // Shown at once; kept until the saved plan comes back, or undone if saving fails.
    setSkipped: (id, skipped) => {
      setSwitched((s) => ({ ...s, [id]: skipped }));
      void edit(() => patchPlan({ items: [{ id, skipped }] })).finally(() =>
        setSwitched(({ [id]: _done, ...rest }) => rest)
      );
    },
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
    replanEverything: () => void inBackground(() => replanEverything()),
    saveDocsAndReplan: async (productContext, designNotes) => {
      await edit(() => patchPlan({ productContext, designNotes }));
      await inBackground(() => replanEverything(productContext));
    },
    describeTest: (sentence, urlPath) => interpretSentence({ sentence, urlPath }),
    addJourney: (flow) => edit(() => patchPlan({ flows: [...plan.flows, flow] })),
  };

  // The site's real links, for the map.
  const links = useMemo(
    () => plan.pages.flatMap((p) => (p.links || []).filter((l) => !l.leavesSite).map((l) => ({ from: p.urlPath, to: l.landsOn ?? l.to }))),
    [plan.pages]
  );

  const host = hostOf(plan.targetUrl);
  useTitle(`Plan for ${host}`);
  const lines = plan.summary?.lines || [];
  const [approving, setApproving] = useState(false);

  return (
    <div className="flex w-full flex-1 flex-col bg-canvas">
      <div className="border-b border-rule bg-surface px-4 py-3 sm:px-6">
        {notice && (
          <div className="mx-auto mb-3 max-w-6xl">
            <Notice tone={notice.tone} title={notice.title}>
              {notice.body}
            </Notice>
          </div>
        )}
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <FocusHeading className="break-words text-xl font-bold text-ink sm:text-2xl">Review the plan for {host}</FocusHeading>
            <p className="font-mono text-xs text-ink-soft">
              {plan.siteType ? `${plan.siteType} · ` : ''}
              {count(plan.planPages?.length ?? plan.pages.length, 'page', 'pages')} · {count(plan.navigation?.length ?? 0, 'link', 'links')} ·{' '}
              {count(plan.flows.length, 'journey', 'journeys')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="How to show the plan" className="flex rounded border border-rule bg-panel p-0.5 text-xs">
              {(
                [
                  ['plan', 'Full plan'],
                  ['map', 'Map'],
                ] as const
              ).map(([id, name]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`min-h-[36px] rounded px-3 py-1 font-bold ${tab === id ? 'bg-stamp text-surface' : 'text-ink-soft hover:text-ink'}`}
                >
                  {name}
                </button>
              ))}
            </div>
            <button type="button" className="btn-quiet min-h-[40px] px-3 py-1.5 text-xs" onClick={() => downloadPlanMarkdown().catch((err: Error) => setError(err.message))}>
              Download the plan
            </button>
          </div>
        </div>
        {busy && (
          <p className="mx-auto mt-2 max-w-6xl text-xs text-stamp">
            <Spinner label={`Updating the plan: ${update.step || update.what || 'starting'}…`} />
          </p>
        )}
        {(update.error || error) && (
          <p role="alert" className="mx-auto mt-2 max-w-6xl text-xs text-fail">
            {update.error || error}
          </p>
        )}
      </div>

      <div className="flex-1">
        {tab === 'plan' ? (
          <PlanDocument plan={shown} actions={actions} />
        ) : (
          <div className="flex h-[70vh]">
            <SiteMap
              pages={plan.pages}
              flows={plan.flows}
              mode="plan"
              links={links}
              maxCards={12}
              onSelectPage={(urlPath) => {
                setTab('plan');
                window.setTimeout(() => showItem(`page:${urlPath}`), 60);
              }}
            />
          </div>
        )}
      </div>

      <div className="sticky bottom-0 z-40 border-t border-rule bg-surface/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-sm text-ink">
            <p className="font-bold">{lines[0]?.text ?? 'Ready to test'}</p>
            <p className="text-xs text-ink-soft">{lines.length > 1 ? lines.slice(1).map((l) => l.text).join(' · ') : 'Nothing is tested until you approve the plan.'}</p>
            {approveError && (
              <p role="alert" className="text-xs text-fail">
                {approveError}
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn-primary px-5 py-2.5 text-sm font-bold"
            disabled={busy || approving}
            onClick={async () => {
              setApproving(true);
              try {
                await onApprove();
              } finally {
                setApproving(false);
              }
            }}
          >
            {approving ? <Spinner label="Starting the testing…" /> : 'Approve and start testing'}
          </button>
        </div>
      </div>
    </div>
  );
}
