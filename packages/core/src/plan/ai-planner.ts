import type {
  AIMessage,
  Breakpoint,
  DiscoveredFlow,
  FallbackReason,
  ElementInventoryItem,
  NavigationCheck,
  PageInventoryItem,
  PageLink,
  PlanItemSource,
  PlanPage,
  PlanPageTest,
  TestCaseExpectations,
  TestCaseStep,
} from '@qa/types';
import { AITruncatedError, completeWith, type AIProvider } from '../ai/ai-provider.js';
import { SafetyFilter } from '../discovery/safety-filter.js';
import { RISKY_TO_CLICK, SESSION_ENDING } from '../discovery/deterministic-spider.js';
import { needsTestCopy } from '../live-site.js';
import { BudgetSpentError, StoppedEarlyError } from './ai-budget.js';
import { linkKey, pathOf, type SharedLink, type SiteGraph } from './site-graph.js';
import type { PageCoverageInfo } from './sampling.js';

/** A form the crawler found, as the planner needs it. */
export interface PlannerForm {
  urlPath: string;
  method?: string;
  inputs: Array<{ label?: string; type?: string; selector: string; required?: boolean }>;
  submitButtonSelector?: string;
}

export interface PagePlannerInput {
  /** Every page the crawl found. */
  pages: PageInventoryItem[];
  forms: PlannerForm[];
  coverage: Map<string, PageCoverageInfo>;
  graph: SiteGraph;
  targetUrl: string;
  siteType: string;
  productContext?: string;
  /** The live site: nothing that sends a form or changes data runs. */
  readOnly: boolean;
  forbiddenActions?: string[];
  /** Hides anything secret before a prompt leaves for the AI. */
  redact: (text: string) => string;
  /**
   * The last approved Plan's items, from the site's memory: a page whose controls are unchanged
   * keeps its tests and a known link keeps its check, without asking the AI again.
   */
  remembered?: {
    pages: Record<string, { contentKey?: string; tests: PlanPageTest[]; source: PlanItemSource }>;
    navigation: Record<string, { name: string; expectation?: string; source: PlanItemSource }>;
  };
}

/**
 * A remembered page's tests, when the page's controls are the same as when they were planned.
 * What fixed rules planned last time isn't reused: the AI gets another go at it.
 */
function rememberedFor(page: PageInventoryItem, input: Pick<PagePlannerInput, 'remembered'>) {
  const before = input.remembered?.pages[page.urlPath];
  return before?.contentKey && before.contentKey === page.contentKey && before.source !== 'fallback' ? before : undefined;
}

/** A remembered Navigation Check the AI (or the person) wrote. */
function rememberedCheck(input: Pick<PagePlannerInput, 'remembered'>, id: string) {
  const before = input.remembered?.navigation[id];
  return before && before.source !== 'fallback' ? before : undefined;
}

/** Page titles by path: a link to a page the crawl saw needs nothing from the AI. */
function titlesOf(pages: PageInventoryItem[]): Map<string, string> {
  return new Map(pages.filter((p) => p.title?.trim()).map((p) => [pathOf(p.urlPath), p.title.trim()]));
}

/** The title of the page a link ends up on, when the crawl saw it. */
function destinationTitle(link: PageLink, titles: Map<string, string>): string | undefined {
  return link.leavesSite ? undefined : titles.get(pathOf(link.landsOn ?? link.to));
}

/**
 * A link the AI is asked about: one on the site whose destination the crawl didn't see. Every other
 * link's check is named from its text and where it goes, which needs no AI.
 */
function asksAbout(link: PageLink, titles: Map<string, string>): boolean {
  return !link.leavesSite && !destinationTitle(link, titles);
}

/** Shared-menu links to ask the AI about: unseen destinations the site's memory doesn't know yet. */
function unknownSharedLinks(input: Pick<PagePlannerInput, 'pages' | 'graph' | 'remembered'>, links: SharedLink[]): SharedLink[] {
  const titles = titlesOf(input.pages);
  return links.filter((s) => asksAbout(s.link, titles) && !rememberedCheck(input, `nav:shared|${linkKey(s.link)}`));
}

export interface PagePlannerOutput {
  pages: PlanPage[];
  navigation: NavigationCheck[];
  /** Plan Items planned by fixed rules because the AI Request Budget ran out. */
  overBudget: number;
  /** Plain sentences for the Plan about what the AI couldn't do. */
  notes: string[];
  /** Plan Items planned by fixed rules because the model stopped before it answered. */
  truncated: number;
}

