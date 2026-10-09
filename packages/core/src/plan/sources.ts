import type { DocSource, PlanNotFound, PlanPage, PlanPageTest } from '@qa/types';
import type { ParsedRequirementHint } from '../discovery/context-parser.js';
import { SafetyFilter } from '../discovery/safety-filter.js';

/**
 * Pure helpers for Sources (ADR 0020): which roles a documented requirement is for, the Denial Plan
 * Items that follow from it, and the documented items the app has nothing for ("Not found in app").
 */

export interface RoleBindingEntry {
  /** Roles the document says have it. */
  roles: string[];
  /** Roles the document says do not. */
  deniedRoles: string[];
}

/** Requirement id -> roles. A requirement missing here is treated as for every role. */
export type RoleBinding = Map<string, RoleBindingEntry>;

export const BIND_BATCH = 25;

/** Where a requirement came from, as the Plan shows it. */
export function docSourceOf(req: ParsedRequirementHint): DocSource {
  return { document: req.document ?? 'Product Context', section: req.section, requirementId: req.id };
}

/** The conservative answer: every known role allowed, nothing denied. */
export function defaultEntry(roles: string[]): RoleBindingEntry {
  return { roles: [...roles], deniedRoles: [] };
}

export function defaultBinding(requirements: ParsedRequirementHint[], roles: string[]): RoleBinding {
  return new Map(requirements.map((r) => [r.id, defaultEntry(roles)]));
}

const asNames = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()) : [];

/**
 * Reads the AI's role answer. Unknown ids and roles are dropped; an entry that is ambiguous (a role in
 * both lists, every role denied, or nothing allowed) falls back to the default for that requirement.
 * Returns problems only when the answer has no usable shape, so the one repair can run.
 */
export function readBinding(
  parsed: any,
  requirements: ParsedRequirementHint[],
  roles: string[]
): { binding: RoleBinding; problems: string[] } {
  const binding: RoleBinding = defaultBinding(requirements, roles);
  const list = parsed?.requirements;
  if (!Array.isArray(list)) {
    return { binding, problems: ['The answer has no "requirements" list.'] };
  }
  const known = new Set(roles);
  const ids = new Set(requirements.map((r) => r.id));
  for (const raw of list) {
    const id = typeof raw?.id === 'string' ? raw.id : '';
    if (!ids.has(id)) continue;
    const allowed = [...new Set(asNames(raw.roles).filter((r) => known.has(r)))];
    const denied = [...new Set(asNames(raw.deniedRoles).filter((r) => known.has(r)))];
    if (denied.length === 0) {
      if (allowed.length > 0) binding.set(id, { roles: allowed, deniedRoles: [] });
      continue;
    }
    const overlap = denied.some((r) => allowed.includes(r));
    if (overlap || allowed.length === 0 || denied.length >= roles.length) continue;
    binding.set(id, { roles: allowed, deniedRoles: denied });
  }
  return { binding, problems: [] };
}

export interface DenialOptions {
  safety?: SafetyFilter;
  /**
   * Whether the denied role's own view of the page still shows the control. When it does, the item
   * would be trying a control that works, so it needs a Test Copy like any other step.
   */
  controlShownTo?: (role: string, urlPath: string, selector: string) => boolean;
}

/**
 * One Denial Plan Item per denied role, on the same page as a planned test for an allowed role under
 * the same requirement. It asserts the control is not visible to that role.
 */
export function deriveDenials(
  pages: PlanPage[],
  binding: RoleBinding,
  options: DenialOptions = {}
): Array<{ urlPath: string; test: PlanPageTest }> {
  const safety = options.safety ?? new SafetyFilter();
  const out: Array<{ urlPath: string; test: PlanPageTest }> = [];
  for (const page of pages) {
    for (const source of page.tests) {
      const reqId = source.docSource?.requirementId;
      const entry = reqId ? binding.get(reqId) : undefined;
      if (!reqId || !entry || entry.deniedRoles.length === 0 || source.kind === 'denial') continue;
      const first = source.steps[0];
      if (!first?.selector) continue;
      const allowedRoles = new Set(entry.roles);
      const forAllowed = allowedRoles.has(source.role) || page.reachedBy.some((r) => allowedRoles.has(r));
      if (!forAllowed) continue;
      for (const role of entry.deniedRoles) {
        const id = `${source.id}:denial:${role}`;
        if (page.tests.some((t) => t.id === id) || out.some((o) => o.test.id === id)) continue;
        const shown = options.controlShownTo?.(role, page.urlPath, first.selector) ?? false;
        const sensitive = safety.isSensitive(first.name ?? '', first.selector);
        const test: PlanPageTest = {
          id,
          name: `${role} cannot: ${source.name}`,
          role,
          kind: 'denial',
          steps: [{ action: 'wait', name: 'Look at the page' }],
          expectations: { elementState: { selector: first.selector, visible: false }, origin: 'ai-guess' },
          source: source.source,
          docSource: source.docSource,
          proposedRoles: [role],
          rolesConfirmed: false,
        };
        if (shown || sensitive) test.needsTestCopy = true;
        out.push({ urlPath: page.urlPath, test });
      }
    }
  }
  return out;
}

/** The ids of requirements that at least one planned test (not a Denial) points at. */
export function reachedRequirementIds(pages: PlanPage[]): Set<string> {
  const reached = new Set<string>();
  for (const page of pages)
    for (const t of page.tests)
      if (t.kind !== 'denial' && t.docSource?.requirementId) reached.add(t.docSource.requirementId);
  return reached;
}

/** Documented items with no mapped test: reported as "Not found in app", never as failures. */
export function deriveNotFound(
  requirements: ParsedRequirementHint[],
  pages: PlanPage[],
  binding: RoleBinding,
  allRoles: string[] = []
): PlanNotFound[] {
  const reached = reachedRequirementIds(pages);
  const out: PlanNotFound[] = [];
  for (const req of requirements) {
    const name = req.name?.trim();
    if (!name || reached.has(req.id)) continue;
    const roles = binding.get(req.id)?.roles ?? allRoles;
    const as = roles.length ? roles.join(', ') : 'any role';
    out.push({
      id: `notfound:${req.id}`,
      docSource: docSourceOf(req),
      roles: [...roles],
      reason: `No page or control matching “${name}” was found as ${as}`,
    });
  }
  return out;
}

export function documentedItems(total: number, reached: number): { reached: number; total: number } {
  return { reached: Math.min(reached, total), total };
}
