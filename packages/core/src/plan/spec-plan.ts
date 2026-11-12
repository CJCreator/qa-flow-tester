import type {
  DiscoveredFlow,
  DocSource,
  ElementInventoryItem,
  FallbackReason,
  PageInventoryItem,
  PlanNotFound,
  PlanPageTest,
  TestCaseExpectations,
  TestCaseStep,
} from '@qa/types';
import type { ParsedRequirementHint } from '../discovery/context-parser.js';
import { SafetyFilter } from '../discovery/safety-filter.js';
import { needsTestCopy } from '../live-site.js';
import type { PlannerForm } from './ai-planner.js';
import { pathOf } from './site-graph.js';
import { normaliseRoleText, personaName, resolveRole, resolveRoleList } from './spec-roles.js';
import { UNIT_KINDS, docSourceOf } from './sources.js';

/**
 * The Fixed-Rule Fallback reading the Product Context (ADR 0009, 0020, 0023). Pure and deterministic:
 * it maps parsed documents plus the crawl's facts to Plan Items, each with its Source and the role it
 * runs as. It never judges free text: those assertions become "Needs your judgement" entries.
 */

export interface SpecCrawl {
  /** 'visitor' or a role name. */
  who: string;
  result: {
    pages: PageInventoryItem[];
    forms?: Array<{
      urlPath: string;
      method?: string;
      submitButtonSelector?: string;
      inputs: PlannerForm['inputs'];
      opening?: PlannerForm['opening'];
    }>;
  };
}

export interface PlanFromSpecInput {
  hints: ParsedRequirementHint[];
  /** Configured role names. */
  roles: string[];
  crawls: SpecCrawl[];
  readOnly: boolean;
  safety?: SafetyFilter;
  /** Units the AI already reached: left alone here. */
  skipRequirementIds?: ReadonlySet<string>;
  /** Why fixed rules planned the flows. Default 'no-ai'. */
  fallbackReason?: FallbackReason;
}

export interface SpecJudgement {
  role: string;
  docSource: DocSource;
  text: string;
  /** The flow that carries it, when it belongs to one. */
  flowId?: string;
}

export interface PlanFromSpecOutput {
  flows: DiscoveredFlow[];
  pageTests: Array<{ urlPath: string; test: PlanPageTest }>;
  judgement: SpecJudgement[];
  notFound: PlanNotFound[];
  notes: string[];
  /** Units (journeys, routes, negative specs) considered, and the ids that produced a Plan Item. */
  documented: { total: number; reachedIds: string[] };
}