export interface PlannerProgress {
  done: number;
  total: number;
  /** What was just planned, or what the AI is being asked about, in plain words. */
  what: string;
  /** A request is on its way: `what` names it. */
  asking?: boolean;
  /** 1 for the first request, 2 for the repair. */
  attempt?: number;
}

const PAGES_PER_REQUEST = 3;
/** Controls sent per request across its pages: keeps prompt and answer within a small free model's reach. */
const CONTROLS_PER_REQUEST = 120;
const CONTROLS_PER_PAGE = 60;
const LINKS_PER_PAGE = 40;
const SHARED_LINKS_PER_REQUEST = 60;
/** Room for the answer: small free models that think first need more than the usual 4,096 tokens. */
export const PLANNING_MAX_TOKENS = 8192;
/** Product notes repeat in every request, so long ones are cut to this many characters. */
const CONTEXT_CHARS_PER_REQUEST = 2000;
const MAX_TESTS_PER_PAGE = 6;
const MAX_STEPS_PER_TEST = 8;
const TESTED: Array<PageCoverageInfo['coverage']> = ['tested', 'sample', 'promoted'];

/** Pages planned and visited: tested on their own, Sample Pages, and promoted ones. */
export function testedPages(input: Pick<PagePlannerInput, 'pages' | 'coverage'>): PageInventoryItem[] {
  return input.pages.filter((p) => TESTED.includes(input.coverage.get(p.urlPath)?.coverage ?? 'tested'));
}

/** Pages grouped into requests: a few pages at a time, fewer when they have many controls. */
export function pageBatches(pages: PageInventoryItem[]): PageInventoryItem[][] {
  const batches: PageInventoryItem[][] = [];
  let current: PageInventoryItem[] = [];
  let controls = 0;
  for (const page of pages) {
    const count = Math.min(page.elements?.length ?? 0, CONTROLS_PER_PAGE);
    if (current.length > 0 && (current.length >= PAGES_PER_REQUEST || controls + count > CONTROLS_PER_REQUEST)) {
      batches.push(current);
      current = [];
      controls = 0;
    }
    current.push(page);
    controls += count;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * AI requests the pages and menus need: one per batch of pages to plan, and one for the shared
 * menus. Pages and links the site's memory already has don't count.
 */
export function estimatePageRequests(input: Pick<PagePlannerInput, 'pages' | 'coverage' | 'graph' | 'remembered'>): number {
  const toPlan = testedPages(input).filter((p) => !rememberedFor(p, input));
  // Links that delete, pay or sign out are never checked, so they're never asked about either.
  const safety = new SafetyFilter([]);
  const shared = unknownSharedLinks(input, input.graph.shared.filter((s) => clickable(s.link, safety))).length;
  return pageBatches(toPlan).length + Math.ceil(shared / SHARED_LINKS_PER_REQUEST);
}

/**
 * The JSON object in a model's answer, without code fences or chatter around it. Small free models
 * often leave a comma before a closing bracket; that one slip is forgiven, nothing else is guessed.
 */
export function parseJsonAnswer(text: string): any {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const body = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    return JSON.parse(body);
  } catch (err) {
    const withoutTrailingCommas = body.replace(/,(\s*[}\]])/g, '$1');
    if (withoutTrailingCommas === body) throw err;
    return JSON.parse(withoutTrailingCommas);
  }
}

/** Who a page's tests run as: the explorer whose view of the page they were planned from. */
function plannedAs(page: PageInventoryItem): string {
  const reached = page.reachedBy?.length ? page.reachedBy : ['visitor'];
  return reached[reached.length - 1];
}

function guessFillValue(target: string): string {
  const hint = target.toLowerCase();
  if (hint.includes('email')) return 'test.user@example.com';
  if (hint.includes('password') || hint.includes('pass')) return 'TestPassword123!';
  if (hint.includes('url') || hint.includes('address') || hint.includes('site') || hint.includes('domain') || hint.includes('host')) return 'https://example.com';
  if (hint.includes('phone') || hint.includes('tel')) return '5555550123';
  if (hint.includes('name')) return 'Test User';
  if (/number|amount|qty|quantity|price/.test(hint)) return '1';
  return 'Test Value';
}

function hostOf(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}

/** A Navigation Check's name when the AI didn't give one. */
export function defaultNavigationName(link: PageLink, shared?: NavigationCheck['shared']): string {
  const where = shared === 'footer' ? 'Footer: ' : shared ? 'Menu: ' : '';
  if (link.leavesSite) return `${where}“${link.name}” link to ${hostOf(link.to)} works`;
  return `${where}“${link.name}” opens ${link.to}`;
}

