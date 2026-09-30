import React, { useState } from 'react';
import type { Breakpoint, DiscoveredFlow, NavigationCheck, PlanPage, ReviewPlan, TestCaseExpectations } from '@qa/types';
import { stepToSentence, expectationsToChecks } from '../../lib/plan-translate';
import type { InterpretResult } from '../../api';
import { Badge, ItemToggle, ReplanControl, SourceBadge, itemDomId, showItem } from './parts';

/** What the person can do to the plan from the document. Each change goes to the QA Tool. */
export interface PlanActions {
  /** A change is being made: controls wait. */
  busy: boolean;
  setSkipped: (itemId: string, skipped: boolean) => void;
  replan: (itemId: string, instructions?: string) => void;
  promote: (pageItemId: string) => void;
  addPage: (address: string) => Promise<void>;
  includeHost: (host: string) => void;
  answer: (questionId: string, answer: string) => void;
  setScreenSizes: (sizes: Breakpoint[]) => void;
  replanEverything: () => void;
  saveDocsAndReplan: (productContext: string, designNotes: string) => Promise<void>;
  describeTest: (sentence: string, urlPath: string) => Promise<InterpretResult>;
  addJourney: (flow: DiscoveredFlow) => Promise<void>;
}

const SIZES: Breakpoint[] = ['375px', '768px', '1440px'];
const SIZE_NAMES: Record<Breakpoint, string> = { '375px': 'Phone (375px)', '768px': 'Tablet (768px)', '1440px': 'Desktop (1440px)' };

function Section({ id, title, count, intro, children }: { id: string; title: string; count?: number; intro?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4 rounded-lg border border-rule bg-surface/60 p-5">
      <h2 id={`${id}-title`} className="mb-1 text-lg font-bold text-ink">
        {title}
        {count !== undefined && (
          <>
            {' '}
            <span className="ml-1 font-mono text-sm font-normal text-ink-soft">({count})</span>
          </>
        )}
      </h2>
      {intro && <p className="mb-4 max-w-prose text-sm text-ink-soft">{intro}</p>}
      {children}
    </section>
  );
}

/** What should happen, in plain words, marked when it's only the AI's guess. */
function Expected({ expectations }: { expectations?: TestCaseExpectations }) {
  if (!expectations || !Object.keys(expectations).some((k) => k !== 'origin')) return null;
  const guess = expectations.origin === 'ai-guess';
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-pass">
      {expectationsToChecks(expectations).map((c, i) => (
        <li key={i}>
          ✓ {c.sentence}
          {guess && <span className="text-ink-soft"> (the AI’s guess until you confirm it)</span>}
        </li>
      ))}
    </ul>
  );
}