/** Roles of controls a step may click. Fields are never filled: values are never invented. */
const NOT_CLICKABLE = new Set(['textbox', 'searchbox', 'spinbutton', 'combobox', 'slider']);
/** Words that finish something for good; the Safety Filter's own list does not name them all. */
const FINAL_ACTION = /\b(finali[sz]e|publish)\b/i;
const NEGATION = /\b(cannot|can't|can not|must not|never|not allowed|no access|denied|blocked|forbidden|may not)\b/i;
const ROUTE_TOKEN = /(?:^|[\s`"'“(])(\/[A-Za-z0-9][\w\-./]*)/g;
const DYNAMIC_OR_API = /^\/api(\/|$)|[*:[\]{}<>]/;

const cleanRoute = (r: string): string => {
  const p = pathOf(r.trim().replace(/[.,;:)]+$/, ''));
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
};

/** `/route` tokens in a text, in order, without the ones after "redirect to" or "land on". */
function routesIn(text: string, dropDestinations = false): string[] {
  let scan = text.replace(/\([^)]*\)/g, ' ');
  if (dropDestinations)
    scan = scan.replace(/\b(?:redirect(?:s|ed)?|goes?|sent|land(?:s|ed)?|back)\s+(?:to|on)\s+`?\/[\w\-./]*`?/gi, ' ');
  const out: string[] = [];
  for (const m of scan.matchAll(ROUTE_TOKEN)) {
    const route = cleanRoute(m[1]);
    if (!out.includes(route)) out.push(route);
  }
  return out;
}

const containsWords = (hay: string, needle: string): boolean => !!needle && ` ${hay} `.includes(` ${needle} `);

const describeWhere = (d: DocSource): string => `${d.document}${d.section ? `, ${d.section}` : ''}`;

export function planFromSpec(input: PlanFromSpecInput): PlanFromSpecOutput {
  const safety = input.safety ?? new SafetyFilter();
  const reason: FallbackReason = input.fallbackReason ?? 'no-ai';
  const skip = input.skipRequirementIds ?? new Set<string>();
  const configured = input.roles.length > 0 ? input.roles : ['visitor'];
  const hints = input.hints.filter((h) => !skip.has(h.id));

  const flows: DiscoveredFlow[] = [];
  const pageTests: PlanFromSpecOutput['pageTests'] = [];
  const judgement: SpecJudgement[] = [];
  const notFound: PlanNotFound[] = [];
  const notes: string[] = [];
  const reached = new Set<string>();
  const noted = new Set<string>();
  const note = (text: string) => {
    if (!noted.has(text)) {
      noted.add(text);
      notes.push(text);
    }
  };

  // What the crawl saw: routes by anyone, pages by role.
  const knownRoutes = new Set<string>();
  const pagesBy = new Map<string, PageInventoryItem[]>();
  const allPages: PageInventoryItem[] = [];
  const allForms: NonNullable<SpecCrawl['result']['forms']> = [];
  for (const c of input.crawls) {
    pagesBy.set(c.who, [...(pagesBy.get(c.who) ?? []), ...c.result.pages]);
    for (const p of c.result.pages) {
      knownRoutes.add(cleanRoute(p.urlPath));
      allPages.push(p);
    }
    allForms.push(...(c.result.forms ?? []));
  }

  /** The configured role a word names. With no role configured, only visitor words name the signed-out view. */
  const roleFor = (text: string | undefined): string | undefined => {
    if (!text) return undefined;
    if (input.roles.length === 0) return /\b(visitor|guest|public|anonymous)\b/i.test(text) ? 'visitor' : undefined;
    return resolveRole(text, input.roles);
  };
  const listFor = (text: string) =>
    input.roles.length === 0 && /^\s*(all|everyone|public|visitor|guest)/i.test(text)
      ? { roles: ['visitor'], unresolved: [] as string[] }
      : resolveRoleList(text, input.roles.length > 0 ? input.roles : ['visitor']);

  const addJudgement = (role: string, docSource: DocSource, text: string, flow?: DiscoveredFlow) => {
    judgement.push({ role, docSource, text, ...(flow ? { flowId: flow.id } : {}) });
    if (flow) (flow.userRules ??= []).push({ text, origin: 'document', checkable: false });
  };

  // Denials from Negative specs win over the Site Map's for the same (role, route).
  const negativeKeys = new Set<string>();
  for (const h of hints) {
    if (h.kind !== 'negative') continue;
    const role = roleFor(h.persona);
    if (!role) continue;
    for (const clause of h.rules)
      if (NEGATION.test(clause)) for (const r of routesIn(clause, true)) negativeKeys.add(`${role}|${r}`);
  }

  const denialDone = new Set<string>();
  const reachDone = new Set<string>();
  const seenRoutes = new Set<string>();
  const addReach = (h: ParsedRequirementHint, role: string, route: string) => {
    const id = `route-reach:${role}:${route}`;
    if (reachDone.has(id)) return;
    reachDone.add(id);
    pageTests.push({
      urlPath: route,
      test: {
        id,
        name: `${role} can open ${route}`,
        role,
        steps: [{ action: 'navigate', value: route, name: `Open ${route}` }],
        expectations: { origin: 'user', url: { pattern: route, description: `${role} can open ${route}` } },
        source: 'fallback',
        docSource: docSourceOf(h),
      },
    });
    reached.add(h.id);
  };
  const addDenial = (h: ParsedRequirementHint, role: string, route: string) => {
    const id = `route-denial:${role}:${route}`;
    if (denialDone.has(id)) return;
    denialDone.add(id);
    pageTests.push({
      urlPath: route,
      test: {
        id,
        name: `${role} cannot open ${route}`,
        role,
        intent: 'denied',
        steps: [{ action: 'navigate', value: route, name: `Try to open ${route}` }],
        expectations: {
          origin: 'user',
          url: { pattern: route, negate: true, description: `${role} does not stay on ${route}` },
        },
        source: 'fallback',
        docSource: docSourceOf(h),
        proposedRoles: [role],
        rolesConfirmed: false,
      },
    });
    reached.add(h.id);
  };
  const missingRoute = (h: ParsedRequirementHint, route: string, roles: string[], suffix = '') => {
    notFound.push({
      id: `notfound:${h.id}${suffix}`,
      docSource: docSourceOf(h),
      roles,
      reason: `No page “${route}” was found in the app`,
    });
  };

  // Rolled-up entries that belong to no flow ride on one carrier flow per role, shown for a person to check.
  const loose = new Map<string, SpecJudgement[]>();
  const looseJudgement = (role: string, docSource: DocSource, text: string) => {
    const j = { role, docSource, text };
    judgement.push(j);
    loose.set(role, [...(loose.get(role) ?? []), j]);
  };

  for (const h of hints) {
    if (h.kind === 'route') {
      const route = cleanRoute(h.route ?? '');
      if (!h.route || !route.startsWith('/') || DYNAMIC_OR_API.test(route)) {
        if (h.route && !/^\/api(\/|$)/.test(route))
          note(`Skipped the route “${h.route}”: it has a parameter or a wildcard.`);
        continue;
      }
      if (seenRoutes.has(route)) {
        note(`The route ${route} is listed in more than one place. The first one listed is used.`);
        continue;
      }
      seenRoutes.add(route);
      const { roles: allowed, unresolved } = listFor(h.rolesText ?? '');
      if (!knownRoutes.has(route)) {
        missingRoute(h, route, allowed);
        continue;
      }
      for (const role of allowed) addReach(h, role, route);
      if (unresolved.length > 0) {
        const where = docSourceOf(h);
        note(
          `Roles “${unresolved.join(', ')}” for ${route} were not matched to a role of this Check-up, so no Denial Plan Items were made for it.`
        );
        looseJudgement(
          'Any role',
          where,
          `Who may open ${route} is unclear: “${h.rolesText}” (${describeWhere(where)})`
        );
      } else {
        // Every named role matched: the others are not allowed.
        for (const role of configured) {
          if (allowed.includes(role) || negativeKeys.has(`${role}|${route}`)) continue;
          addDenial(h, role, route);
        }
      }
      // A route row with nobody resolved still counts as read.
      if (allowed.length === 0 && unresolved.length === 0) reached.add(h.id);
    }
  }

  for (const h of hints) {
    if (h.kind === 'negative') {
      const role = roleFor(h.persona);
      const where = docSourceOf(h);
      if (!role) {
        note(
          `No role of this Check-up is named “${personaName(h.persona ?? '') || 'unknown'}”, so its negative specs were not turned into Plan Items.`
        );
        for (const clause of h.rules) looseJudgement('Any role', where, `${clause} (${describeWhere(where)})`);
        continue;
      }
      for (const clause of h.rules) {
        const routes = NEGATION.test(clause) ? routesIn(clause, true) : [];
        if (routes.length === 0) {
          looseJudgement(role, where, `${clause} (${describeWhere(where)})`);
          continue;
        }
        for (const route of routes) {
          if (DYNAMIC_OR_API.test(route)) continue;
          if (!knownRoutes.has(route)) missingRoute(h, route, [role], `:${route}`);
          else addDenial(h, role, route);
        }
      }
    }
  }

  // User Flows.
  for (const h of hints) {
    if (h.kind !== 'journey') continue;
    const flow = flowFrom(h);
    flows.push(flow);
    if (!flow.needsHelp?.length) reached.add(h.id);
  }

  // Access Matrix rows: never pass or fail, a person reads them.
  for (const h of hints) {
    if (h.kind !== 'capability') continue;
    for (const [header, raw] of Object.entries(h.cells ?? {})) {
      const role = roleFor(header);
      if (!role) {
        note(`The Access Matrix column “${header}” was not matched to a role of this Check-up.`);
        continue;
      }
      const cell = raw.trim();
      const where = docSourceOf(h);
      if (/^(✅|✔️?|yes|all)$/i.test(cell)) continue;
      if (/❌|✗|✖|^(no|n\/a|—|-)$/i.test(cell))
        looseJudgement(role, where, `${h.name}: not allowed per ${describeWhere(where)}`);
      else if (cell)
        looseJudgement(
          role,
          where,
          `${h.name}: limited to “${cell.replace(/✅/g, '').trim() || cell}” per ${describeWhere(where)}`
        );
    }
  }

  for (const [role, entries] of loose) {
    flows.push({
      id: `spec-rules-${normaliseRoleText(role).replace(/ /g, '-') || 'any'}`,
      name: `Rules from your documents to check by hand (${role})`,
      role,
      description: 'Rules from the documents that no check can judge. A person reads them; they never pass or fail.',
      startPage: '/',
      steps: [],
      needsHelp: ['Nothing to run: these rules are for a person to check'],
      source: 'fallback',
      fallbackReason: reason,
      docSource: entries[0].docSource,
      userRules: entries.map((e) => ({ text: e.text, origin: 'document' as const, checkable: false })),
    });
  }

  const unitIds = input.hints.filter((h) => UNIT_KINDS.has(h.kind ?? '')).map((h) => h.id);
  const total = unitIds.filter((id) => !skip.has(id)).length;
  return { flows, pageTests, judgement, notFound, notes, documented: { total, reachedIds: [...reached] } };

  function flowFrom(h: ParsedRequirementHint): DiscoveredFlow {
    const where = docSourceOf(h);
    const role = roleFor(h.persona);
    const flow: DiscoveredFlow = {
      id: `spec-${h.id}`,
      name: h.name,
      role: role ?? (personaName(h.persona ?? '') || 'Any role'),
      description: `From ${describeWhere(where)}${h.description ? `: ${h.description}` : ''}`,
      startPage: '/',
      steps: [],
      source: 'fallback',
      fallbackReason: reason,
      docSource: where,
    };
    if (!role) {
      const named = personaName(h.persona ?? '');
      flow.needsHelp = [named ? `No role named "${named}" in this Check-up` : 'No role is named for this User Flow'];
      note(`The User Flow “${h.name}” is for “${named || 'no named role'}”, which is not a role of this Check-up.`);
      return flow;
    }
    if ((h.preconditions ?? []).length > 0)
      addJudgement(role, where, `Precondition: ${h.preconditions!.join('; ')}`, flow);

    const pages = pagesBy.get(role) ?? [];
    let current: string | null = null;
    let missed = 0;
    const segments = (h.steps ?? [])
      .flatMap((s) => s.split('→'))
      .map((s) => s.replace(/^\s*\d+[.)]\s*/, '').trim())
      .filter(Boolean);
    for (const segment of segments) {
      const step = stepFor(segment);
      if (step.kind === 'step') {
        if (step.before && current !== step.before)
          flow.steps.push({ action: 'navigate', value: step.before, name: `Open ${step.before}` });
        flow.steps.push(step.step);
        current = step.step.action === 'navigate' ? (step.step.value ?? null) : null;
      } else {
        missed++;
        addJudgement(
          role,
          where,
          step.kind === 'safety' ? `Left out by the Safety Filter: ${segment}` : `Step not run: ${segment}`,
          flow
        );
      }
    }
    flow.startPage =
      flow.steps.find((s) => s.action === 'navigate')?.value ?? (pages[0] ? cleanRoute(pages[0].urlPath) : '/');

    if (segments.length === 0) flow.needsHelp = ['This User Flow lists no steps'];
    else if (flow.steps.length === 0) {
      flow.needsHelp = ['None of the steps could be matched to a page or control'];
      notFound.push({
        id: `notfound:${h.id}`,
        docSource: where,
        roles: [role],
        reason: `No page or control matching the steps of “${h.name}” was found as ${role}`,
      });
    }

    // Assertions: only forms a rule can check become expectations; the rest is for a person.
    const expect: TestCaseExpectations = {};
    for (const raw of (h.assert ?? [])
      .flatMap((a) => a.split(';'))
      .map((a) => a.trim())
      .filter(Boolean)) {
      const land = /\b(?:land(?:s|ed)?\s+on|redirect(?:s|ed)?\s+to)\s+`?(\/[\w\-./]*)`?/i.exec(raw);
      const status = /\b(?:status|label)\s+["“]([^"”]+)["”]/i.exec(raw);
      if (land && !expect.url && !DYNAMIC_OR_API.test(cleanRoute(land[1]))) {
        expect.url = { pattern: cleanRoute(land[1]), description: raw };
      } else if (status && !expect.text) {
        expect.text = { contains: status[1], description: raw };
      } else {
        addJudgement(role, where, `${raw} (${describeWhere(where)})`, flow);
      }
    }
    if (expect.url || expect.text) {
      // Steps that were left out may be why a page is not reached: then it is only a guess to confirm.
      flow.candidateExpectations = { ...expect, origin: missed > 0 ? 'ai-guess' : 'user' };
    }
    if (flow.steps.length > 0 && needsTestCopy(flow, allPages, allForms)) flow.needsTestCopy = true;
    return flow;

    function stepFor(
      segment: string
    ): { kind: 'step'; step: TestCaseStep; before?: string } | { kind: 'unmatched' } | { kind: 'safety' } {
      // (a) A route that exists in the app.
      const route = routesIn(segment).find((r) => knownRoutes.has(r) && !DYNAMIC_OR_API.test(r));
      if (route) return { kind: 'step', step: { action: 'navigate', value: route, name: `Open ${route}` } };

      // (b) A control the role saw, named in backticks, quotes or words.
      const quoted = [...segment.matchAll(/`([^`]+)`|"([^"]+)"|“([^”]+)”|'([^']+)'/g)]
        .map((m) => normaliseRoleText(m[1] ?? m[2] ?? m[3] ?? m[4] ?? ''))
        .filter((q) => q && !q.startsWith('/'));
      const words = normaliseRoleText(segment);
      let best: { el: ElementInventoryItem; page: string; score: number } | undefined;
      const ordered = current
        ? [...pages].sort(
            (a, b) => Number(cleanRoute(b.urlPath) === current) - Number(cleanRoute(a.urlPath) === current)
          )
        : pages;
      for (const page of ordered) {
        for (const el of page.elements ?? []) {
          if (!el.visible || NOT_CLICKABLE.has(el.role)) continue;
          const name = normaliseRoleText(el.name);
          if (name.length < 1) continue;
          const hit =
            quoted.length > 0
              ? quoted.some((q) => q === name || (q.length >= 3 && (containsWords(name, q) || containsWords(q, name))))
              : name.length >= 3 && containsWords(words, name);
          if (hit && (!best || name.length > best.score))
            best = { el, page: cleanRoute(page.urlPath), score: name.length };
        }
      }
      if (best) {
        if (safety.isSensitive(best.el.name, best.el.selector) || FINAL_ACTION.test(best.el.name))
          return { kind: 'safety' };
        return {
          kind: 'step',
          step: { action: 'click', selector: best.el.selector, name: `Click “${best.el.name}”` },
          ...(current !== null && best.page !== current
            ? { before: best.page }
            : current === null && flow.steps.length === 0
              ? { before: best.page }
              : {}),
        };
      }
      // Nothing to click, and the words themselves name something the filter blocks.
      if (safety.isSensitive(segment, '') || FINAL_ACTION.test(segment)) return { kind: 'safety' };
      return { kind: 'unmatched' };
    }
  }
}
