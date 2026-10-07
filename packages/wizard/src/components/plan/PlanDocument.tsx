import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type {
  Breakpoint,
  DiscoveredFlow,
  NavigationCheck,
  PlanPage,
  PlanPageTest,
  ReviewPlan,
  RoleCredential,
  TestCaseExpectations,
} from '@qa/types';
import { stepToSentence, expectationsToChecks } from '../../lib/plan-translate';
import type { InterpretResult } from '../../api';
import { Badge, ItemToggle, ReplanControl, SourceBadge, itemDomId, showItem } from './parts';
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

/** What the person can do to the plan from the document. Each change goes to the QA Tool. */
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
}

const SIZES: Breakpoint[] = ['375px', '768px', '1440px'];
const SIZE_NAMES: Record<Breakpoint, string> = {
  '375px': 'Phone (375px)',
  '768px': 'Tablet (768px)',
  '1440px': 'Desktop (1440px)',
};
/** Sections longer than this start collapsed. */
const COLLAPSE_OVER = 20;

/** Who a role is, in the words the rest of the plan uses. */
function roleName(role: string | undefined): string {
  return !role || role === 'anonymous' || role === 'visitor' ? 'visitor' : role;
}

/** What the reader is narrowing the plan to: words to find, and whether only items needing them show. */
interface View {
  query: string;
  needsMe: boolean;
  expandAll?: boolean | null;
}
const ViewContext = createContext<View>({ query: '', needsMe: false });

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

function Section({
  id,
  title,
  count,
  intro,
  collapsible,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  intro?: string;
  /** Starts collapsed when long, unless the reader is looking for something. */
  collapsible?: boolean;
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
        : (count ?? 0) <= COLLAPSE_OVER || !!view.query.trim() || view.needsMe;
    const [open, setOpen] = useState(shouldOpen);

    useEffect(() => {
      if (view.expandAll !== undefined && view.expandAll !== null) {
        setOpen(view.expandAll);
      } else if (view.query.trim() || view.needsMe) {
        setOpen(true);
      }
    }, [view.expandAll, view.query, view.needsMe]);

    return (
      <section
        id={id}
        aria-labelledby={`${id}-title`}
        className="scroll-mt-4 rounded-card border border-rule bg-surface/70 shadow-level-2"
      >
        <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="flex min-h-[56px] cursor-pointer items-center px-5 py-3">
            <h2 id={`${id}-title`} className="text-lg font-bold text-ink">
              {heading}
            </h2>
          </summary>
          {open && (
            <div className="px-5 pb-5">
              {intro && <p className="mb-4 max-w-prose text-sm text-ink-soft">{intro}</p>}
              {children}
            </div>
          )}
        </details>
      </section>
    );
  }
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-4 rounded-card border border-rule bg-surface/70 shadow-level-2 p-5"
    >
      <h2 id={`${id}-title`} className="mb-1 text-lg font-bold text-ink">
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
  headerRight,
  children,
}: {
  title: React.ReactNode;
  startOpen: boolean;
  headerRight?: React.ReactNode;
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
      className="mb-2 rounded-card border border-rule bg-surface/50 shadow-level-1"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex min-h-[48px] cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-base text-ink">
        <span>{title}</span>
        {headerRight}
      </summary>
      {open && <div className="p-3">{children}</div>}
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
          <button
            type="button"
            className="btn-quiet rounded-control min-h-[36px] px-4 py-1 text-sm font-bold text-stamp hover:text-stamp-dark"
            onClick={() => setVisibleCount((c) => c + chunkSize)}
          >
            Show {Math.min(remaining, chunkSize)} more ({remaining} remaining)
          </button>
        </div>
      )}
    </div>
  );
}