/**
 * A Navigation Check for one link, started from `startPage`. Where narrow screens hide the link
 * behind a menu button, opening the menu comes first at those sizes; where nothing shows it, the
 * check doesn't run at that size.
 */
export function navigationCheck(
  link: PageLink,
  startPage: PageInventoryItem,
  options: { shared?: NavigationCheck['shared']; roles: string[]; source: PlanItemSource; name?: string; expectation?: string }
): NavigationCheck {
  const menuSteps: TestCaseStep[] = [];
  const notAt: Breakpoint[] = [];
  for (const size of link.leavesSite ? [] : link.hiddenAt || []) {
    const menu = (startPage.narrowMenus || []).find((m) => m.breakpoint === size);
    if (!menu) {
      notAt.push(size);
      continue;
    }
    const same = menuSteps.find((s) => s.selector === menu.selector);
    if (same) same.onlyAt = [...(same.onlyAt || []), size];
    else menuSteps.push({ action: 'click', selector: menu.selector, name: `Open the menu (“${menu.name}”)`, onlyAt: [size] });
  }
  return {
    id: `nav:${options.shared ? 'shared' : startPage.urlPath}|${linkKey(link)}`,
    name: options.name?.trim() || defaultNavigationName(link, options.shared),
    startPage: startPage.urlPath,
    shared: options.shared,
    linkName: link.name,
    selector: link.selector,
    to: link.to,
    landsOn: link.landsOn,
    landsOnBy: link.landsOnBy,
    leavesSite: link.leavesSite,
    expectation: options.expectation?.trim() || undefined,
    menuSteps: menuSteps.length > 0 ? menuSteps : undefined,
    notAt: notAt.length > 0 ? notAt : undefined,
    roles: options.roles,
    source: options.source,
  };
}

/** A link a check may click: anything that deletes, pays or ends a session is never clicked. */
function clickable(link: PageLink, safety: SafetyFilter): boolean {
  return !SESSION_ENDING.test(link.name) && !safety.isSensitive(link.name, link.selector);
}

/**
 * The Fixed-Rule Fallback for a page: try each safe button, tab or switch on it (never a form's
 * send button, a delete, a payment or a sign-out), coming back to the page before each.
 */
export function fallbackPageTests(page: PageInventoryItem, safety: SafetyFilter): PlanPageTest[] {
  const tried = new Set<string>();
  const controls = (page.elements || []).filter((el) => {
    const key = el.name.toLowerCase();
    if (tried.has(key) || !el.visible || !el.enabled || el.insideForm) return false;
    if (!['button', 'tab', 'switch', 'checkbox'].includes(el.role)) return false;
    if (RISKY_TO_CLICK.test(el.name) || SESSION_ENDING.test(el.name) || safety.isSensitive(el.name, el.selector)) return false;
    tried.add(key);
    return true;
  });
  if (controls.length === 0) return [];
  const steps: TestCaseStep[] = [];
  for (const el of controls.slice(0, 6)) {
    if (steps.length > 0) steps.push({ action: 'navigate', value: page.urlPath, name: `Back to ${page.urlPath}`, optional: true });
    steps.push({ action: 'click', selector: el.selector, name: `Try “${el.name}”`, optional: true });
  }
  return [
    {
      id: `pagetest:${page.urlPath}:fallback`,
      name: 'Try the page’s buttons and tabs',
      role: plannedAs(page),
      steps,
      source: 'fallback',
    },
  ];
}

interface PageFacts {
  urlPath: string;
  title: string;
  controls: Array<{ role: string; name: string; selector: string; type?: string; disabled?: boolean; inForm?: boolean }>;
  forms: Array<{ fields: Array<{ label?: string; type?: string; required?: boolean; selector: string }>; submit?: string; sendsData: boolean }>;
  links: Array<{ selector: string; name: string; to: string }>;
}

/** A page's own links that a check may click, as many as are checked. */
function pageLinks(page: PageInventoryItem, input: Pick<PagePlannerInput, 'graph'>, safety: SafetyFilter): PageLink[] {
  return (input.graph.inPage.get(page.urlPath) || []).filter((l) => clickable(l, safety)).slice(0, LINKS_PER_PAGE);
}

