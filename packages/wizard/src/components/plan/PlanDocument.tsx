import React, { createContext, useContext, useDeferredValue, useEffect, useRef, useState } from 'react';
import type {
  Breakpoint,
  DiscoveredFlow,
  FindingSeverity,
  NavigationCheck,
  PlanIntent,
  PlanPage,
  PlanPageTest,
  ReviewPlan,
  RoleCredential,
  TestCaseExpectations,
} from '@qa/types';
import { stepToSentence, expectationsToChecks } from '../../lib/plan-translate';
import { count, scrollBehavior } from '../../lib/format';
import { Disclosure } from '../ui';
import type { InterpretResult, PatchPlanBody } from '../../api';
import {
  confirmRolesEdit,
  docSourceLabel,
  documentedLine,
  isDenial,
  notFoundByDocument,
  originLabel,
  parseRoles,
  plannedWhileScanningLine,
  removeNotFoundEdit,
  rolesLine,
  severityEdit,
  staleEdit,
} from '../../lib/plan-sources';
import {
  INTENT_HINTS,
  INTENT_LABELS,
  filterByIntent,
  intentKey,
  intentSummaryLine,
  intentsInPlan,
  openingLine,
  overCapLine,
  wontRunReason,
} from '../../lib/intent-view';
import {
  Badge,
  ItemToggle,
  OPEN_ALL_EVENT,
  ReplanControl,
  SourceBadge,
  itemDomId,
  safeDecodeHash,
  showItem,
} from './parts';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { isSingleKeyShortcut, isTypingTarget, readSingleKeyShortcuts } from '../../lib/shortcuts';

/** What the person can do to the plan from the document. Each change goes to Release check-up. */
export interface PlanActions {
  /** A change is being made: controls wait. */
  busy: boolean;
  setSkipped: (itemId: string, skipped: boolean) => void;
  /** Switches many items at once: a layout group's pages, or every link on a page. */
  setSkippedMany: (itemIds: string[], skipped: boolean) => void;
  replan: (itemId: string, instructions?: string) => void;
  promote: (pageItemId: string) => void;
  addPage: (address: string) => Promise<void>;
  includeHost: (host: string) => void;
  /** An empty answer clears it: the safe answer is used again. */
  answer: (questionId: string, answer: string) => void;
  setScreenSizes: (sizes: Breakpoint[]) => void;
  replanEverything: () => void;
  saveDocsAndReplan: (productContext: string, designNotes: string) => Promise<void>;
  describeTest: (sentence: string, urlPath: string) => Promise<InterpretResult>;
  addJourney: (flow: DiscoveredFlow) => Promise<void>;
  /** Reorders journeys by moving flow from one index to another. */
  reorderJourneys?: (fromIndex: number, toIndex: number) => Promise<void>;
  /** Renames a journey inline. */
  renameJourney?: (flowId: string, newName: string) => Promise<void>;
  /** Confirms the AI's guess of what should happen (no text), or replaces it with the person's own words. */
  setExpectation: (itemId: string, text?: string) => void;
  /** Signs in as a role from the review, and adds what it sees to the plan. */
  addSignIn: (signIn: RoleCredential) => Promise<void>;
  /** Desktop only, and only the shared menus' links. */
  quickCheck: () => void;
  /** Plan Review edits on an item's Source: roles, severity, "document is out of date". */
  editSource: (edits: NonNullable<PatchPlanBody['sourceEdits']>) => void;
  /** Removes an entry from "Not found in app". */
  editNotFound: (edits: NonNullable<PatchPlanBody['notFoundEdits']>) => void;
  /** The Intents switched off, one switch per Intent. */
  intentsOff: PlanIntent[];
  setIntentOff: (intent: PlanIntent, off: boolean) => void;
}

const SIZES: Breakpoint[] = ['375px', '768px', '1440px'];
const SIZE_NAMES: Record<Breakpoint, string> = {
  '375px': 'Phone (375px)',
  '768px': 'Tablet (768px)',
  '1440px': 'Desktop (1440px)',
};
/** Who a role is, in the words the rest of the plan uses. */
function roleName(role: string | undefined): string {
  return !role || role === 'anonymous' || role === 'visitor' ? 'visitor' : role;
}

/** What the reader is narrowing the plan to: words to find, and whether only items needing them show. */
interface View {
  query: string;
  needsMe: boolean;
  expandAll?: boolean | null;
  /** Show only the items with this Intent. */
  intent?: PlanIntent | null;
}
const ViewContext = createContext<View>({ query: '', needsMe: false });
/** Whether an AI is set up: without one, "Re-plan with the AI" shows once in the summary, not on every item. */
const AiContext = createContext(true);

function matches(view: View, text: string): boolean {
  const q = view.query.trim().toLowerCase();
  return !q || text.toLowerCase().includes(q);
}

/** An AI guess not yet confirmed: the person should look at it. */
function isGuess(expectations?: TestCaseExpectations): boolean {
  return !!expectations && expectations.origin === 'ai-guess' && Object.keys(expectations).some((k) => k !== 'origin');
}

function pageNeedsMe(page: PlanPage): boolean {
  return (
    page.source === 'fallback' ||
    !!page.isNew ||
    page.tests.some((t) => t.source === 'fallback' || isGuess(t.expectations) || !!t.needsHelp?.length)
  );
}
function navNeedsMe(nav: NavigationCheck): boolean {
  return nav.source === 'fallback' || !!nav.isNew || !!nav.notAt?.length;
}
function flowNeedsMe(flow: DiscoveredFlow): boolean {
  return flow.source === 'fallback' || !!flow.isNew || !!flow.needsHelp?.length || isGuess(flow.candidateExpectations);
}

/**
 * Opens a section's own disclosure (its direct child details), so a jump to the section shows its items.
 * Only for section elements: an item's own details are left to the item.
 */
function openOwnSection(el: HTMLElement): void {
  if (el.tagName !== 'SECTION') return;
  const own = el.querySelector<HTMLDetailsElement>(':scope > details');
  if (own && !own.open) own.open = true;
}

function Section({
  id,
  title,
  count,
  intro,
  collapsible,
  startOpen = false,
  children,
}: {
  id: string;
  title: string;
  count?: number | string;
  intro?: string;
  /** Collapsible sections start closed. Set this to start one open. */
  collapsible?: boolean;
  /** Only for collapsible sections: starts open. */
  startOpen?: boolean;
  children: React.ReactNode;
}) {
  const view = useContext(ViewContext);
  const heading = (
    <>
      {title}
      {count !== undefined && (
        <>
          {' '}
          <span className="ml-1 text-base font-normal text-ink-soft">({count})</span>
        </>
      )}
    </>
  );
  if (collapsible) {
    const shouldOpen =
      view.expandAll !== undefined && view.expandAll !== null
        ? view.expandAll
        : startOpen || !!view.query.trim() || view.needsMe;
    const [open, setOpen] = useState(shouldOpen);

    useEffect(() => {
      if (view.expandAll !== undefined && view.expandAll !== null) {
        setOpen(view.expandAll);
      } else if (view.query.trim() || view.needsMe) {
        setOpen(true);
      }
    }, [view.expandAll, view.query, view.needsMe]);

    return (
      <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
        <details
          className="disclosure border-t border-rule"
          open={open}
          onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="py-3">
            <h2 id={`${id}-title`} className="text-xl font-bold text-ink">
              {heading}
            </h2>
          </summary>
          {open && (
            <div className="pb-2 pt-1">
              {intro && <p className="mb-4 max-w-prose text-sm text-ink-soft">{intro}</p>}
              {children}
            </div>
          )}
        </details>
      </section>
    );
  }
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-rule pt-6">
      <h2 id={`${id}-title`} className="mb-2 text-xl font-bold text-ink">
        {heading}
      </h2>
      {intro && <p className="mb-4 max-w-prose text-sm text-ink-soft">{intro}</p>}
      {children}
    </section>
  );
}