function SummarySection({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const sizes = plan.screenSizes?.length ? plan.screenSizes : SIZES;
  const budget = plan.budget;
  return (
    <Section id="plan-summary" title="What approving runs">
      <ul className="space-y-1.5">
        {(plan.summary?.lines || []).map((line, i) => (
          <li key={i} className="flex items-start justify-between gap-3 text-sm text-ink">
            <span>{line.text}</span>
            {line.itemIds.length > 0 && (
              <button type="button" className="btn-link shrink-0 text-xs" onClick={() => showItem(line.itemIds[0])}>
                Show
              </button>
            )}
          </li>
        ))}
      </ul>

      <fieldset className="mt-5">
        <legend className="label mb-2">Screen sizes</legend>
        <div className="flex flex-wrap gap-5">
          {SIZES.map((size) => {
            const on = sizes.includes(size);
            return (
              <label key={size} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-stamp"
                  checked={on}
                  disabled={actions.busy || (on && sizes.length === 1)}
                  onChange={(e) => actions.setScreenSizes(e.target.checked ? SIZES.filter((s) => s === size || sizes.includes(s)) : sizes.filter((s) => s !== size))}
                />
                {SIZE_NAMES[size]}
              </label>
            );
          })}
        </div>
      </fieldset>

      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-soft">Tested as</dt>
          <dd className="text-ink">{(plan.roles?.length ? plan.roles : ['visitor']).join(', ')}</dd>
        </div>
        {budget && (
          <div>
            <dt className="text-ink-soft">AI requests</dt>
            <dd className="text-ink">
              {budget.used} used, about {budget.needed} needed
              {budget.left !== undefined && ` · ${budget.left} free left today`}
              {budget.visualReview ? ` · the visual review can use up to ${budget.visualReview} more` : ''}
            </dd>
          </div>
        )}
      </dl>

      {plan.readOnlyReason && <p className="mt-4 rounded border border-warn/40 bg-warn-tint/40 p-3 text-sm text-ink">{plan.readOnlyReason}</p>}
      {(plan.notes || []).length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-ink-soft">
          {plan.notes!.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      )}
      <button type="button" className="btn-quiet mt-4 px-3 py-1.5 text-xs" disabled={actions.busy} onClick={actions.replanEverything}>
        Re-plan everything with the AI
      </button>
    </Section>
  );
}

function QuestionsSection({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  if (plan.questions.length === 0) return null;
  return (
    <Section id="plan-questions" title="Questions before testing" count={plan.questions.length} intro="Anything you leave unanswered uses the safe answer, which sends and deletes nothing.">
      <ul className="space-y-3">
        {plan.questions.map((q) => (
          <li key={q.id} id={itemDomId(q.id)} className="rounded border border-rule p-3">
            <p className="mb-2 text-sm font-bold text-ink">
              {q.question} {q.isNew && <Badge tone="stamp">New</Badge>}
            </p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={q.question}>
              {q.options.map((option) => {
                const picked = q.selectedAnswer === option;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={picked}
                    disabled={actions.busy}
                    onClick={() => actions.answer(q.id, option)}
                    className={`rounded px-2.5 py-1 text-xs ${picked ? 'bg-stamp font-bold text-surface' : 'border border-rule text-ink-soft hover:border-edge hover:text-ink'}`}
                  >
                    {option}
                    {!q.selectedAnswer && option === q.safeAnswer ? ' (used if you don’t answer)' : ''}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function PageRow({ page, actions }: { page: PlanPage; actions: PlanActions }) {
  const covered = page.coverage === 'covered';
  return (
    <li id={itemDomId(page.id)} className={`rounded border border-rule p-3 transition-shadow ${page.skipped ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        {!covered && <ItemToggle label={`Test the page ${page.urlPath}`} on={!page.skipped} disabled={actions.busy} onChange={(on) => actions.setSkipped(page.id, !on)} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all font-mono text-sm font-bold text-ink">{page.urlPath}</span>
            <span className="text-sm text-ink-soft">{page.title}</span>
            {page.coverage === 'sample' && <Badge tone="stamp">Sample page</Badge>}
            {page.coverage === 'promoted' && !page.added && <Badge tone="stamp">Tested on its own</Badge>}
            {page.added && <Badge tone="stamp">Added by you</Badge>}
            {page.isNew && <Badge tone="stamp">New</Badge>}
            {page.unlinked && !page.added && <Badge tone="warn">No link leads here</Badge>}
            {!covered && <SourceBadge source={page.source} />}
          </div>
          {covered ? (
            <p className="mt-1 text-xs text-ink-soft">Same layout as {page.coveredBy?.join(', ')}, which are tested for it. Not visited.</p>
          ) : (
            <p className="mt-1 text-xs text-ink-soft">
              {page.clickPath ? (page.clickPath.length > 0 ? `Reached by: Start → ${page.clickPath.join(' → ')}` : 'The start page') : 'No link leads here'} · visited as{' '}
              {page.reachedBy.join(', ')}
            </p>
          )}
          {!covered && page.tests.length > 0 && (
            <ul className="mt-2 space-y-2">
              {page.tests.map((test) => (
                <li key={test.id} id={itemDomId(test.id)} className={`rounded bg-canvas/60 p-2 transition-shadow ${test.skipped ? 'opacity-60' : ''}`}>
                  <div className="flex items-start gap-2">
                    <ItemToggle
                      label={`Run the test “${test.name}”`}
                      on={!test.skipped}
                      disabled={actions.busy || !!page.skipped}
                      onChange={(on) => actions.setSkipped(test.id, !on)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                        {test.name}
                        <SourceBadge source={test.source} />
                        {test.needsTestCopy && (
                          <Badge tone="warn" title="It sends a form or changes data, so it only runs on a test copy">
                            Needs a test copy
                          </Badge>
                        )}
                      </div>
                      <ol className="mt-1 list-decimal pl-5 text-xs text-ink-soft">
                        {test.steps.map((step, i) => (
                          <li key={i}>{stepToSentence(step)}</li>
                        ))}
                      </ol>
                      <Expected expectations={test.expectations} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!covered && page.tests.length === 0 && <p className="mt-2 text-xs text-ink-soft">Nothing to try beyond the visit. Every check still runs on it.</p>}
          <div className="mt-2">
            {covered ? (
              <button type="button" className="font-mono text-[11px] text-stamp hover:underline disabled:opacity-50" disabled={actions.busy} onClick={() => actions.promote(page.id)}>
                Test this page too
              </button>
            ) : (
              <ReplanControl label={`Re-plan ${page.urlPath} with the AI`} disabled={actions.busy} onReplan={(text) => actions.replan(page.id, text)} />
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function PagesSection({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const pages = plan.planPages || [];
  const groups = plan.layoutGroups || [];
  const grouped = new Set(groups.flatMap((g) => g.pages));
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Section
      id="plan-pages"
      title="Pages"
      count={pages.length}
      intro="Every page found. Each tested page is visited at every screen size, as everyone who reached it, and every check runs on it; the tests under it run too. Pages built from one layout are tested through a few Sample Pages."
    >
      <ul className="space-y-2">
        {pages
          .filter((p) => !grouped.has(p.urlPath))
          .map((page) => (
            <PageRow key={page.id} page={page} actions={actions} />
          ))}
      </ul>
      {groups.map((group) => {
        const members = pages.filter((p) => group.pages.includes(p.urlPath));
        const tested = members.filter((p) => p.coverage !== 'covered').length;
        return (
          <details key={group.id} className="mt-3 rounded border border-rule" open={members.length <= 6}>
            <summary className="cursor-pointer px-3 py-2 text-sm font-bold text-ink">
              {group.name} · {members.length} pages, {tested} tested
            </summary>
            <ul className="space-y-2 p-3">
              {members.map((page) => (
                <PageRow key={page.id} page={page} actions={actions} />
              ))}
            </ul>
          </details>
        );
      })}
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
          className="field flex-1 py-1.5 text-sm"
          placeholder="Add a page no link reaches, e.g. /admin"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <button type="submit" className="btn-quiet px-3 py-1.5 text-xs" disabled={actions.busy || !address.trim()}>
          Add page
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-xs text-fail">
          {error}
        </p>
      )}
    </Section>
  );
}

function NavRow({ nav, actions }: { nav: NavigationCheck; actions: PlanActions }) {
  const menuSizes = (nav.menuSteps || []).flatMap((s) => s.onlyAt || []);
  return (
    <li id={itemDomId(nav.id)} className={`rounded border border-rule p-2.5 transition-shadow ${nav.skipped ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2">
        <ItemToggle label={`Check the link: ${nav.name}`} on={!nav.skipped} disabled={actions.busy} onChange={(on) => actions.setSkipped(nav.id, !on)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
            {nav.name}
            <SourceBadge source={nav.source} />
            {nav.isNew && <Badge tone="stamp">New</Badge>}
          </div>
          <p className="break-words text-xs text-ink-soft">
            {nav.leavesSite ? `Checked with one request: ${nav.to}` : `Clicks “${nav.linkName}” on ${nav.startPage}; ${nav.to} should open and work`}
            {nav.expectation ? `. Should show: ${nav.expectation}` : ''}
          </p>
          {Object.entries(nav.landsOnBy || {})
            .filter(([, landing]) => landing !== nav.to)
            .map(([who, landing]) => (
              <p key={who} className="text-xs text-ink-soft">
                {who === 'visitor' ? 'Signed-out visitors' : `As ${who}, it`} land{who === 'visitor' ? '' : 's'} on {landing} instead, as the site sends them there.
              </p>
            ))}
          {menuSizes.length > 0 && <p className="text-xs text-ink-soft">Opens the menu first at {menuSizes.join(' and ')}.</p>}
          {nav.notAt?.length ? <p className="text-xs text-warn">Not checked at {nav.notAt.join(' and ')}: the link is hidden there and no menu button shows it.</p> : null}
          {nav.roles.some((r) => r !== 'visitor') && <p className="text-xs text-ink-soft">As {nav.roles.join(', ')}</p>}
          <ReplanControl label={`Re-plan the check “${nav.name}” with the AI`} disabled={actions.busy} onReplan={(text) => actions.replan(nav.id, text)} />
        </div>
      </div>
    </li>
  );
}

function NavigationSection({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const navigation = plan.navigation || [];
  const shared = navigation.filter((n) => n.shared);
  const inPage = navigation.filter((n) => !n.shared && !n.leavesSite);
  const leaving = navigation.filter((n) => n.leavesSite);
  const starts = [...new Set(inPage.map((n) => n.startPage))];
  const hosts = plan.otherHosts || [];
  return (
    <Section
      id="plan-navigation"
      title="Navigation"
      count={navigation.length}
      intro="Every link is checked once: the shared menus for the whole site, and each page’s own links on that page. A check clicks the link as a person would, and passes when the right page opens and works."
    >
      {shared.length > 0 && (
        <>
          <h3 className="mb-2 text-sm font-bold text-ink">Shared menus</h3>
          <ul className="mb-4 space-y-2">
            {shared.map((nav) => (
              <NavRow key={nav.id} nav={nav} actions={actions} />
            ))}
          </ul>
        </>
      )}
      {starts.length > 0 && (
        <>
          <h3 className="mb-2 text-sm font-bold text-ink">Links on pages</h3>
          {starts.map((start) => {
            const links = inPage.filter((n) => n.startPage === start);
            return (
              <details key={start} className="mb-2 rounded border border-rule" open={starts.length <= 3}>
                <summary className="cursor-pointer px-3 py-2 text-sm text-ink">
                  <span className="font-mono">{start}</span> · {links.length} {links.length === 1 ? 'link' : 'links'}
                </summary>
                <ul className="space-y-2 p-3">
                  {links.map((nav) => (
                    <NavRow key={nav.id} nav={nav} actions={actions} />
                  ))}
                </ul>
              </details>
            );
          })}
        </>
      )}
      {(leaving.length > 0 || hosts.length > 0) && (
        <>
          <h3 className="mb-2 mt-4 text-sm font-bold text-ink">Links that leave the site</h3>
          <ul className="mb-3 space-y-1.5">
            {hosts.map((host) => (
              <li key={host.host} className="flex flex-wrap items-center justify-between gap-2 rounded bg-canvas/60 px-3 py-2 text-sm text-ink">
                <span>
                  <span className="font-mono">{host.host}</span> · {host.links} {host.links === 1 ? 'link' : 'links'}
                </span>
                {host.included ? (
                  <Badge tone="pass">Explored</Badge>
                ) : (
                  <button type="button" className="btn-link text-xs" disabled={actions.busy} onClick={() => actions.includeHost(host.host)}>
                    Explore this site too
                  </button>
                )}
              </li>
            ))}
          </ul>
          <ul className="space-y-2">
            {leaving.map((nav) => (
              <NavRow key={nav.id} nav={nav} actions={actions} />
            ))}
          </ul>
        </>
      )}
      {navigation.length === 0 && <p className="text-sm text-ink-soft">No links were found to check.</p>}
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
      <h3 className="mb-1 text-sm font-bold text-ink">Add a test by describing it</h3>
      <p className="mb-3 text-xs text-ink-soft">For example: “Save with an empty amount — it should show an error”.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="describe-page">
          On the page
        </label>
        <select id="describe-page" className="field py-1.5 text-sm sm:w-48" value={urlPath} onChange={(e) => setUrlPath(e.target.value)}>
          {pages.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="describe-sentence">
          Describe the test
        </label>
        <input id="describe-sentence" className="field flex-1 py-1.5 text-sm" value={sentence} onChange={(e) => setSentence(e.target.value)} placeholder="What to do, and what should happen" />
        <button
          type="button"
          className="btn-quiet px-3 py-1.5 text-xs"
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
        <p role="alert" className="mt-2 text-xs text-fail">
          {error}
        </p>
      )}
      {result?.flow && (
        <div className="mt-3 rounded border border-pass/40 bg-pass-tint/30 p-3 text-xs">
          <p className="font-bold text-pass">{result.flow.name}</p>
          <ol className="mt-1 list-decimal pl-5 text-ink-soft">
            {result.flow.steps.map((s, i) => (
              <li key={i}>{stepToSentence(s)}</li>
            ))}
          </ol>
          <button
            type="button"
            className="btn-primary mt-2 px-3 py-1.5 text-xs"
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

function JourneysSection({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  return (
    <Section id="plan-journeys" title="Journeys" count={plan.flows.length} intro="Things a person does across pages to get something done, step by step.">
      <ul className="space-y-3">
        {plan.flows.map((flow) => {
          const id = `journey:${flow.id}`;
          return (
            <li key={flow.id} id={itemDomId(id)} className={`rounded border border-rule p-3 transition-shadow ${flow.outOfScope ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-3">
                <ItemToggle label={`Run the journey “${flow.name}”`} on={!flow.outOfScope} disabled={actions.busy} onChange={(on) => actions.setSkipped(id, !on)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink">
                    {flow.name}
                    {flow.role && flow.role !== 'visitor' && <span className="font-normal text-ink-soft">as {flow.role}</span>}
                    <SourceBadge source={flow.source} />
                    {flow.isNew && <Badge tone="stamp">New</Badge>}
                    {flow.needsTestCopy && <Badge tone="warn">Needs a test copy</Badge>}
                  </div>
                  {flow.description && <p className="mt-0.5 text-xs text-ink-soft">{flow.description}</p>}
                  <ol className="mt-2 list-decimal pl-5 text-xs text-ink">
                    {flow.steps.map((step, i) => (
                      <li key={i}>{stepToSentence(step)}</li>
                    ))}
                  </ol>
                  <Expected expectations={flow.candidateExpectations} />
                  {flow.needsHelp?.map((help, i) => (
                    <p key={i} className="mt-1 text-xs text-warn">
                      {help}
                    </p>
                  ))}
                  <div className="mt-2">
                    <ReplanControl label={`Re-plan the journey “${flow.name}” with the AI`} disabled={actions.busy} onReplan={(text) => actions.replan(id, text)} />
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {plan.flows.length === 0 && <p className="text-sm text-ink-soft">No journeys across pages were planned.</p>}
      <DescribeTest plan={plan} actions={actions} />
    </Section>
  );
}

function ChecksSection({ plan }: { plan: ReviewPlan }) {
  const sizes = (plan.screenSizes?.length ? plan.screenSizes : SIZES).join(', ');
  return (
    <Section id="plan-checks" title="Checks on every tested page" intro={`At ${sizes}, as ${(plan.roles?.length ? plan.roles : ['visitor']).join(', ')}. Each is graded in the report.`}>
      <ul className="space-y-1.5 text-sm">
        {(plan.gradedChecks || []).map((check) => (
          <li key={check.id} id={itemDomId(check.id)}>
            <strong className="text-ink">{check.name}:</strong> <span className="text-ink-soft">{check.description}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function WontRunSection({ plan }: { plan: ReviewPlan }) {
  const items = plan.wontRun || [];
  return (
    <Section id="plan-wontrun" title="Won’t run" count={items.length}>
      {items.length === 0 ? (
        <p className="text-sm text-ink-soft">Everything in the plan runs.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {items.map((item, i) => (
            <li key={i} className="flex items-start justify-between gap-3">
              <span>
                <strong className="text-ink">{item.what}</strong> <span className="text-ink-soft">— {item.reason}</span>
              </span>
              {item.itemId && (
                <button type="button" className="btn-link shrink-0 text-xs" onClick={() => showItem(item.itemId!)}>
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
  return (
    <Section id="plan-docs" title="Specs and design notes" intro="The AI plans with these. Change them, then re-plan so the plan uses them.">
      <label className="label" htmlFor="plan-product-context">
        Specs
      </label>
      <textarea id="plan-product-context" rows={5} className="field mb-3 w-full font-mono text-xs" value={productContext} onChange={(e) => setProductContext(e.target.value)} />
      <label className="label" htmlFor="plan-design-notes">
        Design notes
      </label>
      <textarea id="plan-design-notes" rows={4} className="field mb-3 w-full font-mono text-xs" value={designNotes} onChange={(e) => setDesignNotes(e.target.value)} />
      <button type="button" className="btn-primary px-4 py-2 text-xs" disabled={actions.busy} onClick={() => actions.saveDocsAndReplan(productContext, designNotes)}>
        Save and re-plan everything with the AI
      </button>
    </Section>
  );
}

/** The complete plan as one readable document: everything that will run, and everything that won't. */
export function PlanDocument({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const contents: Array<[string, string]> = [
    ['plan-summary', 'Summary'],
    ...(plan.questions.length > 0 ? ([['plan-questions', 'Questions']] as Array<[string, string]>) : []),
    ['plan-pages', 'Pages'],
    ['plan-navigation', 'Navigation'],
    ['plan-journeys', 'Journeys'],
    ['plan-checks', 'Checks'],
    ['plan-wontrun', 'Won’t run'],
    ['plan-docs', 'Specs and design notes'],
  ];
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-6">
      <nav aria-label="Plan contents" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {contents.map(([id, name]) => (
          <a key={id} href={`#${id}`} className="text-stamp hover:underline">
            {name}
          </a>
        ))}
      </nav>
      <SummarySection plan={plan} actions={actions} />
      <QuestionsSection plan={plan} actions={actions} />
      <PagesSection plan={plan} actions={actions} />
      <NavigationSection plan={plan} actions={actions} />
      <JourneysSection plan={plan} actions={actions} />
      <ChecksSection plan={plan} />
      <WontRunSection plan={plan} />
      <DocsSection plan={plan} actions={actions} />
    </div>
  );
}
