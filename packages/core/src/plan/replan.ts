import type { DiscoveryDraft, NavigationCheck, PageInventoryItem, PlanPage, RoleCredential } from '@qa/types';
import type { AIProvider } from '../ai/ai-provider.js';
import type { SiteType } from '../discovery/site-type.js';
import { markJourneysNeedingTestCopy } from '../live-site.js';
import { replaceCredentialsWithPlaceholders } from '../credentials.js';
import { buildSiteGraph, pathOf, type SiteGraph } from './site-graph.js';
import { sampleLayoutGroups, type PageCoverageInfo } from './sampling.js';
import { planPagesAndMenus, testedPages, type PagePlannerInput } from './ai-planner.js';
import { planJourneys } from './journeys.js';

/** What re-planning needs besides the draft. */
export interface ReplanOptions {
  readOnly: boolean;
  productContext?: string;
  /** What the person asked for, in their words. */
  instructions?: string;
  roles: RoleCredential[];
  forbiddenActions?: string[];
  redact: (text: string) => string;
  onProgress?: (what: string) => void;
}

/** Pages described to the AI when it plans journeys. */
const JOURNEY_PROMPT_PAGES = 40;

function startPathOf(draft: DiscoveryDraft): string {
  const typed = new URL(draft.targetUrl).pathname;
  return draft.pages.some((p) => pathOf(p.urlPath) === typed) ? typed : draft.pages[0]?.urlPath || '/';
}

/** How each page is covered now, keeping pages the person promoted or added. */
function currentCoverage(draft: DiscoveryDraft): Map<string, PageCoverageInfo> {
  const coverage = sampleLayoutGroups(draft.pages).coverage;
  for (const page of draft.plan?.pages || []) {
    if (page.coverage === 'promoted' || page.added)
      coverage.set(page.urlPath, { coverage: 'promoted', layoutGroup: page.layoutGroup });
  }
  return coverage;
}

function plannerInput(
  draft: DiscoveryDraft,
  pages: PageInventoryItem[],
  coverage: Map<string, PageCoverageInfo>,
  graph: SiteGraph,
  options: ReplanOptions,
  notesFor?: string
): PagePlannerInput {
  const asked = options.instructions?.trim();
  return {
    pages,
    forms: draft.forms || [],
    coverage,
    graph,
    targetUrl: draft.targetUrl,
    siteType: draft.siteType || 'other',
    productContext:
      [options.productContext?.trim(), asked ? `The owner asks${notesFor ? ` about ${notesFor}` : ''}: ${asked}` : '']
        .filter(Boolean)
        .join('\n\n') || undefined,
    readOnly: options.readOnly,
    forbiddenActions: options.forbiddenActions,
    redact: options.redact,
  };
}

/** Keeps what the person switched off, by item id, across a re-plan. */
function keepSwitchedOff<T extends { id: string; skipped?: boolean }>(fresh: T[], before: T[]): T[] {
  const off = new Set(before.filter((i) => i.skipped).map((i) => i.id));
  return fresh.map((i) => (off.has(i.id) ? { ...i, skipped: true } : i));
}

/**
 * Plans one page again with the AI: its tests and its own links. Used when the person asks for
 * changes to a page, promotes a page covered by its Layout Group's samples, or adds a page.
 */
export async function replanPage(
  draft: DiscoveryDraft,
  urlPath: string,
  ai: AIProvider | undefined,
  options: ReplanOptions & { promote?: boolean }
): Promise<string[]> {
  const plan = draft.plan!;
  const page = draft.pages.find((p) => p.urlPath === urlPath);
  const planned = plan.pages.find((p) => p.urlPath === urlPath);
  if (!page || !planned) throw new Error(`The page ${urlPath} isn’t in the plan.`);
  const graph = buildSiteGraph(draft.pages, startPathOf(draft));
  const coverage = planned.coverage === 'covered' || options.promote ? 'promoted' : planned.coverage;
  options.onProgress?.(`Planning ${urlPath}`);
  const out = await planPagesAndMenus(
    plannerInput(
      draft,
      [page],
      new Map([[urlPath, { coverage, layoutGroup: planned.layoutGroup }]]),
      { ...graph, shared: [] },
      options,
      urlPath
    ),
    ai
  );
  const fresh = out.pages[0];
  Object.assign(planned, { coverage, coveredBy: undefined, tests: fresh.tests, source: fresh.source, skipped: false });
  const others = plan.navigation.filter((n) => n.shared || n.startPage !== urlPath);
  plan.navigation = [...others, ...keepSwitchedOff(out.navigation, plan.navigation)];
  return out.notes;
}

/** Plans the shared menus' Navigation Checks again. */
export async function replanMenus(
  draft: DiscoveryDraft,
  ai: AIProvider | undefined,
  options: ReplanOptions
): Promise<string[]> {
  const plan = draft.plan!;
  const graph = buildSiteGraph(draft.pages, startPathOf(draft));
  // Every page "covered": only the menus are planned.
  const coverage = new Map<string, PageCoverageInfo>(draft.pages.map((p) => [p.urlPath, { coverage: 'covered' }]));
  options.onProgress?.('Planning the shared menus');
  const out = await planPagesAndMenus(
    plannerInput(draft, draft.pages, coverage, graph, options, 'the shared menus'),
    ai
  );
  const shared = out.navigation.filter((n) => n.shared);
  plan.navigation = [...keepSwitchedOff(shared, plan.navigation), ...plan.navigation.filter((n) => !n.shared)];
  return out.notes;
}