function CollapsibleGroup({
  title,
  startOpen,
  actions,
  children,
}: {
  title: React.ReactNode;
  startOpen: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const view = useContext(ViewContext);
  const shouldOpen =
    view.expandAll !== undefined && view.expandAll !== null
      ? view.expandAll
      : startOpen || !!view.query.trim() || view.needsMe;
  const [open, setOpen] = useState(shouldOpen);

  useEffect(() => {
    if (view.expandAll !== undefined && view.expandAll !== null) {
      setOpen(view.expandAll);
    } else if (view.query.trim() || view.needsMe) {
      setOpen(true);
    }
  }, [view.expandAll, view.query, view.needsMe]);

  return (
    <details
      className="mb-2 rounded-card border border-rule bg-surface"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex min-h-[48px] cursor-pointer items-center px-3 py-2 text-base text-ink">
        <span>{title}</span>
      </summary>
      {open && (
        <div className="p-3">
          {actions && <div className="mb-3 flex justify-end">{actions}</div>}
          {children}
        </div>
      )}
    </details>
  );
}

function ChunkedList<T>({
  items,
  renderItem,
  chunkSize = 35,
  className = 'space-y-2',
}: {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  chunkSize?: number;
  className?: string;
}) {
  const view = useContext(ViewContext);
  const [visibleCount, setVisibleCount] = useState(chunkSize);
  const showAll = Boolean(view.query.trim() || view.needsMe || view.expandAll);
  const visibleItems = showAll ? items : items.slice(0, visibleCount);
  const remaining = items.length - visibleCount;

  return (
    <div>
      <ul className={className}>{visibleItems.map(renderItem)}</ul>
      {!showAll && remaining > 0 && (
        <div className="pt-2 text-center">
          <button type="button" className="btn-quiet btn-sm" onClick={() => setVisibleCount((c) => c + chunkSize)}>
            Show {Math.min(remaining, chunkSize)} more ({remaining} remaining)
          </button>
        </div>
      )}
    </div>
  );
}

/** True when focus moved to another control of the same rename form (Save or Cancel): not a reason to save. */
export function staysInForm(form: { contains(node: Node | null): boolean } | null, next: EventTarget | null): boolean {
  return !!form && !!next && form.contains(next as Node);
}

function EditableTitle({
  value,
  onSave,
  disabled,
  className = 'text-base font-bold text-ink',
}: {
  value: string;
  onSave: (next: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(value);
  }, [value]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = text.trim();
          if (trimmed && trimmed !== value) {
            onSave(trimmed);
          }
          setEditing(false);
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input
          ref={inputRef}
          type="text"
          aria-label={`New name for ${value}`}
          className="field w-auto min-w-0 flex-1 py-2 text-sm font-bold"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setText(value);
              setEditing(false);
            }
          }}
          onBlur={(e) => {
            // Focus going to Save or Cancel is handled by that button, not by leaving the field.
            if (staysInForm(e.currentTarget.form, e.relatedTarget)) return;
            const trimmed = text.trim();
            if (trimmed && trimmed !== value) {
              onSave(trimmed);
            }
            setEditing(false);
          }}
          disabled={disabled}
        />
        <button type="submit" className="btn-quiet btn-sm" disabled={disabled || !text.trim()}>
          Save
        </button>
        <button
          type="button"
          className="btn-link text-sm"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setText(value);
            setEditing(false);
          }}
        >
          Cancel
        </button>
      </form>
    );
  }

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      <span className={`min-w-0 [overflow-wrap:anywhere] ${className}`}>{value}</span>
      {!disabled && (
        <button
          type="button"
          aria-label={`Edit name: ${value}`}
          title="Rename"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-soft hover:bg-panel hover:text-stamp"
          onClick={() => setEditing(true)}
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
          </svg>
        </button>
      )}
    </span>
  );
}

