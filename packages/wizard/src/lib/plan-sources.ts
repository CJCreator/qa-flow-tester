import type { DocSource, FindingSeverity, PlanNotFound, PlanPageTest, ReviewPlan } from '@qa/types';
import type { PatchPlanBody } from '../api.js';

type SourceEdit = NonNullable<PatchPlanBody['sourceEdits']>[number];

/** "admin-guide.md, section Users > Create": the Source in the words a person reads. */
export function docSourceLabel(source: DocSource): string {
  return source.section ? `${source.document}, section ${source.section}` : source.document;
}

/** The tests on the plan that came from a document, with the page each is on. */
export function sourcedTests(plan: Pick<ReviewPlan, 'planPages'>): Array<{ test: PlanPageTest; urlPath: string }> {
  return (plan.planPages ?? []).flatMap((p) =>
    p.tests.filter((t) => !!t.docSource).map((test) => ({ test, urlPath: p.urlPath }))
  );
}

/** Items whose roles the AI proposed and the person has not yet confirmed. */
export function rolesToConfirm(plan: Pick<ReviewPlan, 'planPages'>): number {
  return sourcedTests(plan).filter(({ test }) => !!test.proposedRoles?.length && !test.rolesConfirmed).length;
}

export function isDenial(test: Pick<PlanPageTest, 'kind'>): boolean {
  return test.kind === 'denial';
}

/** Whether the item was planned during the scan or added once it ended; nothing for older plans. */
export function originLabel(origin: 'while-crawling' | 'after-crawl' | undefined): string | null {
  if (origin === 'while-crawling') return 'Planned while scanning';
  if (origin === 'after-crawl') return 'Added after the scan';
  return null;
}

/** The roles line on an item: proposed, or confirmed by the person. */
export function rolesLine(test: Pick<PlanPageTest, 'proposedRoles' | 'rolesConfirmed'>): string | null {
  const roles = test.proposedRoles;
  if (!roles?.length) return null;
  const names = roles.map((r) => (r === 'anonymous' ? 'visitor' : r)).join(', ');
  return test.rolesConfirmed ? `Roles (confirmed): ${names}` : `Roles proposed by the AI: ${names}`;
}

/** The roles a person typed ("admin, manager") as a clean list; empty when nothing usable. */
export function parseRoles(typed: string): string[] {
  return [...new Set(typed.split(/[,;\n]/).map((r) => r.trim().toLowerCase()).filter(Boolean))];
}

export function confirmRolesEdit(itemId: string, roles?: string[]): NonNullable<PatchPlanBody['sourceEdits']> {
  const edit: SourceEdit = { itemId, confirm: true };
  if (roles && roles.length > 0) edit.roles = roles;
  return [edit];
}

export function severityEdit(itemId: string, severity: FindingSeverity): NonNullable<PatchPlanBody['sourceEdits']> {
  return [{ itemId, severity }];
}

export function staleEdit(itemId: string, stale: boolean): NonNullable<PatchPlanBody['sourceEdits']> {
  return [{ itemId, stale }];
}

export function removeNotFoundEdit(id: string): NonNullable<PatchPlanBody['notFoundEdits']> {
  return [{ id, remove: true }];
}

/** "Not found in app" entries still listed, grouped by document, in the order the plan has them. */
export function notFoundByDocument(
  notFound: PlanNotFound[] | undefined
): Array<{ document: string; items: PlanNotFound[] }> {
  const groups = new Map<string, PlanNotFound[]>();
  for (const item of notFound ?? []) {
    if (item.skipped) continue;
    const list = groups.get(item.docSource.document) ?? [];
    list.push(item);
    groups.set(item.docSource.document, list);
  }
  return [...groups].map(([document, items]) => ({ document, items }));
}

/** "4 of 6 documented items reached", or null when no document was added. */
export function documentedLine(documented: { reached: number; total: number } | undefined): string | null {
  if (!documented || documented.total <= 0) return null;
  return `${documented.reached} of ${documented.total} documented items reached`;
}

/** The plan is partly written during the scan: say so plainly. */
export function plannedWhileScanningLine(plan: Pick<ReviewPlan, 'plannedWhileCrawling'>): string | null {
  return plan.plannedWhileCrawling
    ? 'Planning started while the scan was still running. Items marked “Added after the scan” came last.'
    : null;
}
