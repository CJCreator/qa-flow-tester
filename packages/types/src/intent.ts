/**
 * Intent of a journey or form Plan Item (ADR 0024): Works, Rejects, Limits or Denied. Browser-safe:
 * the wizard imports this file directly, so no Node imports.
 */
import type { PlanIntent } from './plan.js';

/** The Intents in the order the Plan lists them. */
export const INTENTS: readonly PlanIntent[] = ['works', 'rejects', 'limits', 'denied'];

/** Plans saved before Intent carried the old Denial kind. Read only here; never written. */
const LEGACY_DENIAL_KIND = 'denial';

/** The Intent of a Plan Item. A legacy Denial kind reads as Denied. */
export function intentOf(item: { intent?: PlanIntent; kind?: string }): PlanIntent | undefined {
  if (item.intent) return item.intent;
  return item.kind === LEGACY_DENIAL_KIND ? 'denied' : undefined;
}

/** A copy of the item with `intent` set and the legacy `kind` removed. Items without either come back as is. */
export function normalizeIntentItem<T extends { intent?: PlanIntent; kind?: string }>(item: T): T {
  if (item.kind !== LEGACY_DENIAL_KIND) return item;
  const { kind: _legacy, ...rest } = item;
  return { ...rest, intent: item.intent ?? 'denied' } as T;
}

interface PlanWithItems {
  planPages?: Array<{ tests: Array<{ intent?: PlanIntent; kind?: string }> }>;
  flows?: Array<{ intent?: PlanIntent; kind?: string }>;
}

/** The tests of a saved page list, normalized. Pure. */
export function normalizeTestIntents<T extends { intent?: PlanIntent; kind?: string }>(tests: T[]): T[] {
  return tests.map(normalizeIntentItem);
}

/** A copy of a stored plan or draft with every legacy Denial item read as `intent: 'denied'`. Pure. */
export function normalizePlanIntents<P extends PlanWithItems>(plan: P): P {
  const next = { ...plan };
  if (plan.planPages) {
    next.planPages = plan.planPages.map((p) => ({ ...p, tests: normalizeTestIntents(p.tests) }));
  }
  if (plan.flows) next.flows = plan.flows.map(normalizeIntentItem);
  return next;
}