/** What should happen, in plain words. An AI guess can be confirmed or reworded right here. */
function Expected({
  itemId,
  expectations,
  actions,
}: {
  itemId: string;
  expectations?: TestCaseExpectations;
  actions: PlanActions;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  if (!expectations || !Object.keys(expectations).some((k) => k !== 'origin')) return null;
  const guess = expectations.origin === 'ai-guess';
  const checks = expectationsToChecks(expectations);
  return (
    <div className="mt-1 text-sm">
      <ul className="space-y-0.5 text-pass">
        {checks.map((c, i) => (
          <li key={i}>
            ✓ {c.sentence}
            {guess ? (
              <span className="text-ink-soft"> (the AI’s guess)</span>
            ) : expectations.origin === 'user' ? (
              <span className="text-ink-soft"> (confirmed by you)</span>
            ) : null}
          </li>
        ))}
      </ul>
      {guess && !editing && (
        <div className="mt-1 flex flex-wrap gap-x-4">
          <button
            type="button"
            className="btn-link text-sm disabled:cursor-not-allowed disabled:text-ink-soft"
            disabled={actions.busy}
            onClick={() => actions.setExpectation(itemId)}
          >
            Confirm
          </button>
          <button
            type="button"
            className="btn-link text-sm disabled:cursor-not-allowed disabled:text-ink-soft"
            disabled={actions.busy}
            onClick={() => {
              setText(expectations.text?.contains ?? '');
              setEditing(true);
            }}
          >
            Change the wording
          </button>
        </div>
      )}
      {editing && (
        <form
          className="mt-2 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            actions.setExpectation(itemId, text.trim());
            setEditing(false);
          }}
        >
          <label className="grid flex-1 gap-1">
            <span className="font-bold">The wording that should show afterwards</span>
            <input className="field py-2 text-sm" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          </label>
          <button type="submit" className="btn-quiet btn-sm self-end" disabled={actions.busy || !text.trim()}>
            Save
          </button>
          <button type="button" className="btn-link self-end text-sm" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}

/** Sign in from the review, when pages behind a sign-in weren't reached. */
function AddSignIn({ actions }: { actions: PlanActions }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginPath, setLoginPath] = useState('');
  const [usernameSelector, setUsernameSelector] = useState('');
  const [passwordSelector, setPasswordSelector] = useState('');
  const [submitSelector, setSubmitSelector] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" className="btn-quiet btn-sm mt-3" disabled={actions.busy} onClick={() => setOpen(true)}>
        Add a sign-in
      </button>
    );
  }
  return (
    <form
      className="mt-3 grid gap-3 rounded-card border border-rule p-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await actions.addSignIn({
            role: role.trim() || 'member',
            username: username.trim(),
            password,
            loginPath: loginPath.trim() || undefined,
            usernameSelector: usernameSelector.trim() || undefined,
            passwordSelector: passwordSelector.trim() || undefined,
            submitSelector: submitSelector.trim() || undefined,
          });
          setOpen(false);
          setPassword('');
          setUsernameSelector('');
          setPasswordSelector('');
          setSubmitSelector('');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'The sign-in couldn’t be added.');
        }
      }}
    >
      <p className="text-sm text-ink-soft sm:col-span-2">
        Release check-up signs in, explores what that role sees, and adds it to the plan. The details stay in memory
        only.
      </p>
      <label className="text-sm">
        <span className="mb-1 block font-bold">Role name</span>
        <input
          className="field py-2 text-sm"
          placeholder="member"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-bold">Email or username</span>
        <input
          className="field py-2 text-sm"
          autoComplete="off"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-bold">Password</span>
        <input
          className="field py-2 text-sm"
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <details className="col-span-full space-y-3">
        <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-bold text-stamp hover:underline">
          Advanced
        </summary>
        <div className="grid gap-3 pt-2 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-bold">Sign-in page</span>
            <span className="mb-1 block text-xs text-ink-soft">Where the sign-in form is, for example /login</span>
            <input
              className="field py-2 text-sm"
              placeholder="/login"
              value={loginPath}
              onChange={(e) => setLoginPath(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-bold">Username field (optional)</span>
            <input
              className="field py-2 text-sm"
              placeholder='input[name="user"]'
              value={usernameSelector}
              onChange={(e) => setUsernameSelector(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-bold">Password field (optional)</span>
            <input
              className="field py-2 text-sm"
              placeholder='input[type="password"]'
              value={passwordSelector}
              onChange={(e) => setPasswordSelector(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-bold">Sign-in button (optional)</span>
            <input
              className="field py-2 text-sm"
              placeholder='button[type="submit"]'
              value={submitSelector}
              onChange={(e) => setSubmitSelector(e.target.value)}
            />
          </label>
        </div>
      </details>
      {error && (
        <p role="alert" className="text-sm text-fail sm:col-span-2">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <button type="submit" className="btn-quiet btn-sm" disabled={actions.busy || !username.trim() || !password}>
          Sign in and explore
        </button>
        <button type="button" className="btn-link text-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const TOKEN_STAGES: Record<string, string> = {
  planning: 'Planning',
  repair: 'Asking again',
  journeys: 'Journeys',
  'visual-review': 'Looking over screens',
  interpret: 'Describing tests',
  other: 'Other',
};

/** Tests per Intent, the over-cap line, and one switch per Intent. */
function IntentSummary({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const present = intentsInPlan(plan);
  const line = intentSummaryLine(plan);
  const overCap = overCapLine(plan);
  if (!line && !overCap) return null;
  return (
    <div className="mt-4" data-testid="intent-summary">
      {/* One Intent only: its count is the total above, and a switch for it would switch everything off. */}
      {line && present.length > 1 && <p className="text-base text-ink">{line}</p>}
      {overCap && (
        <p className="mt-1 text-base text-warn" data-testid="over-cap-line">
          {overCap}
        </p>
      )}
    </div>
  );
}

/** One switch per Intent, when the plan has more than one. */
function IntentSwitches({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const present = intentsInPlan(plan);
  if (present.length < 2) return null;
  return (
    <fieldset>
      <legend className="label mb-1">Intents to run</legend>
      <p className="mb-2 max-w-prose text-sm text-ink-soft">
        An Intent is what a test expects to happen. Switch one off to leave its tests out of this check-up.
      </p>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {present.map((c) => {
          const off = actions.intentsOff.includes(c.intent);
          return (
            <label
              key={c.intent}
              className="flex min-h-[44px] cursor-pointer items-center gap-2 text-base text-ink"
              title={INTENT_HINTS[c.intent]}
            >
              <input
                type="checkbox"
                className="h-5 w-5 accent-stamp"
                data-testid={`intent-switch-${c.intent}`}
                checked={!off}
                disabled={actions.busy}
                onChange={(e) => actions.setIntentOff(c.intent, !e.target.checked)}
              />
              {c.label} ({c.items})
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function SummarySection({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const sizes = plan.screenSizes?.length ? plan.screenSizes : SIZES;
  const budget = plan.budget;
  const notReached =
    (plan.wontRun || []).some((w) => /behind a sign-in/i.test(w.reason)) ||
    (plan.notes || []).some((n) => /sign-in|sign in/i.test(n));
  const tokens = Object.entries(budget?.tokens || {});
  const scanningLine = plannedWhileScanningLine(plan);
  return (
    <Section id="plan-summary" title="What approving runs">
      <ul className="space-y-1.5">
        {(plan.summary?.lines || []).map((line, i) => (
          <li key={i} className="flex items-start justify-between gap-3 text-base text-ink">
            <span>
              {line.text}
              {i === 0 && plan.summary?.minutes ? (
                <span className="text-ink-soft"> · about {plan.summary.minutes} min</span>
              ) : null}
            </span>
            {line.itemIds.length > 0 && (
              <button
                type="button"
                className="btn-link min-w-[44px] shrink-0 justify-center text-sm"
                onClick={() => showItem(line.itemIds[0])}
              >
                Show
              </button>
            )}
          </li>
        ))}
      </ul>
      <IntentSummary plan={plan} actions={actions} />

      {/* What to run is a setting, not the plan: one closed row, so the plan itself starts sooner. */}
      <Disclosure
        className="mt-5"
        summary="Change what runs"
        hint={`${sizes.length === SIZES.length ? 'Every screen size' : count(sizes.length, 'screen size', 'screen sizes')} · as ${(plan.roles?.length ? plan.roles : ['visitor']).map(roleName).join(', ')}`}
      >
        <div className="grid gap-5">
          <IntentSwitches plan={plan} actions={actions} />
          <fieldset>
            <legend className="label mb-2">Screen sizes</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {SIZES.map((size) => {
                const on = sizes.includes(size);
                return (
                  <label key={size} className="flex min-h-[44px] cursor-pointer items-center gap-2 text-base text-ink">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-stamp"
                      checked={on}
                      disabled={actions.busy || (on && sizes.length === 1)}
                      onChange={(e) =>
                        actions.setScreenSizes(
                          e.target.checked
                            ? SIZES.filter((s) => s === size || sizes.includes(s))
                            : sizes.filter((s) => s !== size)
                        )
                      }
                    />
                    {SIZE_NAMES[size]}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <button type="button" className="btn-link w-fit text-sm" disabled={actions.busy} onClick={actions.quickCheck}>
            Make it a shorter check-up: desktop only, and only the shared menus’ links
          </button>

          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-soft">Tested as</dt>
              <dd className="text-ink">{(plan.roles?.length ? plan.roles : ['visitor']).map(roleName).join(', ')}</dd>
            </div>
            {budget && (
              <div>
                <dt className="text-ink-soft">AI requests</dt>
                <dd className="text-ink">
                  {budget.used} used, about {budget.needed} needed
                  {budget.left !== undefined && ` · ${budget.left} free left today`}
                  {budget.visualReview ? ` · looking over the screens can use up to ${budget.visualReview} more` : ''}
                </dd>
              </div>
            )}
          </dl>
          {tokens.length > 0 && (
            <details className="text-sm">
              <summary className="inline-flex min-h-[44px] cursor-pointer items-center font-semibold text-stamp underline decoration-2 underline-offset-4">
                AI tokens used
              </summary>
              <div className="overflow-x-auto">
                <table className="table-plain mt-2">
                  <thead>
                    <tr>
                      <th>Stage</th>
                      <th>Requests</th>
                      <th>Sent</th>
                      <th>Answered</th>
                      <th>Of which thinking</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map(([stage, u]) => (
                      <tr key={stage}>
                        <td>{TOKEN_STAGES[stage] ?? stage}</td>
                        <td>
                          {u!.requests}
                          {u!.truncated ? ` (${u!.truncated} cut off)` : ''}
                        </td>
                        <td>{u!.promptTokens.toLocaleString()}</td>
                        <td>{u!.completionTokens.toLocaleString()}</td>
                        <td>{u!.reasoningTokens.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          {scanningLine && <p className="text-sm text-ink-soft">{scanningLine}</p>}
        </div>
      </Disclosure>

      {plan.readOnlyReason && (
        <p className="mt-4 rounded-card border border-warn/40 bg-warn-tint p-3 text-sm text-ink">
          {plan.readOnlyReason}
        </p>
      )}
      {(plan.notes || []).length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-ink">
          {plan.notes!.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      )}
      {notReached && <AddSignIn actions={actions} />}
      <div className="mt-4 grid gap-2">
        {plan.aiAvailable === false && (
          <p className="max-w-prose text-sm text-ink-soft" data-testid="replan-once">
            No AI is set up for this plan, so items can’t be re-planned one by one. Connect an AI, then re-plan
            everything here.
          </p>
        )}
        <button
          type="button"
          className="btn-quiet btn-sm w-fit"
          disabled={actions.busy}
          onClick={actions.replanEverything}
        >
          Re-plan everything with the AI
        </button>
      </div>
    </Section>
  );
}

function QuestionsSection({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const view = useContext(ViewContext);
  const shown = plan.questions.filter(
    (q) => matches(view, `${q.question} ${q.urlPath}`) && (!view.needsMe || !q.selectedAnswer)
  );
  if (plan.questions.length === 0) return null;
  const unanswered = plan.questions.filter((q) => !q.selectedAnswer).length;
  return (
    <Section
      id="plan-questions"
      title={unanswered > 0 ? 'Needs your answer' : 'Your answers'}
      count={unanswered > 0 ? unanswered : plan.questions.length}
      collapsible
      startOpen
      intro="Anything you leave unanswered gets the cautious answer: nothing is sent or deleted."
    >
      <ul className="space-y-3">
        {shown.map((q) => (
          <li
            key={q.id}
            id={itemDomId(q.id)}
            data-plan-item={q.id}
            className="rounded-card border border-rule p-4 transition-all"
          >
            <p className="mb-2 text-base font-bold text-ink">
              {q.question} {q.isNew && <Badge tone="stamp">New</Badge>}
            </p>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={q.question}>
              {q.options.map((option) => {
                const picked = q.selectedAnswer === option;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={picked}
                    disabled={actions.busy}
                    onClick={() => actions.answer(q.id, option)}
                    className={`min-h-[44px] rounded-control border-[1.5px] px-3 py-2 text-sm ${picked ? 'border-ink bg-ink font-bold text-surface' : 'border-edge text-ink hover:border-ink'}`}
                  >
                    {option}
                    {!q.selectedAnswer && option === q.safeAnswer ? ' (used if you don’t answer)' : ''}
                  </button>
                );
              })}
              {q.selectedAnswer && (
                <button
                  type="button"
                  className="btn-link text-sm"
                  disabled={actions.busy}
                  onClick={() => actions.answer(q.id, '')}
                >
                  Clear the answer
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="text-sm text-ink-soft">No questions match.</p>}
    </Section>
  );
}

const SEVERITIES: FindingSeverity[] = ['Blocker', 'Major', 'Minor', 'Suggestion'];

/** Where a Plan Item came from: the Source chip, the roles the AI proposed, severity, out-of-date switch. */
function SourceDetails({ test, actions }: { test: PlanPageTest; actions: PlanActions }) {
  const [correcting, setCorrecting] = useState(false);
  const [typed, setTyped] = useState((test.proposedRoles ?? []).join(', '));
  if (!test.docSource) return null;
  const roles = rolesLine(test);
  return (
    <div className="mt-2 space-y-1.5 rounded-card border border-rule p-3 text-sm" data-source-for={test.id}>
      <p className="text-ink">
        <Badge tone="stamp">Source</Badge> {docSourceLabel(test.docSource)}
      </p>
      {roles && (
        <p className="text-ink-soft">
          {roles}
          {!test.rolesConfirmed && !correcting && (
            <>
              {' '}
              <button
                type="button"
                className="btn-link text-sm"
                disabled={actions.busy}
                onClick={() => actions.editSource(confirmRolesEdit(test.id))}
              >
                Confirm roles
              </button>{' '}
              <button
                type="button"
                className="btn-link text-sm"
                disabled={actions.busy}
                onClick={() => setCorrecting(true)}
              >
                Correct roles
              </button>
            </>
          )}
        </p>
      )}
      {correcting && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block font-bold">Roles, separated by commas</span>
            <input className="field py-2 text-sm" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn-quiet btn-sm"
            disabled={actions.busy || parseRoles(typed).length === 0}
            onClick={() => {
              actions.editSource(confirmRolesEdit(test.id, parseRoles(typed)));
              setCorrecting(false);
            }}
          >
            Save roles
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <label className="flex items-center gap-2">
          <span className="font-bold">Severity if it differs</span>
          <select
            className="field w-auto py-2 text-sm"
            value={test.docSeverity ?? 'Major'}
            disabled={actions.busy}
            onChange={(e) => actions.editSource(severityEdit(test.id, e.target.value as FindingSeverity))}
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="h-5 w-5 accent-stamp"
            checked={!!test.docStale}
            disabled={actions.busy}
            onChange={(e) => actions.editSource(staleEdit(test.id, e.target.checked))}
          />
          Document is out of date
        </label>
      </div>
    </div>
  );
}

function TestRow({ test, page, actions }: { test: PlanPageTest; page: PlanPage; actions: PlanActions }) {
  return (
    <li id={itemDomId(test.id)} data-plan-item={test.id} className="rounded-control bg-canvas p-2 transition-all">
      <div className="flex items-start gap-2">
        <ItemToggle
          label={`Run the test “${test.name}”`}
          on={!test.skipped}
          disabled={actions.busy || !!page.skipped}
          onChange={(on) => actions.setSkipped(test.id, !on)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-base text-ink">
            <span className={test.skipped ? 'text-ink-soft line-through' : undefined}>{test.name}</span>
            {test.skipped && <Badge>Left out</Badge>}
            <SourceBadge source={test.source} />
            {test.needsTestCopy && (
              <Badge tone="warn" title="It sends a form or changes data, so it only runs on a test copy">
                Needs a Test Copy
              </Badge>
            )}
            {intentKey(test) !== 'works' && (
              <Badge tone="stamp" title={INTENT_HINTS[intentKey(test)]}>
                {INTENT_LABELS[intentKey(test)]}
              </Badge>
            )}
            {originLabel(test.origin) && <Badge>{originLabel(test.origin)}</Badge>}
          </div>
          {isDenial(test) ? (
            <p className="mt-1 text-sm text-ink-soft">
              Passes when {roleName(test.role)} cannot see this on the page. It only looks; it does not try to use it.
            </p>
          ) : (
            <>
              {openingLine(test) && (
                <p className="mt-1 text-sm text-ink-soft" data-testid="opening-steps">
                  {openingLine(test)}
                </p>
              )}
              <ol className="mt-1 list-decimal pl-5 text-sm text-ink-soft">
                {test.steps.map((step, i) => (
                  <li key={i}>{stepToSentence(step)}</li>
                ))}
              </ol>
            </>
          )}
          {test.offReason && <p className="mt-1 text-sm text-warn">{wontRunReason(test.offReason)}</p>}
          <SourceDetails test={test} actions={actions} />
          <Expected itemId={test.id} expectations={test.expectations} actions={actions} />
        </div>
      </div>
    </li>
  );
}

function PageRow({ page, actions }: { page: PlanPage; actions: PlanActions }) {
  const view = useContext(ViewContext);
  const ai = useContext(AiContext);
  const covered = page.coverage === 'covered';
  const tests = filterByIntent(page.tests, view.intent);
  return (
    <li id={itemDomId(page.id)} data-plan-item={page.id} className="rounded-card border border-rule p-3 transition-all">
      <div className="flex items-start gap-3">
        {!covered && (
          <ItemToggle
            label={`Test the page ${page.urlPath}`}
            on={!page.skipped}
            disabled={actions.busy}
            onChange={(on) => actions.setSkipped(page.id, !on)}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`break-all font-mono text-base font-bold ${page.skipped ? 'text-ink-soft line-through' : 'text-ink'}`}
            >
              {page.urlPath}
            </span>
            <span className="text-base text-ink-soft">{page.title}</span>
            {page.skipped && <Badge>Left out</Badge>}
            {page.coverage === 'sample' && <Badge tone="stamp">Sample page</Badge>}
            {page.coverage === 'promoted' && !page.added && <Badge tone="stamp">Tested on its own</Badge>}
            {page.added && <Badge tone="stamp">Added by you</Badge>}
            {page.isNew && <Badge tone="stamp">New</Badge>}
            {originLabel(page.origin) && <Badge>{originLabel(page.origin)}</Badge>}
            {page.unlinked && !page.added && <Badge tone="warn">No link leads here</Badge>}
            {!covered && <SourceBadge source={page.source} />}
          </div>
          {covered ? (
            <p className="mt-1 text-sm text-ink-soft">
              Same layout as {page.coveredBy?.join(', ')}, which are tested for it. Not visited.
            </p>
          ) : (
            <p className="mt-1 text-sm text-ink-soft">
              {page.clickPath
                ? page.clickPath.length > 0
                  ? `Reached by: Start → ${page.clickPath.join(' → ')}`
                  : 'The start page'
                : 'No link leads here'}{' '}
              · visited as {page.reachedBy.map(roleName).join(', ')}
            </p>
          )}
          {!covered && tests.length > 0 && (
            <ul className="mt-2 space-y-2">
              {tests.map((test) => (
                <TestRow key={test.id} test={test} page={page} actions={actions} />
              ))}
            </ul>
          )}
          {!covered && page.tests.length === 0 && (
            <p className="mt-2 text-sm text-ink-soft">Nothing to try beyond the visit. Every check still runs on it.</p>
          )}
          <div className="mt-2">
            {covered ? (
              <button
                type="button"
                className="btn-link text-sm disabled:cursor-not-allowed disabled:text-ink-soft"
                disabled={actions.busy}
                onClick={() => actions.promote(page.id)}
              >
                Test this page too
              </button>
            ) : ai ? (
              <ReplanControl
                label={`Re-plan ${page.urlPath} with the AI`}
                disabled={actions.busy}
                onReplan={(text) => actions.replan(page.id, text)}
              />
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

/** "Switch all off" / "Switch all on" for a group of items. */
function BulkSwitch({
  ids,
  skippedCount,
  actions,
  what,
}: {
  ids: string[];
  skippedCount: number;
  actions: PlanActions;
  what: string;
}) {
  if (ids.length < 2) return null;
  const allOff = skippedCount === ids.length;
  return (
    <button
      type="button"
      className="btn-link text-sm disabled:cursor-not-allowed disabled:text-ink-soft"
      disabled={actions.busy}
      onClick={() => actions.setSkippedMany(ids, !allOff)}
    >
      {allOff ? `Switch on ${what}` : `Switch off ${what}`}
    </button>
  );
}

function PagesSection({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const view = useContext(ViewContext);
  const pages = (plan.planPages || []).filter(
    (p) =>
      matches(view, `${p.urlPath} ${p.title} ${p.tests.map((t) => t.name).join(' ')}`) &&
      (!view.needsMe || pageNeedsMe(p)) &&
      (!view.intent || filterByIntent(p.tests, view.intent).length > 0)
  );
  const groups = plan.layoutGroups || [];
  const grouped = new Set(groups.flatMap((g) => g.pages));
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Section
      id="plan-pages"
      title="Pages"
      count={`${plan.planPages?.length ?? 0}, ${(plan.planPages ?? []).filter((p) => p.coverage !== 'covered').length} tested`}
      collapsible
      intro="Every page found. Each tested page is visited at every screen size, as everyone who reached it, and every check runs on it; the tests under it run too. Pages built from one layout are tested through a few Sample Pages."
    >
      <ChunkedList
        items={pages.filter((p) => !grouped.has(p.urlPath))}
        renderItem={(page) => <PageRow key={page.id} page={page} actions={actions} />}
      />
      {groups.map((group) => {
        const members = pages.filter((p) => group.pages.includes(p.urlPath));
        if (members.length === 0) return null;
        const testable = members.filter((p) => p.coverage !== 'covered');
        return (
          <CollapsibleGroup
            key={group.id}
            title={
              <span className="text-base font-bold text-ink">
                {group.name} · {group.pages.length} pages, {testable.length} tested
              </span>
            }
            startOpen={members.length <= 6}
            actions={
              <BulkSwitch
                ids={testable.map((p) => p.id)}
                skippedCount={testable.filter((p) => p.skipped).length}
                actions={actions}
                what="this group’s pages"
              />
            }
          >
            <ul className="space-y-2">
              {members.map((page) => (
                <PageRow key={page.id} page={page} actions={actions} />
              ))}
            </ul>
          </CollapsibleGroup>
        );
      })}
      {pages.length === 0 && <p className="text-sm text-ink-soft">No pages match.</p>}
      <form
        className="mt-6 grid gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await actions.addPage(address.trim());
            setAddress('');
          } catch (err) {
            setError(err instanceof Error ? err.message : 'The page couldn’t be added.');
          }
        }}
      >
        <label className="font-bold" htmlFor="add-page-address">
          Add a page no link reaches
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="add-page-address"
            className="field flex-1 py-2 text-sm"
            placeholder="For example: /admin"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <button type="submit" className="btn-quiet btn-sm" disabled={actions.busy || !address.trim()}>
            Add page
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-fail">
          {error}
        </p>
      )}
    </Section>
  );
}

function NavRow({ nav, actions }: { nav: NavigationCheck; actions: PlanActions }) {
  const ai = useContext(AiContext);
  const menuSizes = (nav.menuSteps || []).flatMap((s) => s.onlyAt || []);
  return (
    <li id={itemDomId(nav.id)} data-plan-item={nav.id} className="rounded-card border border-rule p-3 transition-all">
      <div className="flex items-start gap-2">
        <ItemToggle
          label={`Check the link: ${nav.name}`}
          on={!nav.skipped}
          disabled={actions.busy}
          onChange={(on) => actions.setSkipped(nav.id, !on)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-base text-ink">
            <span className={nav.skipped ? 'text-ink-soft line-through' : undefined}>{nav.name}</span>
            {nav.skipped && <Badge>Left out</Badge>}
            <SourceBadge source={nav.source} />
            {nav.isNew && <Badge tone="stamp">New</Badge>}
          </div>
          <p className="break-words text-sm text-ink-soft">
            {nav.leavesSite
              ? `Checked with one request: ${nav.to}`
              : `Clicks “${nav.linkName}” on ${nav.startPage}; ${nav.to} should open and work`}
            {nav.expectation ? `. Should show: ${nav.expectation}` : ''}
          </p>
          {Object.entries(nav.landsOnBy || {})
            .filter(([, landing]) => landing !== nav.to)
            .map(([who, landing]) => (
              <p key={who} className="text-sm text-ink-soft">
                {who === 'visitor' ? 'Signed-out visitors' : `As ${who}, it`} land{who === 'visitor' ? '' : 's'} on{' '}
                {landing} instead, as the site sends them there.
              </p>
            ))}
          {menuSizes.length > 0 && (
            <p className="text-sm text-ink-soft">Opens the menu first at {menuSizes.join(' and ')}.</p>
          )}
          {nav.notAt?.length ? (
            <p className="text-sm text-warn">
              Not checked at {nav.notAt.join(' and ')}: the link is hidden there and no menu button shows it.
            </p>
          ) : null}
          {nav.roles.some((r) => roleName(r) !== 'visitor') && (
            <p className="text-sm text-ink-soft">As {nav.roles.map(roleName).join(', ')}</p>
          )}
          {ai && (
            <ReplanControl
              label={`Re-plan the check “${nav.name}” with the AI`}
              disabled={actions.busy}
              onReplan={(text) => actions.replan(nav.id, text)}
            />
          )}
        </div>
      </div>
    </li>
  );
}

function NavigationSection({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const view = useContext(ViewContext);
  const all = plan.navigation || [];
  const navigation = all.filter(
    (n) => matches(view, `${n.name} ${n.to} ${n.startPage}`) && (!view.needsMe || navNeedsMe(n))
  );
  const shared = navigation.filter((n) => n.shared);
  const inPage = navigation.filter((n) => !n.shared && !n.leavesSite);
  const leaving = navigation.filter((n) => n.leavesSite);
  const starts = [...new Set(inPage.map((n) => n.startPage))];
  const hosts = plan.otherHosts || [];
  return (
    <Section
      id="plan-navigation"
      title="Navigation"
      count={all.length}
      collapsible
      intro="Every link is checked once: the shared menus for the whole site, and each page’s own links on that page. A check clicks the link as a person would, and passes when the right page opens and works."
    >
      {shared.length > 0 && (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-bold text-ink">Shared menus</h3>
            <BulkSwitch
              ids={shared.map((n) => n.id)}
              skippedCount={shared.filter((n) => n.skipped).length}
              actions={actions}
              what="every shared menu link"
            />
          </div>
          <ul className="mb-4 space-y-2">
            {shared.map((nav) => (
              <NavRow key={nav.id} nav={nav} actions={actions} />
            ))}
          </ul>
        </>
      )}
      {starts.length > 0 && (
        <>
          <h3 className="mb-2 text-lg font-bold text-ink">Links on pages</h3>
          {starts.map((start) => {
            const links = inPage.filter((n) => n.startPage === start);
            return (
              <CollapsibleGroup
                key={start}
                title={
                  <span>
                    <span className="font-mono">{start}</span> · {links.length} {links.length === 1 ? 'link' : 'links'}
                  </span>
                }
                startOpen={starts.length <= 3}
                actions={
                  <BulkSwitch
                    ids={links.map((n) => n.id)}
                    skippedCount={links.filter((n) => n.skipped).length}
                    actions={actions}
                    what="every link on this page"
                  />
                }
              >
                <ul className="space-y-2">
                  {links.map((nav) => (
                    <NavRow key={nav.id} nav={nav} actions={actions} />
                  ))}
                </ul>
              </CollapsibleGroup>
            );
          })}
        </>
      )}
      {(leaving.length > 0 || hosts.length > 0) && (
        <>
          <h3 className="mb-2 mt-4 text-lg font-bold text-ink">Links that leave the site</h3>
          {hosts.length > 0 && (
            <ul className="mb-3 space-y-1.5">
              {hosts.map((host) => (
                <li
                  key={host.host}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-canvas px-3 py-2 text-base text-ink"
                >
                  <span>
                    <span className="font-mono">{host.host}</span> · {host.links} {host.links === 1 ? 'link' : 'links'}
                  </span>
                  {host.included ? (
                    <Badge tone="pass">Explored</Badge>
                  ) : (
                    <button
                      type="button"
                      className="btn-link text-sm"
                      disabled={actions.busy}
                      onClick={() => actions.includeHost(host.host)}
                    >
                      Explore this site too
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <ChunkedList items={leaving} renderItem={(nav) => <NavRow key={nav.id} nav={nav} actions={actions} />} />
        </>
      )}
      {all.length === 0 && <p className="text-sm text-ink-soft">No links were found to check.</p>}
      {all.length > 0 && navigation.length === 0 && <p className="text-sm text-ink-soft">No links match.</p>}
    </Section>
  );
}

function DescribeTest({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const pages = (plan.planPages || []).filter((p) => p.coverage !== 'covered').map((p) => p.urlPath);
  const [urlPath, setUrlPath] = useState(pages[0] || '/');
  const [sentence, setSentence] = useState('');
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<InterpretResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (plan.aiAvailable === false) return null;
  return (
    <div className="mt-6 rounded-card border border-rule p-4">
      <h3 className="mb-1 text-lg font-bold text-ink">Add a test by describing it</h3>
      <p className="mb-3 text-sm text-ink-soft">For example: “Save with an empty amount — it should show an error”.</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="grid gap-1 sm:w-48">
          <label className="text-sm font-bold" htmlFor="describe-page">
            On the page
          </label>
          <select
            id="describe-page"
            className="field py-2 text-sm"
            value={urlPath}
            onChange={(e) => setUrlPath(e.target.value)}
          >
            {pages.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="grid flex-1 gap-1">
          <label className="text-sm font-bold" htmlFor="describe-sentence">
            What to do, and what should happen
          </label>
          <input
            id="describe-sentence"
            className="field py-2 text-sm"
            value={sentence}
            onChange={(e) => setSentence(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn-quiet btn-sm"
          disabled={working || actions.busy || !sentence.trim()}
          onClick={async () => {
            setWorking(true);
            setError(null);
            setResult(null);
            try {
              const r = await actions.describeTest(sentence.trim(), urlPath);
              if (r.ok && r.flow) setResult(r);
              else setError(r.message || 'That couldn’t be turned into a test. Try saying it another way.');
            } catch (err) {
              setError(err instanceof Error ? err.message : 'That couldn’t be turned into a test.');
            } finally {
              setWorking(false);
            }
          }}
        >
          {working ? 'Reading it…' : 'Turn into a test'}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-fail">
          {error}
        </p>
      )}
      {result?.flow && (
        <div className="mt-3 rounded-card border border-pass/40 bg-pass-tint p-3 text-sm">
          <p className="font-bold text-pass">{result.flow.name}</p>
          <ol className="mt-1 list-decimal pl-5 text-ink-soft">
            {result.flow.steps.map((s, i) => (
              <li key={i}>{stepToSentence(s)}</li>
            ))}
          </ol>
          <button
            type="button"
            className="btn-quiet btn-sm mt-2"
            disabled={actions.busy}
            onClick={async () => {
              await actions.addJourney(result.flow!);
              setSentence('');
              setResult(null);
            }}
          >
            Add this test to the plan
          </button>
        </div>
      )}
    </div>
  );
}

function SortableJourneyItem({ flow, actions }: { flow: DiscoveredFlow; actions: PlanActions }) {
  const id = `journey:${flow.id}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: flow.id });
  const ai = useContext(AiContext);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      id={itemDomId(id)}
      data-plan-item={id}
      className={`rounded-card border border-rule bg-surface p-3.5 transition-all ${
        isDragging ? 'bg-panel shadow-level-4 ring-2 ring-stamp' : ''
      }`}
    >
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder journey: ${flow.name}`}
          title="Drag to reorder"
          className="-my-1.5 inline-flex h-11 w-11 shrink-0 cursor-grab items-center justify-center rounded-control text-ink-soft hover:bg-panel hover:text-ink active:cursor-grabbing"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <circle cx="7" cy="4" r="1.5" />
            <circle cx="13" cy="4" r="1.5" />
            <circle cx="7" cy="10" r="1.5" />
            <circle cx="13" cy="10" r="1.5" />
            <circle cx="7" cy="16" r="1.5" />
            <circle cx="13" cy="16" r="1.5" />
          </svg>
        </button>
        <ItemToggle
          label={`Run the journey “${flow.name}”`}
          on={!flow.outOfScope}
          disabled={actions.busy}
          onChange={(on) => actions.setSkipped(id, !on)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <EditableTitle
              value={flow.name}
              onSave={(nextName) => void actions.renameJourney?.(flow.id, nextName)}
              disabled={actions.busy}
              className={`text-base font-bold ${flow.outOfScope ? 'text-ink-soft line-through' : 'text-ink'}`}
            />
            {flow.outOfScope && <Badge>Left out</Badge>}
            {roleName(flow.role) !== 'visitor' && (
              <span className="font-normal text-ink-soft">as {roleName(flow.role)}</span>
            )}
            <SourceBadge source={flow.source} />
            {flow.isNew && <Badge tone="stamp">New</Badge>}
            {flow.needsTestCopy && <Badge tone="warn">Needs a Test Copy</Badge>}
            {intentKey(flow) !== 'works' && (
              <Badge tone="stamp" title={INTENT_HINTS[intentKey(flow)]}>
                {INTENT_LABELS[intentKey(flow)]}
              </Badge>
            )}
          </div>
          {flow.description && <p className="mt-0.5 text-sm text-ink-soft">{flow.description}</p>}
          <ol className="mt-2 list-decimal pl-5 text-sm text-ink">
            {flow.steps.map((step, i) => (
              <li key={i}>{stepToSentence(step)}</li>
            ))}
          </ol>
          <Expected itemId={id} expectations={flow.candidateExpectations} actions={actions} />
          {flow.needsHelp?.map((help, i) => (
            <p key={i} className="mt-1 text-sm text-warn">
              {help}
            </p>
          ))}
          {ai && (
            <div className="mt-2">
              <ReplanControl
                label={`Re-plan the journey “${flow.name}” with the AI`}
                disabled={actions.busy}
                onReplan={(text) => actions.replan(id, text)}
              />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function JourneysSection({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const view = useContext(ViewContext);
  const flows = plan.flows.filter(
    (f) =>
      matches(view, `${f.name} ${f.description} ${f.startPage}`) &&
      (!view.needsMe || flowNeedsMe(f)) &&
      (!view.intent || intentKey(f) === view.intent)
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !actions.reorderJourneys) return;
    const oldIndex = plan.flows.findIndex((f) => f.id === active.id);
    const newIndex = plan.flows.findIndex((f) => f.id === over.id);
    if (oldIndex !== -1 && newIndex !== -1) {
      void actions.reorderJourneys(oldIndex, newIndex);
    }
  };

  return (
    <Section
      id="plan-journeys"
      title="Journeys"
      count={plan.flows.length}
      collapsible
      intro="Things a person does across pages to get something done, step by step. Drag by the handle to change priority."
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={flows.map((f) => f.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-3">
            {flows.map((flow) => (
              <SortableJourneyItem key={flow.id} flow={flow} actions={actions} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {plan.flows.length === 0 && <p className="text-sm text-ink-soft">No journeys across pages were planned.</p>}
      {plan.flows.length > 0 && flows.length === 0 && <p className="text-sm text-ink-soft">No journeys match.</p>}
      <DescribeTest plan={plan} actions={actions} />
    </Section>
  );
}

function ChecksSection({ plan }: { plan: ReviewPlan }) {
  const sizes = (plan.screenSizes?.length ? plan.screenSizes : SIZES).join(', ');
  return (
    <Section
      id="plan-checks"
      title="Checks on every tested page"
      intro={`At ${sizes}, as ${(plan.roles?.length ? plan.roles : ['visitor']).map(roleName).join(', ')}. Each is graded in the report.`}
    >
      <ul className="space-y-2 text-base">
        {(plan.gradedChecks || []).map((check) => (
          <li key={check.id} id={itemDomId(check.id)}>
            <strong className="text-ink">{check.name}:</strong>{' '}
            <span className="text-ink-soft">{check.description}</span>
            {check.notGraded && (
              <span className="mt-0.5 block text-sm text-warn">Won’t be graded this time. {check.notGraded}</span>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function WontRunSection({ plan }: { plan: ReviewPlan }) {
  const items = plan.wontRun || [];
  return (
    <Section id="plan-wontrun" title="Won’t run" count={items.length} collapsible>
      {items.length === 0 ? (
        <p className="text-sm text-ink-soft">Everything in the plan runs.</p>
      ) : (
        <ul className="space-y-1.5 text-base">
          {items.map((item, i) => (
            <li key={i} className="flex items-start justify-between gap-3">
              <span>
                <strong className="text-ink">{item.what}</strong>{' '}
                <span className="text-ink-soft">— {wontRunReason(item.reason)}</span>
              </span>
              {item.itemId && (
                <button
                  type="button"
                  className="btn-link min-w-[44px] shrink-0 justify-center text-sm"
                  onClick={() => showItem(item.itemId!)}
                >
                  Show
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Documented items with no matching page or control in the app: listed, never counted as failures. */
function NotFoundSection({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const groups = notFoundByDocument(plan.notFound);
  const line = documentedLine(plan.documentedItems);
  if (groups.length === 0 && !line) return null;
  return (
    <Section
      id="plan-notfound"
      title="Not found in app"
      startOpen
      count={groups.reduce((n, g) => n + g.items.length, 0)}
      intro={`${line ? `${line}. ` : ''}These are in your documents but the scan found no matching page or control. They are not counted as failures. Remove one if it is not meant to exist, or add the page and scan again.`}
      collapsible
    >
      {groups.map((group) => (
        <div key={group.document} className="mb-3">
          <h3 className="mb-1 text-lg font-bold text-ink">{group.document}</h3>
          <ul className="space-y-1.5 text-base">
            {group.items.map((item) => (
              <li key={item.id} id={itemDomId(item.id)} className="flex items-start justify-between gap-3">
                <span>
                  <strong className="text-ink">{item.docSource.section ?? item.docSource.document}</strong>{' '}
                  <span className="text-ink-soft">— {item.reason}</span>
                </span>
                <button
                  type="button"
                  className="btn-link min-w-[44px] shrink-0 justify-center text-sm"
                  disabled={actions.busy}
                  onClick={() => actions.editNotFound(removeNotFoundEdit(item.id))}
                >
                  Remove from the list
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Section>
  );
}

/** A role the scan could not sign in as: it is not tested, and why. */
function RolesNotTestedSection({ plan }: { plan: ReviewPlan }) {
  const items = plan.rolesNotTested ?? [];
  if (items.length === 0) return null;
  return (
    <Section
      id="plan-roles-not-tested"
      title="Roles not tested and why"
      count={items.length}
      intro="These roles are left out of the check-up. The other roles and the visitor are still tested."
    >
      <ul className="space-y-1.5 text-base">
        {items.map((item) => (
          <li key={item.role}>
            <strong className="text-ink">{roleName(item.role)}:</strong>{' '}
            <span className="text-ink-soft">{item.text}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function DocsSection({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const [productContext, setProductContext] = useState(plan.productContext || '');
  const [designNotes, setDesignNotes] = useState(plan.designNotes || '');
  // A re-plan or another change brings new text: the boxes follow it.
  useEffect(() => setProductContext(plan.productContext || ''), [plan.productContext]);
  useEffect(() => setDesignNotes(plan.designNotes || ''), [plan.designNotes]);
  return (
    <Section
      id="plan-docs"
      title="Product context and design notes"
      intro="The AI plans with these. Change them, then re-plan so the plan uses them."
    >
      <label className="label" htmlFor="plan-product-context">
        Product context, requirements or user stories
      </label>
      <textarea
        id="plan-product-context"
        rows={5}
        className="field mb-3 w-full font-mono text-sm"
        value={productContext}
        onChange={(e) => setProductContext(e.target.value)}
      />
      <label className="label" htmlFor="plan-design-notes">
        Design notes
      </label>
      <textarea
        id="plan-design-notes"
        rows={4}
        className="field mb-3 w-full font-mono text-sm"
        value={designNotes}
        onChange={(e) => setDesignNotes(e.target.value)}
      />
      <button
        type="button"
        className="btn-quiet btn-sm"
        disabled={actions.busy}
        onClick={() => actions.saveDocsAndReplan(productContext, designNotes)}
      >
        Save and re-plan everything with the AI
      </button>
    </Section>
  );
}

/** Filter chips: show only the items with one Intent. Pressing the chosen one again shows all. */
function IntentChips({ plan, view, setView }: { plan: ReviewPlan; view: View; setView: (v: View) => void }) {
  const present = intentsInPlan(plan);
  // A filter needs at least two things to choose between.
  if (present.length < 2) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Show by Intent"
      data-testid="intent-chips"
    >
      <span className="text-sm text-ink-soft">Show only one Intent:</span>
      {present.map((c) => {
        const pressed = view.intent === c.intent;
        return (
          <button
            key={c.intent}
            type="button"
            aria-pressed={pressed}
            title={INTENT_HINTS[c.intent]}
            data-testid={`intent-chip-${c.intent}`}
            className={`min-h-[44px] rounded-control border-[1.5px] px-3 text-sm font-bold ${pressed ? 'border-ink bg-ink text-surface' : 'border-edge text-ink hover:border-ink'}`}
            onClick={() => setView({ ...view, intent: pressed ? null : c.intent })}
          >
            {c.label} ({c.items})
          </button>
        );
      })}
    </div>
  );
}

/** Narrowing the plan: find words, show only what needs the reader, one Intent, open or close every section. */
function PlanFinder({ plan, view, setView }: { plan: ReviewPlan; view: View; setView: (v: View) => void }) {
  const pages = plan.planPages || [];
  const navigation = plan.navigation || [];
  const unanswered = plan.questions.filter((q) => !q.selectedAnswer).length;
  const needsMe =
    unanswered +
    pages.filter((p) => p.coverage !== 'covered' && pageNeedsMe(p)).length +
    navigation.filter(navNeedsMe).length +
    plan.flows.filter(flowNeedsMe).length;
  return (
    <div className="grid gap-3 border-t border-rule pt-6">
      <label className="font-bold" htmlFor="plan-filter">
        Find in the plan
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          id="plan-filter"
          type="search"
          className="field flex-1 py-2 text-base"
          placeholder="A page, link or journey"
          value={view.query}
          onChange={(e) => setView({ ...view, query: e.target.value })}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-base text-ink">
            <input
              type="checkbox"
              className="h-5 w-5 accent-stamp"
              checked={view.needsMe}
              onChange={(e) => setView({ ...view, needsMe: e.target.checked })}
            />
            Only what needs me ({needsMe})
          </label>
          <button
            type="button"
            className="btn-quiet btn-sm"
            onClick={() => setView({ ...view, expandAll: view.expandAll ? false : true })}
          >
            {view.expandAll ? 'Close every section' : 'Open every section'}
          </button>
        </div>
      </div>
      <IntentChips plan={plan} view={view} setView={setView} />
    </div>
  );
}

function usePlanKeyboardNavigation() {
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const chordRef = useRef<string | null>(null);
  const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      // WCAG 2.1.4: single-key shortcuts never fire while someone types in a form control.
      if (isTypingTarget(activeEl) || document.querySelector('[role="dialog"]') !== null) {
        return;
      }
      // The person can switch j, k, g and G off (Keyboard shortcuts panel).
      if (isSingleKeyShortcut(e.key) && !readSingleKeyShortcuts()) {
        chordRef.current = null;
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Esc lets go of the item that j or k picked.
      if (e.key === 'Escape') {
        if (activeItemId) setActiveItemId(null);
        return;
      }

      // Enter and Space belong to the control that has focus: a button, link, tab or disclosure works as usual.
      const onControl =
        activeEl instanceof Element &&
        !!activeEl.closest('button, a[href], [role="tab"], [role="button"], input, textarea, select, summary');
      if ((e.key === 'Enter' || e.key === ' ') && onControl) return;

      // Handle 'g' chords
      if (chordRef.current === 'g') {
        if (chordTimerRef.current) clearTimeout(chordTimerRef.current);
        chordRef.current = null;

        const targetMap: Record<string, string> = {
          s: 'plan-summary',
          p: 'plan-pages',
          n: 'plan-navigation',
          j: 'plan-journeys',
          q: 'plan-questions',
          w: 'plan-wontrun',
          d: 'plan-docs',
          c: 'plan-checks',
        };

        if (e.key === 'g') {
          e.preventDefault();
          window.scrollTo({ top: 0, behavior: scrollBehavior() });
          return;
        }

        const targetId = targetMap[e.key.toLowerCase()];
        if (targetId) {
          e.preventDefault();
          const sectionEl = document.getElementById(targetId);
          if (sectionEl) openOwnSection(sectionEl);
          const targetEl = sectionEl || document.getElementById(`${targetId}-title`);
          targetEl?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
          return;
        }
      }

      if (e.key === 'g') {
        chordRef.current = 'g';
        if (chordTimerRef.current) clearTimeout(chordTimerRef.current);
        chordTimerRef.current = setTimeout(() => {
          chordRef.current = null;
        }, 1200);
        return;
      }

      if (e.key === 'G') {
        e.preventDefault();
        window.scrollTo({ top: document.body.scrollHeight, behavior: scrollBehavior() });
        return;
      }

      const items = Array.from(document.querySelectorAll<HTMLElement>('[data-plan-item]')).filter(
        (el) => el.offsetParent !== null
      );
      if (items.length === 0) return;

      const currentIndex = items.findIndex((el) => el.dataset.planItem === activeItemId);

      if (e.key === 'j') {
        e.preventDefault();
        const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        const nextItem = items[nextIndex];
        const nextId = nextItem.dataset.planItem || null;
        setActiveItemId(nextId);
        nextItem.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' });
        return;
      }

      if (e.key === 'k') {
        e.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        const prevItem = items[prevIndex];
        const prevId = prevItem.dataset.planItem || null;
        setActiveItemId(prevId);
        prevItem.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' });
        return;
      }

      if (e.key === ' ' && activeItemId) {
        const activeItem = items.find((el) => el.dataset.planItem === activeItemId);
        if (activeItem) {
          const checkbox = activeItem.querySelector<HTMLInputElement>('input[type="checkbox"]');
          if (checkbox) {
            e.preventDefault();
            checkbox.click();
            return;
          }
        }
      }

      if (e.key === 'Enter' && activeItemId) {
        const activeItem = items.find((el) => el.dataset.planItem === activeItemId);
        if (activeItem) {
          const details =
            activeItem.querySelector('details') || (activeItem.closest('details') as HTMLDetailsElement | null);
          if (details) {
            e.preventDefault();
            details.open = !details.open;
            return;
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (chordTimerRef.current) clearTimeout(chordTimerRef.current);
    };
  }, [activeItemId]);

  useEffect(() => {
    if (!activeItemId) return;
    const target = document.querySelector<HTMLElement>(`[data-plan-item="${activeItemId}"]`);
    if (target) {
      target.classList.add('ring-2', 'ring-stamp', 'bg-stamp-tint');
      return () => {
        target.classList.remove('ring-2', 'ring-stamp', 'bg-stamp-tint');
      };
    }
  }, [activeItemId]);

  return { activeItemId };
}

/** The complete plan as one readable document: everything that will run, and everything that won't. */
export function PlanDocument({
  plan,
  actions,
  startExpanded = false,
}: {
  plan: ReviewPlan;
  actions: PlanActions;
  /** Every section open on arrival. The default is closed, except "Needs your answer". */
  startExpanded?: boolean;
}) {
  const [view, setView] = useState<View>({ query: '', needsMe: false, expandAll: startExpanded ? true : undefined });
  // The search box updates at once; the sections follow when the browser has time, so typing never lags.
  const deferredView = useDeferredValue(view);
  usePlanKeyboardNavigation();

  useEffect(() => {
    const openAll = () => setView((v) => ({ ...v, expandAll: true }));
    window.addEventListener(OPEN_ALL_EVENT, openAll);
    return () => window.removeEventListener(OPEN_ALL_EVENT, openAll);
  }, []);

  useEffect(() => {
    const findTarget = (decoded: string): HTMLElement | null =>
      document.getElementById(decoded) ||
      document.getElementById(itemDomId(decoded)) ||
      Array.from(document.querySelectorAll<HTMLElement>('[data-plan-item]')).find(
        (el) => el.dataset.planItem === decoded
      ) ||
      null;
    const reveal = (target: HTMLElement) => {
      openOwnSection(target);
      let parent = target.parentElement;
      while (parent) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
      }
      target.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
      target.classList.add('ring-2', 'ring-stamp', 'transition-all', 'duration-slow');
      window.setTimeout(() => {
        target.classList.remove('ring-2', 'ring-stamp');
      }, 3000);
    };
    let frame: number | null = null;
    const handleHash = () => {
      const raw = window.location.hash.slice(1);
      if (!raw) return;
      const decoded = safeDecodeHash(raw);
      if (decoded === null) return;
      const target = findTarget(decoded);
      if (target) {
        reveal(target);
        return;
      }
      // The item is inside a closed section: open every section, then find it (same as showItem).
      window.dispatchEvent(new Event(OPEN_ALL_EVENT));
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          frame = null;
          const later = findTarget(decoded);
          if (later) reveal(later);
        });
      });
    };

    const timer = window.setTimeout(handleHash, 150);
    window.addEventListener('hashchange', handleHash);
    return () => {
      window.clearTimeout(timer);
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', handleHash);
    };
  }, []);

  return (
    <ViewContext.Provider value={deferredView}>
      <AiContext.Provider value={plan.aiAvailable !== false}>
        {/* What needs an answer first, then the summary, then everything that runs, then what doesn't. */}
        <div className="w-full space-y-10">
          <QuestionsSection plan={plan} actions={actions} />
          <SummarySection plan={plan} actions={actions} />
          <PlanFinder plan={plan} view={view} setView={setView} />
          <PagesSection plan={plan} actions={actions} />
          <NavigationSection plan={plan} actions={actions} />
          <JourneysSection plan={plan} actions={actions} />
          <ChecksSection plan={plan} />
          <WontRunSection plan={plan} />
          <RolesNotTestedSection plan={plan} />
          <NotFoundSection plan={plan} actions={actions} />
          <DocsSection plan={plan} actions={actions} />
        </div>
      </AiContext.Provider>
    </ViewContext.Provider>
  );
}