export function EditableTitle({
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
        className="inline-flex items-center gap-1.5"
      >
        <input
          ref={inputRef}
          type="text"
          className="field rounded-control px-2 py-0.5 text-sm font-bold"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setText(value);
              setEditing(false);
            }
          }}
          onBlur={() => {
            const trimmed = text.trim();
            if (trimmed && trimmed !== value) {
              onSave(trimmed);
            }
            setEditing(false);
          }}
          disabled={disabled}
        />
        <button
          type="submit"
          className="btn-quiet rounded-control px-2 py-0.5 text-xs font-bold text-stamp hover:text-stamp-dark"
          disabled={disabled || !text.trim()}
        >
          Save
        </button>
        <button
          type="button"
          className="btn-quiet rounded-control px-2 py-0.5 text-xs text-ink-soft hover:text-ink"
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
    <span className="group/edit inline-flex items-center gap-1.5">
      <span className={className}>{value}</span>
      {!disabled && (
        <button
          type="button"
          aria-label={`Edit name: ${value}`}
          title="Click to rename"
          className="rounded-control p-1 text-ink-soft opacity-0 transition-opacity hover:bg-panel hover:text-stamp group-hover/edit:opacity-100 focus:opacity-100"
          onClick={() => setEditing(true)}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
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
            className="min-h-[32px] font-bold text-stamp hover:underline disabled:opacity-50"
            disabled={actions.busy}
            onClick={() => actions.setExpectation(itemId)}
          >
            Confirm
          </button>
          <button
            type="button"
            className="min-h-[32px] font-bold text-stamp hover:underline disabled:opacity-50"
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
          <input
            className="field flex-1 py-2 text-sm"
            aria-label="The wording that should show"
            placeholder="The wording that should show afterwards"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <button
            type="submit"
            className="btn-primary min-h-[44px] px-4 text-sm"
            disabled={actions.busy || !text.trim()}
          >
            Save
          </button>
          <button type="button" className="btn-link text-sm" onClick={() => setEditing(false)}>
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
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button
        type="button"
        className="btn-quiet mt-3 min-h-[44px] px-4 text-sm"
        disabled={actions.busy}
        onClick={() => setOpen(true)}
      >
        Add a sign-in
      </button>
    );
  }
  return (
    <form
      className="mt-3 grid gap-3 rounded-md border border-rule p-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await actions.addSignIn({
            role: role.trim() || 'member',
            username: username.trim(),
            password,
            loginPath: loginPath.trim() || undefined,
          });
          setOpen(false);
          setPassword('');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'The sign-in couldn’t be added.');
        }
      }}
    >
      <p className="text-sm text-ink-soft sm:col-span-2">
        The QA Tool signs in, explores what that role sees, and adds it to the plan. The details stay in memory only.
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
        <span className="mb-1 block font-bold">Sign-in page (optional)</span>
        <input
          className="field py-2 text-sm"
          placeholder="/login"
          value={loginPath}
          onChange={(e) => setLoginPath(e.target.value)}
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
      {error && (
        <p role="alert" className="text-sm text-fail sm:col-span-2">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <button
          type="submit"
          className="btn-primary min-h-[44px] px-4 text-sm"
          disabled={actions.busy || !username.trim() || !password}
        >
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

function SummarySection({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const sizes = plan.screenSizes?.length ? plan.screenSizes : SIZES;
  const budget = plan.budget;
  const notReached =
    (plan.wontRun || []).some((w) => /behind a sign-in/i.test(w.reason)) ||
    (plan.notes || []).some((n) => /sign-in|sign in/i.test(n));
  const tokens = Object.entries(budget?.tokens || {});
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
              <button type="button" className="btn-link shrink-0 text-sm" onClick={() => showItem(line.itemIds[0])}>
                Show
              </button>
            )}
          </li>
        ))}
      </ul>

      <fieldset className="mt-5">
        <legend className="label mb-2">Screen sizes</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {SIZES.map((size) => {
            const on = sizes.includes(size);
            return (
              <label key={size} className="flex min-h-[44px] cursor-pointer items-center gap-2 text-base text-ink">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[#6C9BF2]"
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
      <button type="button" className="btn-link text-sm" disabled={actions.busy} onClick={actions.quickCheck}>
        Make it a quick check: desktop only, and only the shared menus’ links
      </button>

      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
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
        <details className="mt-3 text-sm">
          <summary className="min-h-[32px] cursor-pointer text-ink-soft">AI tokens used</summary>
          <table className="mt-2 text-left text-sm">
            <thead className="text-ink-soft">
              <tr>
                <th className="pr-4 font-normal">Stage</th>
                <th className="pr-4 font-normal">Requests</th>
                <th className="pr-4 font-normal">Sent</th>
                <th className="pr-4 font-normal">Answered</th>
                <th className="font-normal">Of which thinking</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map(([stage, u]) => (
                <tr key={stage}>
                  <td className="pr-4">{TOKEN_STAGES[stage] ?? stage}</td>
                  <td className="pr-4">
                    {u!.requests}
                    {u!.truncated ? ` (${u!.truncated} cut off)` : ''}
                  </td>
                  <td className="pr-4">{u!.promptTokens.toLocaleString()}</td>
                  <td className="pr-4">{u!.completionTokens.toLocaleString()}</td>
                  <td>{u!.reasoningTokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {plan.readOnlyReason && (
        <p className="mt-4 rounded border border-warn/40 bg-warn-tint/40 p-3 text-sm text-ink">{plan.readOnlyReason}</p>
      )}
      {(plan.notes || []).length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-ink">
          {plan.notes!.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      )}
      {notReached && <AddSignIn actions={actions} />}
      <div>
        <button
          type="button"
          className="btn-quiet mt-4 min-h-[44px] px-4 text-sm"
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
  return (
    <Section
      id="plan-questions"
      title="Questions before testing"
      count={plan.questions.length}
      collapsible
      intro="Anything you leave unanswered uses the safe answer, which sends and deletes nothing."
    >
      <ul className="space-y-3">
        {shown.map((q) => (
          <li
            key={q.id}
            id={itemDomId(q.id)}
            data-plan-item={q.id}
            className="rounded border border-rule p-3 transition-all"
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
                    className={`min-h-[44px] rounded px-3 py-2 text-sm ${picked ? 'bg-stamp font-bold text-surface' : 'border border-rule text-ink hover:border-edge'}`}
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

function TestRow({ test, page, actions }: { test: PlanPageTest; page: PlanPage; actions: PlanActions }) {
  return (
    <li
      id={itemDomId(test.id)}
      data-plan-item={test.id}
      className={`rounded bg-canvas/60 p-2 transition-all ${test.skipped ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-2">
        <ItemToggle
          label={`Run the test “${test.name}”`}
          on={!test.skipped}
          disabled={actions.busy || !!page.skipped}
          onChange={(on) => actions.setSkipped(test.id, !on)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-base text-ink">
            {test.name}
            <SourceBadge source={test.source} />
            {test.needsTestCopy && (
              <Badge tone="warn" title="It sends a form or changes data, so it only runs on a test copy">
                Needs a test copy
              </Badge>
            )}
          </div>
          <ol className="mt-1 list-decimal pl-5 text-sm text-ink-soft">
            {test.steps.map((step, i) => (
              <li key={i}>{stepToSentence(step)}</li>
            ))}
          </ol>
          <Expected itemId={test.id} expectations={test.expectations} actions={actions} />
        </div>
      </div>
    </li>
  );
}

function PageRow({ page, actions }: { page: PlanPage; actions: PlanActions }) {
  const covered = page.coverage === 'covered';
  return (
    <li
      id={itemDomId(page.id)}
      data-plan-item={page.id}
      className={`rounded border border-rule p-3 transition-all ${page.skipped ? 'opacity-60' : ''}`}
    >
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
            <span className="break-all font-mono text-base font-bold text-ink">{page.urlPath}</span>
            <span className="text-base text-ink-soft">{page.title}</span>
            {page.coverage === 'sample' && <Badge tone="stamp">Sample page</Badge>}
            {page.coverage === 'promoted' && !page.added && <Badge tone="stamp">Tested on its own</Badge>}
            {page.added && <Badge tone="stamp">Added by you</Badge>}
            {page.isNew && <Badge tone="stamp">New</Badge>}
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
          {!covered && page.tests.length > 0 && (
            <ul className="mt-2 space-y-2">
              {page.tests.map((test) => (
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
                className="min-h-[32px] text-sm font-bold text-stamp hover:underline disabled:opacity-50"
                disabled={actions.busy}
                onClick={() => actions.promote(page.id)}
              >
                Test this page too
              </button>
            ) : (
              <ReplanControl
                label={`Re-plan ${page.urlPath} with the AI`}
                disabled={actions.busy}
                onReplan={(text) => actions.replan(page.id, text)}
              />
            )}
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
      className="min-h-[32px] text-sm font-bold text-stamp hover:underline disabled:opacity-50"
      disabled={actions.busy}
      onClick={(e) => {
        e.preventDefault();
        actions.setSkippedMany(ids, !allOff);
      }}
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
      (!view.needsMe || pageNeedsMe(p))
  );
  const groups = plan.layoutGroups || [];
  const grouped = new Set(groups.flatMap((g) => g.pages));
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Section
      id="plan-pages"
      title="Pages"
      count={plan.planPages?.length ?? 0}
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
            headerRight={
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
        className="mt-4 flex flex-col gap-2 sm:flex-row"
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
        <label className="sr-only" htmlFor="add-page-address">
          Add a page by its address
        </label>
        <input
          id="add-page-address"
          className="field flex-1 py-2 text-sm"
          placeholder="Add a page no link reaches, e.g. /admin"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <button
          type="submit"
          className="btn-quiet min-h-[44px] px-4 text-sm"
          disabled={actions.busy || !address.trim()}
        >
          Add page
        </button>
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
  const menuSizes = (nav.menuSteps || []).flatMap((s) => s.onlyAt || []);
  return (
    <li
      id={itemDomId(nav.id)}
      data-plan-item={nav.id}
      className={`rounded border border-rule p-2.5 transition-all ${nav.skipped ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-2">
        <ItemToggle
          label={`Check the link: ${nav.name}`}
          on={!nav.skipped}
          disabled={actions.busy}
          onChange={(on) => actions.setSkipped(nav.id, !on)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-base text-ink">
            {nav.name}
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
          <ReplanControl
            label={`Re-plan the check “${nav.name}” with the AI`}
            disabled={actions.busy}
            onReplan={(text) => actions.replan(nav.id, text)}
          />
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
            <h3 className="text-base font-bold text-ink">Shared menus</h3>
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
          <h3 className="mb-2 text-base font-bold text-ink">Links on pages</h3>
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
                headerRight={
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
          <h3 className="mb-2 mt-4 text-base font-bold text-ink">Links that leave the site</h3>
          {hosts.length > 0 && (
            <ul className="mb-3 space-y-1.5">
              {hosts.map((host) => (
                <li
                  key={host.host}
                  className="flex flex-wrap items-center justify-between gap-2 rounded bg-canvas/60 px-3 py-2 text-base text-ink"
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
    <div className="mt-4 rounded border border-rule bg-canvas/60 p-4">
      <h3 className="mb-1 text-base font-bold text-ink">Add a test by describing it</h3>
      <p className="mb-3 text-sm text-ink-soft">For example: “Save with an empty amount — it should show an error”.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="describe-page">
          On the page
        </label>
        <select
          id="describe-page"
          className="field py-2 text-sm sm:w-48"
          value={urlPath}
          onChange={(e) => setUrlPath(e.target.value)}
        >
          {pages.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="describe-sentence">
          Describe the test
        </label>
        <input
          id="describe-sentence"
          className="field flex-1 py-2 text-sm"
          value={sentence}
          onChange={(e) => setSentence(e.target.value)}
          placeholder="What to do, and what should happen"
        />
        <button
          type="button"
          className="btn-quiet min-h-[44px] px-4 text-sm"
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
        <div className="mt-3 rounded border border-pass/40 bg-pass-tint/30 p-3 text-sm">
          <p className="font-bold text-pass">{result.flow.name}</p>
          <ol className="mt-1 list-decimal pl-5 text-ink-soft">
            {result.flow.steps.map((s, i) => (
              <li key={i}>{stepToSentence(s)}</li>
            ))}
          </ol>
          <button
            type="button"
            className="btn-primary mt-2 min-h-[44px] px-4 text-sm"
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
      className={`rounded-card border border-rule bg-surface/80 p-3.5 shadow-level-1 transition-all hover:shadow-level-2 ${
        flow.outOfScope ? 'opacity-60' : ''
      } ${isDragging ? 'opacity-85 ring-2 ring-stamp shadow-level-4 bg-panel' : ''}`}
    >
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder journey: ${flow.name}`}
          title="Drag to reorder"
          className="mt-0.5 inline-flex h-8 w-6 cursor-grab items-center justify-center rounded-control text-ink-soft opacity-60 transition-opacity hover:opacity-100 hover:text-ink active:cursor-grabbing focus:opacity-100"
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
              className="text-base font-bold text-ink"
            />
            {roleName(flow.role) !== 'visitor' && (
              <span className="font-normal text-ink-soft">as {roleName(flow.role)}</span>
            )}
            <SourceBadge source={flow.source} />
            {flow.isNew && <Badge tone="stamp">New</Badge>}
            {flow.needsTestCopy && <Badge tone="warn">Needs a test copy</Badge>}
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
          <div className="mt-2">
            <ReplanControl
              label={`Re-plan the journey “${flow.name}” with the AI`}
              disabled={actions.busy}
              onReplan={(text) => actions.replan(id, text)}
            />
          </div>
        </div>
      </div>
    </li>
  );
}

function JourneysSection({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const view = useContext(ViewContext);
  const flows = plan.flows.filter(
    (f) => matches(view, `${f.name} ${f.description} ${f.startPage}`) && (!view.needsMe || flowNeedsMe(f))
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
                <strong className="text-ink">{item.what}</strong> <span className="text-ink-soft">— {item.reason}</span>
              </span>
              {item.itemId && (
                <button type="button" className="btn-link shrink-0 text-sm" onClick={() => showItem(item.itemId!)}>
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

function DocsSection({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const [productContext, setProductContext] = useState(plan.productContext || '');
  const [designNotes, setDesignNotes] = useState(plan.designNotes || '');
  // A re-plan or another change brings new text: the boxes follow it.
  useEffect(() => setProductContext(plan.productContext || ''), [plan.productContext]);
  useEffect(() => setDesignNotes(plan.designNotes || ''), [plan.designNotes]);
  return (
    <Section
      id="plan-docs"
      title="Specs and design notes"
      intro="The AI plans with these. Change them, then re-plan so the plan uses them."
    >
      <label className="label" htmlFor="plan-product-context">
        Specs, requirements or user stories
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
        className="btn-primary min-h-[44px] px-4 text-sm"
        disabled={actions.busy}
        onClick={() => actions.saveDocsAndReplan(productContext, designNotes)}
      >
        Save and re-plan everything with the AI
      </button>
    </Section>
  );
}

/** The plan at a glance: how many of each, and how many need the reader, each a link to its section. */
function Overview({ plan, view, setView }: { plan: ReviewPlan; view: View; setView: (v: View) => void }) {
  const pages = plan.planPages || [];
  const navigation = plan.navigation || [];
  const unanswered = plan.questions.filter((q) => !q.selectedAnswer).length;
  const needsMe =
    unanswered +
    pages.filter((p) => p.coverage !== 'covered' && pageNeedsMe(p)).length +
    navigation.filter(navNeedsMe).length +
    plan.flows.filter(flowNeedsMe).length;
  const cards: Array<[string, string, string]> = [
    ['plan-pages', 'Pages', `${pages.length} (${pages.filter((p) => p.coverage !== 'covered').length} tested)`],
    ['plan-navigation', 'Links', String(navigation.length)],
    ['plan-journeys', 'Journeys', String(plan.flows.length)],
    ...(plan.questions.length > 0
      ? ([['plan-questions', 'Questions', `${unanswered} unanswered`]] as Array<[string, string, string]>)
      : []),
    ['plan-wontrun', 'Won’t run', String(plan.wontRun?.length ?? 0)],
  ];
  return (
    <div className="space-y-3">
      <nav aria-label="Plan contents" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {cards.map(([id, name, value]) => (
          <a
            key={id}
            href={`#${id}`}
            className="interactive flex min-h-[56px] flex-col justify-center rounded-card border border-rule bg-surface/80 px-3 py-2 shadow-level-1 hover:border-stamp hover:shadow-level-2"
          >
            <span className="text-sm text-ink-soft">{name}</span>
            <span className="font-bold text-ink">{value}</span>
          </a>
        ))}
      </nav>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor="plan-filter">
          Find in the plan
        </label>
        <input
          id="plan-filter"
          type="search"
          className="field flex-1 py-2 text-base"
          placeholder="Find a page, link or journey"
          value={view.query}
          onChange={(e) => setView({ ...view, query: e.target.value })}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-base text-ink">
            <input
              type="checkbox"
              className="h-5 w-5 accent-[#6C9BF2]"
              checked={view.needsMe}
              onChange={(e) => setView({ ...view, needsMe: e.target.checked })}
            />
            Only what needs me ({needsMe})
          </label>
          <button
            type="button"
            className="btn-quiet rounded-control min-h-[44px] px-3 text-sm font-bold text-ink hover:text-stamp"
            onClick={() => setView({ ...view, expandAll: view.expandAll ? false : true })}
            title={view.expandAll ? 'Collapse all plan sections' : 'Expand all plan sections'}
          >
            {view.expandAll ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      </div>
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
      const tagName = activeEl?.tagName.toLowerCase();
      if (
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        (activeEl as HTMLElement)?.isContentEditable ||
        document.querySelector('[role="dialog"]') !== null
      ) {
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

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
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }

        const targetId = targetMap[e.key.toLowerCase()];
        if (targetId) {
          e.preventDefault();
          const targetEl = document.getElementById(targetId) || document.getElementById(`${targetId}-title`);
          targetEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
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
        nextItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }

      if (e.key === 'k') {
        e.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        const prevItem = items[prevIndex];
        const prevId = prevItem.dataset.planItem || null;
        setActiveItemId(prevId);
        prevItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
      target.classList.add('ring-2', 'ring-stamp', 'bg-stamp-tint/10');
      return () => {
        target.classList.remove('ring-2', 'ring-stamp', 'bg-stamp-tint/10');
      };
    }
  }, [activeItemId]);

  return { activeItemId };
}

/** The complete plan as one readable document: everything that will run, and everything that won't. */
export function PlanDocument({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const [view, setView] = useState<View>({ query: '', needsMe: false });
  usePlanKeyboardNavigation();

  useEffect(() => {
    const handleHash = () => {
      const raw = window.location.hash.slice(1);
      if (!raw) return;
      const decoded = decodeURIComponent(raw);
      const target =
        document.getElementById(decoded) ||
        document.getElementById(itemDomId(decoded)) ||
        document.querySelector<HTMLElement>(`[data-plan-item="${decoded}"]`);
      if (target) {
        let parent = target.parentElement;
        while (parent) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
          parent = parent.parentElement;
        }
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('ring-2', 'ring-stamp', 'shadow-level-3', 'transition-all', 'duration-300');
        window.setTimeout(() => {
          target.classList.remove('ring-2', 'ring-stamp', 'shadow-level-3');
        }, 3000);
      }
    };

    const timer = window.setTimeout(handleHash, 150);
    window.addEventListener('hashchange', handleHash);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('hashchange', handleHash);
    };
  }, []);

  return (
    <ViewContext.Provider value={view}>
      <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-6">
        <Overview plan={plan} view={view} setView={setView} />
        <SummarySection plan={plan} actions={actions} />
        <QuestionsSection plan={plan} actions={actions} />
        <PagesSection plan={plan} actions={actions} />
        <NavigationSection plan={plan} actions={actions} />
        <JourneysSection plan={plan} actions={actions} />
        <ChecksSection plan={plan} />
        <WontRunSection plan={plan} />
        <DocsSection plan={plan} actions={actions} />
      </div>
    </ViewContext.Provider>
  );
}