/** Plans the journeys again; the questions about journeys that can't run are asked afresh. */
export async function replanJourneys(
  draft: DiscoveryDraft,
  ai: AIProvider | undefined,
  options: ReplanOptions & { productId: string }
): Promise<string[]> {
  const coverage = currentCoverage(draft);
  const graph = buildSiteGraph(draft.pages, startPathOf(draft));
  const byClicks = (p: PageInventoryItem) => graph.clickPaths.get(p.urlPath)?.length ?? Number.MAX_SAFE_INTEGER;
  const tested = testedPages({ pages: draft.pages, coverage });
  options.onProgress?.('Planning the journeys');
  const out = await planJourneys(
    {
      targetUrl: draft.targetUrl,
      productId: options.productId,
      productContext: options.productContext,
      instructions: options.instructions,
      promptPages: [...tested].sort((a, b) => byClicks(a) - byClicks(b)).slice(0, JOURNEY_PROMPT_PAGES),
      spider: { pages: draft.pages, forms: (draft.forms || []) as never },
      roles: options.roles,
      siteType: (draft.siteType || 'other') as SiteType,
      redact: options.redact,
    },
    ai
  );
  const off = new Set(draft.flows.filter((f) => f.outOfScope).map((f) => f.id));
  draft.flows = out.flows.map((f) => (off.has(f.id) ? { ...f, outOfScope: true } : f));
  for (const flow of draft.flows) replaceCredentialsWithPlaceholders(flow.steps, options.roles);
  markJourneysNeedingTestCopy(draft);
  draft.ambiguityQuestions = [...draft.ambiguityQuestions.filter((q) => !q.id.startsWith('Q-STEP-')), ...out.questions];
  draft.usedFallbackSynthesis = out.usedFallback;
  return out.notes;
}

/** Plans everything again: every tested page, the shared menus and the journeys, e.g. after new specs. */
export async function replanAll(
  draft: DiscoveryDraft,
  ai: AIProvider | undefined,
  options: ReplanOptions & { productId: string }
): Promise<string[]> {
  const plan = draft.plan!;
  const graph = buildSiteGraph(draft.pages, startPathOf(draft));
  const coverage = currentCoverage(draft);
  options.onProgress?.('Planning every page and menu');
  const out = await planPagesAndMenus(plannerInput(draft, draft.pages, coverage, graph, options), ai, (p) =>
    options.onProgress?.(`${p.what} (${p.done} of ${p.total})`)
  );
  const added = new Set(plan.pages.filter((p) => p.added).map((p) => p.urlPath));
  plan.pages = keepSwitchedOff(
    out.pages.map((p) => (added.has(p.urlPath) ? { ...p, added: true } : p)),
    plan.pages
  );
  plan.navigation = keepSwitchedOff(out.navigation, plan.navigation);
  const notes = [...out.notes, ...(await replanJourneys(draft, ai, options))];
  return notes;
}

/**
 * Adds pages the crawler found later (a page added by its address, or another host's pages) to
 * the draft, then plans them with the AI. Pages already in the draft are left as they are.
 */
export async function addPagesToPlan(
  draft: DiscoveryDraft,
  found: { pages: PageInventoryItem[]; forms: NonNullable<DiscoveryDraft['forms']> },
  ai: AIProvider | undefined,
  options: ReplanOptions & { added?: boolean }
): Promise<{ notes: string[]; pages: string[] }> {
  const plan = draft.plan!;
  const known = new Set(draft.pages.map((p) => p.urlPath));
  const fresh = found.pages.filter((p) => !known.has(p.urlPath));
  if (fresh.length === 0) return { notes: [], pages: [] };
  draft.pages.push(...fresh);
  draft.forms = [...(draft.forms || []), ...found.forms.filter((f) => fresh.some((p) => p.urlPath === f.urlPath))];

  // Planned among themselves: their own Layout Groups, their own shared menu.
  const { coverage } = sampleLayoutGroups(fresh);
  if (options.added) for (const page of fresh) coverage.set(page.urlPath, { coverage: 'promoted' });
  const graph = buildSiteGraph(fresh, fresh[0].urlPath);
  options.onProgress?.(`Planning ${fresh.length === 1 ? fresh[0].urlPath : `${fresh.length} new pages`}`);
  const out = await planPagesAndMenus(plannerInput(draft, fresh, coverage, graph, options), ai, (p) =>
    options.onProgress?.(`${p.what} (${p.done} of ${p.total})`)
  );
  const newPages: PlanPage[] = out.pages.map((p) => ({ ...p, added: options.added || undefined, isNew: true }));
  plan.pages.push(...newPages);
  const ids = new Set(plan.navigation.map((n) => n.id));
  plan.navigation.push(...out.navigation.filter((n: NavigationCheck) => !ids.has(n.id)));
  return { notes: out.notes, pages: fresh.map((p) => p.urlPath) };
}

/** Pages crawled on another host, addressed in full so they can't be mistaken for the site's own. */
export function onOtherHost(
  found: { pages: PageInventoryItem[]; forms: NonNullable<DiscoveryDraft['forms']> },
  origin: string
): typeof found {
  const full = (path: string) => (/^https?:\/\//.test(path) ? path : `${origin}${path}`);
  return {
    pages: found.pages.map((p) => ({
      ...p,
      urlPath: full(p.urlPath),
      links: p.links?.map((l) =>
        l.leavesSite ? l : { ...l, to: full(l.to), landsOn: l.landsOn ? full(l.landsOn) : undefined }
      ),
    })),
    forms: found.forms.map((f) => ({ ...f, urlPath: full(f.urlPath) })),
  };
}