function pageFacts(page: PageInventoryItem, input: PagePlannerInput, safety: SafetyFilter, titles: Map<string, string>): PageFacts {
  return {
    urlPath: page.urlPath,
    title: page.title,
    // Controls it must never press (deleting, paying, signing out) aren't offered at all.
    controls: (page.elements || [])
      .filter((el) => el.visible && el.role !== 'link' && !SESSION_ENDING.test(el.name) && !safety.isSensitive(el.name, el.selector))
      .slice(0, CONTROLS_PER_PAGE)
      .map((el) => ({
        role: el.role,
        name: el.name,
        selector: el.selector,
        type: el.inputType,
        disabled: el.enabled ? undefined : true,
        inForm: el.insideForm || undefined,
      })),
    forms: input.forms
      .filter((f) => f.urlPath === page.urlPath)
      .map((f) => ({
        fields: f.inputs.map((i) => ({ label: i.label, type: i.type, required: i.required || undefined, selector: i.selector })),
        submit: f.submitButtonSelector,
        sendsData: (f.method || 'GET').toUpperCase() !== 'GET',
      })),
    links: pageLinks(page, input, safety)
      .filter((l) => asksAbout(l, titles))
      .map((l) => ({ selector: l.selector, name: l.name, to: l.to })),
  };
}

/** The owner's notes, cut short when long: they're sent with every request. */
function notesForRequest(context: string | undefined): string {
  const notes = context?.trim() || '';
  if (!notes) return 'None given.';
  return notes.length > CONTEXT_CHARS_PER_REQUEST ? `${notes.slice(0, CONTEXT_CHARS_PER_REQUEST)}… (cut short)` : notes;
}

function siteIntro(input: PagePlannerInput): string {
  return [
    `You are planning pre-release tests for ${input.targetUrl}, a ${input.siteType} site.`,
    input.readOnly
      ? 'This is the LIVE site: plan nothing that sends a form or changes data. Opening, expanding, switching tabs, filtering and searching are fine.'
      : 'This is a test copy: filling in and sending forms is fine, but never delete, pay, buy or sign out.',
    'Product notes from the owner:',
    notesForRequest(input.productContext),
  ].join('\n');
}

function pagesPrompt(input: PagePlannerInput, facts: PageFacts[]): string {
  return `${siteIntro(input)}

For EVERY page below, plan "tests": what a person does on the page and what should happen, as 1 to 5 small tests (more for busy pages, none for a page with nothing to do). Each test:
   {"name": "plain words, e.g. Switching to yearly billing shows yearly prices",
    "steps": [{"action": "click" | "fill" | "select" | "check", "selector": "copied exactly from THIS page's controls or form fields", "value": "text to type or option to pick, for fill and select", "name": "plain words"}],
    "expect": {"text": "wording that should then show"} or {"visible": "a selector from this page that should then show"} or {"url": "/path it should go to"} or {"error": "the label of a field whose error message should show"} or {}}
Where a page lists "links" (links to pages not yet seen), you may add "links": [{"selector": "the same as listed", "expect": "what the destination should show, in a few words"}] for the ones you can say something about. Leave out the rest.

Rules:
- Only use selectors listed for that page. Never invent one.
- Never press anything that deletes, pays, buys, signs out or sends messages to people.
- Only quote wording that appears on the page or in the product notes. If unsure, use "expect": {}.

Pages:
${JSON.stringify(facts)}

Answer with ONLY this JSON: {"pages": [{"urlPath": "...", "tests": [...]}]}`;
}

function menusPrompt(input: PagePlannerInput, links: Array<{ selector: string; name: string; to: string; where: string; destination?: string }>): string {
  return `${siteIntro(input)}

These links are in the header, menu or footer of many pages and go to pages not yet seen. For each one you can, say what the destination should show.

Links:
${JSON.stringify(links)}

Answer with ONLY this JSON: {"links": [{"selector": "the same as listed", "expect": "what the destination should show, in a few words"}]}`;
}

/** Where a quote came from: the owner's notes, or the AI's guess. A guess never fails a site on its own. */
function originOf(wording: string | undefined, notes: string): 'user' | 'ai-guess' {
  const quote = (wording || '').trim();
  return quote.length >= 3 && notes.includes(quote) ? 'user' : 'ai-guess';
}

/** What the AI said a link's destination should show. */
interface PlannedLink {
  expectation?: string;
}

interface PageAnswer {
  tests: PlanPageTest[];
  links: Map<string, PlannedLink>;
  problems: string[];
}

