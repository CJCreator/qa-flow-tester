import type { DiscoveryDraft, ElementInventoryItem, TestCase, TestCaseStep } from '@qa/types';
import { SafetyFilter } from './safety-filter.js';
import { RISKY_TO_CLICK, SESSION_ENDING } from './deterministic-spider.js';

/** How many pages the sweep visits by default, the same budget as a standard review. */
export const DEFAULT_SWEEP_PAGES = 25;
const MAX_CONTROLS_PER_PAGE = 6;
const SWEEP_ROLES = new Set(['button', 'tab', 'switch', 'checkbox']);

/**
 * After the journeys, every page that was found gets its own visit: open it, try each safe button
 * or tab on it (never a form submit, a delete, a payment or a sign-out), and let every check run.
 * This finds problems no planned journey passes through, such as a button that breaks the page.
 */
export function buildPageSweep(
  draft: DiscoveryDraft,
  options: { maxPages?: number; forbiddenActions?: string[] } = {}
): TestCase[] {
  const safety = new SafetyFilter(options.forbiddenActions || []);
  const pages = draft.pages.filter((p) => !p.outOfScope).slice(0, options.maxPages ?? DEFAULT_SWEEP_PAGES);

  return pages.map((page, index) => {
    const tried = new Set<string>();
    const controls = (page.elements || []).filter((el) => {
      const key = el.name.toLowerCase();
      if (tried.has(key) || !isSafeToTry(el, safety)) return false;
      tried.add(key);
      return true;
    });

    // Back to the page before each control, in case the previous one moved away from it.
    const steps: TestCaseStep[] = [{ action: 'wait', name: `Look at ${page.urlPath}` }];
    for (const el of controls.slice(0, MAX_CONTROLS_PER_PAGE)) {
      if (steps.length > 1) steps.push({ action: 'navigate', value: page.urlPath, name: `Back to ${page.urlPath}`, optional: true });
      steps.push({ action: 'click', selector: el.selector, name: `Try “${el.name}”`, optional: true });
    }

    // Visit as someone who could reach the page: signed out when possible.
    const reachedBy = page.reachedBy || ['visitor'];
    const role = reachedBy.includes('visitor') ? 'visitor' : reachedBy[0];

    return {
      id: `SWEEP-${String(index + 1).padStart(3, '0')}`,
      flowId: 'page-sweep',
      name: `Visit ${page.urlPath}`,
      role,
      startPage: page.urlPath,
      steps,
      expectations: {},
    };
  });
}

function isSafeToTry(el: ElementInventoryItem, safety: SafetyFilter): boolean {
  if (!el.visible || !el.enabled || el.insideForm) return false;
  if (!SWEEP_ROLES.has(el.role)) return false;
  if (RISKY_TO_CLICK.test(el.name) || SESSION_ENDING.test(el.name)) return false;
  return !safety.isSensitive(el.name, el.selector);
}