/** Turns one page's part of the AI's answer into Plan Items, keeping only what can run as written. */
function readPageAnswer(raw: any, page: PageInventoryItem, input: PagePlannerInput, safety: SafetyFilter): PageAnswer {
  const answer: PageAnswer = { tests: [], links: new Map(), problems: [] };
  const byTarget = new Map<string, { name: string; element?: ElementInventoryItem }>();
  for (const el of page.elements || []) byTarget.set(el.selector, { name: el.name, element: el });
  const forms = input.forms.filter((f) => f.urlPath === page.urlPath);
  for (const form of forms) {
    for (const field of form.inputs) if (!byTarget.has(field.selector)) byTarget.set(field.selector, { name: field.label || field.selector });
    if (form.submitButtonSelector && !byTarget.has(form.submitButtonSelector)) byTarget.set(form.submitButtonSelector, { name: 'Send' });
  }
  const notes = input.productContext || '';
  const role = plannedAs(page);

  const tests: any[] = Array.isArray(raw?.tests) ? raw.tests.slice(0, MAX_TESTS_PER_PAGE) : [];
  tests.forEach((t, n) => {
    const name = typeof t?.name === 'string' ? t.name.trim() : '';
    const rawSteps: any[] = Array.isArray(t?.steps) ? t.steps.slice(0, MAX_STEPS_PER_TEST) : [];
    if (!name || rawSteps.length === 0) {
      answer.problems.push(`${page.urlPath}: test ${n + 1} has no name or no steps.`);
      return;
    }
    const steps: TestCaseStep[] = [];
    for (const s of rawSteps) {
      const action = s?.action;
      const target = typeof s?.selector === 'string' ? byTarget.get(s.selector) : undefined;
      if (!['click', 'fill', 'select', 'check'].includes(action) || !target) {
        answer.problems.push(`${page.urlPath}: “${name}” uses ${s?.selector ? `“${s.selector}”, which isn't on the page` : 'a step with no selector'}.`);
        return;
      }
      if (SESSION_ENDING.test(target.name) || safety.isSensitive(target.name, s.selector)) {
        answer.problems.push(`${page.urlPath}: “${name}” presses “${target.name}”, which could delete, pay or sign out.`);
        return;
      }
      const value =
        action === 'fill' || action === 'select'
          ? typeof s.value === 'string' && s.value.trim()
            ? s.value
            : guessFillValue(`${s.selector} ${target.name}`)
          : undefined;
      steps.push({ action, selector: s.selector, value, name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : target.name });
    }

    let expectations: TestCaseExpectations | undefined;
    const expect = t?.expect || {};
    if (typeof expect.text === 'string' && expect.text.trim()) {
      expectations = { text: { contains: expect.text.trim() }, origin: originOf(expect.text, notes) };
    } else if (typeof expect.visible === 'string' && byTarget.has(expect.visible)) {
      expectations = { elementState: { selector: expect.visible, visible: true }, origin: 'ai-guess' };
    } else if (typeof expect.url === 'string' && expect.url.startsWith('/')) {
      expectations = { url: { pattern: expect.url }, origin: 'ai-guess' };
    } else if (typeof expect.error === 'string' && expect.error.trim()) {
      expectations = { validationError: { field: expect.error.trim() }, origin: 'ai-guess' };
    }

    const test: PlanPageTest = { id: `pagetest:${page.urlPath}:${answer.tests.length + 1}`, name, role, steps, expectations, source: 'ai' };
    const asFlow = { id: test.id, name, role, description: '', startPage: page.urlPath, steps } as DiscoveredFlow;
    if (needsTestCopy(asFlow, [page], forms)) test.needsTestCopy = true;
    answer.tests.push(test);
  });

  for (const l of Array.isArray(raw?.links) ? raw.links : []) {
    if (typeof l?.selector !== 'string') continue;
    answer.links.set(l.selector, {
      expectation: typeof l.expect === 'string' ? l.expect : typeof l.expectation === 'string' ? l.expectation : undefined,
    });
  }
  return answer;
}

export interface AskOptions {
  redact: (text: string) => string;
  /** The problems in a parsed answer; none means it's used as it is. */
  problemsIn: (parsed: any) => string[];
  system?: string;
  stage?: 'planning' | 'journeys';
  /** Called before each request: 1 for the first, 2 for the repair. */
  onTry?: (attempt: number) => void;
}

/**
 * Asks the AI once, and once more with the problems listed when the answer is unusable or leaves
 * something out. Returns the last answer that parsed, or throws when none did. An answer cut off by
 * the output allowance isn't repaired: asking again with the same allowance ends the same way, so
 * it throws AITruncatedError and fixed rules take over.
 */
export async function askWithOneRepair(ai: AIProvider, prompt: string, options: AskOptions): Promise<any> {
  const messages: AIMessage[] = [
    { role: 'system', content: options.system ?? 'You plan pre-release website tests. Answer with strictly valid JSON only.' },
    { role: 'user', content: options.redact(prompt) },
  ];
  const asked = { responseFormat: 'json', reasoning: 'low', maxTokens: PLANNING_MAX_TOKENS } as const;
  options.onTry?.(1);
  const answer = await completeWith(ai, messages, { ...asked, temperature: 0.2, stage: options.stage ?? 'planning' });
  const first = answer.text;
  let parsed: any;
  let problems: string[];
  try {
    parsed = parseJsonAnswer(first);
    problems = options.problemsIn(parsed);
  } catch (err) {
    if (answer.finishReason === 'length') throw new AITruncatedError(answer.model);
    problems = [`The answer was not valid JSON (${err instanceof Error ? err.message : err}).`];
  }
  if (problems.length === 0) return parsed;

  options.onTry?.(2);
  const repair = await completeWith(
    ai,
    [
      ...messages,
      { role: 'assistant', content: first },
      {
        role: 'user',
        content: `That answer can't be used as it is:\n${problems.slice(0, 25).map((p) => `- ${p}`).join('\n')}\n\nReply again with the COMPLETE JSON object, covering everything asked for. Copy selectors exactly as listed. No commentary.`,
      },
    ],
    { ...asked, temperature: 0, stage: 'repair' }
  );
  try {
    return parseJsonAnswer(repair.text);
  } catch (err) {
    if (parsed) return parsed;
    if (repair.finishReason === 'length') throw new AITruncatedError(repair.model);
    throw err;
  }
}

/** Why a request failed, as the Plan records it on the items fixed rules planned instead. */
export function fallbackReasonOf(err: unknown): FallbackReason {
  if (err instanceof StoppedEarlyError) return 'stopped';
  if (err instanceof BudgetSpentError) return 'budget';
  if (err instanceof AITruncatedError) return 'truncated';
  return 'no-answer';
}

/**
 * Why fixed rules planned some items, in plain words for the Plan's notes. The counts are of the
 * items themselves, the same ones the approval summary counts, so the two always agree.
 */
export function fallbackNotes(items: Array<{ source?: string; fallbackReason?: FallbackReason }>): string[] {
  const count = (reason: FallbackReason) => items.filter((i) => i.source === 'fallback' && i.fallbackReason === reason).length;
  const n = (k: number) => `${k} ${k === 1 ? 'item' : 'items'}`;
  const notes: string[] = [];
  const truncated = count('truncated');
  if (truncated > 0) {
    notes.push(
      `The AI model stopped before it finished answering (it used its whole answer allowance), so fixed rules planned ${n(truncated)}. Choose another model in Settings, then re-plan them.`
    );
  }
  const overBudget = count('budget');
  if (overBudget > 0) {
    notes.push(`The AI Request Budget ran out: ${n(overBudget)} ${overBudget === 1 ? 'was' : 'were'} planned by fixed rules. Re-plan them with the AI when requests are available again.`);
  }
  const stopped = count('stopped');
  if (stopped > 0) notes.push(`You stopped the scan early, so fixed rules planned ${n(stopped)}. Re-plan them with the AI when you like.`);
  const noAnswer = count('no-answer');
  if (noAnswer > 0) notes.push(`The AI service didn’t answer for ${n(noAnswer)}, so fixed rules planned them.`);
  const unusable = count('unusable');
  if (unusable > 0) notes.push(`The AI’s answers for ${n(unusable)} couldn’t be used even after asking again, so fixed rules planned them.`);
  return notes;
}

/**
 * Plans every page's tests and every Navigation Check, a few pages per request. A link's check is
 * named from its text and where it goes; the AI is asked only what a destination the crawl didn't
 * see should show, in the page's request or one request for the shared menus. Every answer is
 * checked: real selectors only, nothing that deletes, pays or signs out. What's still unusable after
 * one repair, cut off, or past the AI Request Budget, is planned by fixed rules and labeled so.
 */
export async function planPagesAndMenus(
  input: PagePlannerInput,
  ai: AIProvider | undefined,
  onProgress?: (progress: PlannerProgress) => void
): Promise<PagePlannerOutput> {
  const safety = new SafetyFilter(input.forbiddenActions || []);
  const titles = titlesOf(input.pages);
  const tested = testedPages(input);
  // Unchanged pages keep what was approved last time; only the rest goes to the AI.
  const batches = pageBatches(tested.filter((p) => !rememberedFor(p, input)));
  const sharedToPlan = input.graph.shared.filter((s) => clickable(s.link, safety));
  const sharedToAsk = unknownSharedLinks(input, sharedToPlan);
  const total = batches.length + Math.ceil(sharedToAsk.length / SHARED_LINKS_PER_REQUEST);
  let done = 0;
  const asking = (what: string) => (attempt: number) =>
    onProgress?.({ done, total, what: `Asking the AI about ${what}${attempt > 1 ? ` (try ${attempt})` : ''}…`, asking: true, attempt });

  /** Pages' tests, who planned them, and what the AI said about their links' destinations. */
  const planned = new Map<string, { tests: PlanPageTest[]; source: PlanItemSource; reason?: FallbackReason; links: Map<string, PlannedLink> }>();
  for (const page of tested) {
    const before = rememberedFor(page, input);
    if (before) planned.set(page.urlPath, { tests: JSON.parse(JSON.stringify(before.tests)), source: before.source, links: new Map() });
  }

  for (const batch of batches) {
    const facts = batch.map((p) => pageFacts(p, input, safety, titles));
    const answers = new Map<string, PageAnswer>();
    let failure: FallbackReason | undefined = ai ? undefined : 'no-ai';
    if (ai) {
      try {
        const readAll = (parsed: any) => {
          answers.clear();
          const problems: string[] = [];
          const byPath = new Map<string, any>(
            (Array.isArray(parsed?.pages) ? parsed.pages : []).map((p: any) => [pathOf(String(p?.urlPath ?? '')), p])
          );
          for (const page of batch) {
            const raw = byPath.get(pathOf(page.urlPath));
            if (!raw) {
              problems.push(`The page ${page.urlPath} is missing.`);
              continue;
            }
            const answer = readPageAnswer(raw, page, input, safety);
            answers.set(page.urlPath, answer);
            problems.push(...answer.problems);
          }
          return problems;
        };
        const paths = batch.map((p) => p.urlPath);
        const what = paths.length > 2 ? `${paths.slice(0, 2).join(', ')} and ${paths.length - 2} more` : paths.join(', ');
        readAll(await askWithOneRepair(ai, pagesPrompt(input, facts), { redact: input.redact, problemsIn: readAll, onTry: asking(what) }));
      } catch (err) {
        failure = fallbackReasonOf(err);
      }
    }
    for (const page of batch) {
      const answer = answers.get(page.urlPath);
      const aiTests = answer?.tests ?? [];
      // A page the AI planned nothing usable for gets the fixed rules; a page the AI said has nothing to do stays empty.
      const usedAi = !!answer && (aiTests.length > 0 || answer.problems.length === 0);
      planned.set(page.urlPath, {
        tests: usedAi ? aiTests : fallbackPageTests(page, safety),
        source: usedAi ? 'ai' : 'fallback',
        reason: usedAi ? undefined : (failure ?? 'unusable'),
        links: answer?.links ?? new Map<string, PlannedLink>(),
      });
    }
    done++;
    onProgress?.({ done, total, what: `Planned ${batch.map((p) => p.urlPath).join(', ')}` });
  }

  // The shared menus: what the destinations the crawl didn't see should show, for links in many
  // pages' headers, menus and footers that the site's memory doesn't know yet.
  const sharedPlanned = new Map<string, PlannedLink>();
  /** Shared links the AI couldn't be asked about, and why. */
  const sharedUnplanned = new Map<string, FallbackReason>();
  for (let i = 0; i < sharedToAsk.length; i += SHARED_LINKS_PER_REQUEST) {
    const chunk = sharedToAsk.slice(i, i + SHARED_LINKS_PER_REQUEST);
    if (!ai) {
      for (const s of chunk) sharedUnplanned.set(s.link.selector, 'no-ai');
      continue;
    }
    const list = chunk.map((s) => ({ selector: s.link.selector, name: s.link.name, to: s.link.to, where: s.link.landmark ?? 'page' }));
    try {
      const read = (parsed: any) => {
        for (const l of Array.isArray(parsed?.links) ? parsed.links : []) {
          if (typeof l?.selector === 'string') {
            sharedPlanned.set(l.selector, { expectation: typeof l.expect === 'string' ? l.expect : undefined });
          }
        }
        // Leaving a link out is fine: its check is named from its text either way.
        return [];
      };
      read(await askWithOneRepair(ai, menusPrompt(input, list), { redact: input.redact, problemsIn: read, onTry: asking('the shared menus') }));
    } catch (err) {
      for (const s of chunk) sharedUnplanned.set(s.link.selector, fallbackReasonOf(err));
    }
    done++;
    onProgress?.({ done, total, what: 'Planned the shared menus' });
  }

  // Plan Items: every page listed; checks for every shared link once and every tested page's own links.
  const byPath = new Map(input.pages.map((p) => [pathOf(p.urlPath), p]));
  const pages: PlanPage[] = input.pages.map((page) => {
    const info = input.coverage.get(page.urlPath) ?? { coverage: 'tested' as const };
    const plan = planned.get(page.urlPath);
    return {
      id: `page:${page.urlPath}`,
      urlPath: page.urlPath,
      title: page.title,
      layoutGroup: info.layoutGroup,
      coverage: info.coverage,
      coveredBy: info.coveredBy,
      reachedBy: page.reachedBy?.length ? page.reachedBy : ['visitor'],
      clickPath: input.graph.clickPaths.get(page.urlPath),
      unlinked: input.graph.unlinked.includes(page.urlPath) || undefined,
      screenshotPath: page.screenshotPath,
      tests: plan?.tests ?? [],
      source: plan?.source ?? 'ai',
      fallbackReason: plan?.reason,
      isNew: page.isNew,
    };
  });

  const navigation: NavigationCheck[] = [];
  // A shared menu is checked from the start page when it has the menu, else the first page that does.
  const startPath = [...input.graph.clickPaths].find(([, route]) => route.length === 0)?.[0];
  const startFor = (shared: SharedLink): PageInventoryItem =>
    byPath.get(pathOf(startPath && shared.pages.includes(startPath) ? startPath : shared.pages[0])) ?? input.pages[0];
  /** What a destination should show: what the AI said, else the title of the page the crawl saw there. */
  const expectationFor = (link: PageLink, written?: PlannedLink) => {
    if (written?.expectation) return written.expectation;
    const title = destinationTitle(link, titles);
    return title ? `The “${title}” page` : undefined;
  };
  /**
   * Who planned a link's check. One to a page the crawl saw needs no AI, so it counts as planned
   * unless there's no AI at all; one the AI was to be asked about counts as fixed rules when it wasn't.
   */
  const sourceOf = (link: PageLink, unasked: FallbackReason | undefined): Pick<NavigationCheck, 'source' | 'fallbackReason'> => {
    const reason = !ai ? 'no-ai' : asksAbout(link, titles) ? unasked : undefined;
    return reason ? { source: 'fallback', fallbackReason: reason } : { source: 'ai' };
  };
  // A link the AI didn't write about just now keeps the check remembered from last time, if any.
  const withMemory = (check: NavigationCheck, written?: PlannedLink): NavigationCheck => {
    const before = written ? undefined : rememberedCheck(input, check.id);
    return before
      ? { ...check, name: before.name, expectation: before.expectation ?? check.expectation, source: before.source, fallbackReason: undefined }
      : check;
  };
  for (const shared of sharedToPlan) {
    const written = sharedPlanned.get(shared.link.selector);
    const { source, fallbackReason } = sourceOf(shared.link, sharedUnplanned.get(shared.link.selector));
    navigation.push(
      withMemory(
        {
          ...navigationCheck(shared.link, startFor(shared), {
            shared: shared.link.landmark ?? 'nav',
            roles: shared.seenBy.length ? shared.seenBy : ['visitor'],
            source,
            expectation: expectationFor(shared.link, written),
          }),
          fallbackReason,
        },
        written
      )
    );
  }
  for (const page of tested) {
    const plan = planned.get(page.urlPath);
    const plannedLinks = plan?.links ?? new Map<string, PlannedLink>();
    for (const link of pageLinks(page, input, safety)) {
      const written = plannedLinks.get(link.selector);
      // A link is asked about with its page: when the AI couldn't plan the page, fixed rules planned both.
      const { source, fallbackReason } = sourceOf(link, plan?.reason);
      navigation.push(
        withMemory(
          {
            ...navigationCheck(link, page, {
              roles: link.seenBy?.length ? link.seenBy : page.reachedBy?.length ? page.reachedBy : ['visitor'],
              source,
              expectation: expectationFor(link, written),
            }),
            fallbackReason,
          },
          written
        )
      );
    }
  }

  const items = [...pages.filter((p) => p.coverage !== 'covered'), ...navigation];
  const count = (reason: FallbackReason) => items.filter((i) => i.source === 'fallback' && i.fallbackReason === reason).length;
  return { pages, navigation, overBudget: count('budget'), truncated: count('truncated'), notes: fallbackNotes(items) };
}
