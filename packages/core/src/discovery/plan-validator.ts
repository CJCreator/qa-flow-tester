import type { DiscoveredFlow, ElementInventoryItem, PageInventoryItem } from '@qa/types';

export interface PlanIssue {
  flowId: string;
  stepIndex: number;
  stepName: string;
  /** Plain explanation, also sent back to the AI when asking it to repair the plan. */
  message: string;
}

/** Form selectors the crawler recorded, which the AI may copy as well. */
export interface KnownFormSelectors {
  urlPath: string;
  inputs: Array<{ selector: string }>;
  submitButtonSelector?: string;
}

type Matcher = (el: ElementInventoryItem) => boolean;

const FILLABLE_ROLES = new Set(['textbox', 'searchbox', 'spinbutton', 'combobox', 'slider']);
const MAX_PROMPT_ELEMENTS_PER_PAGE = 40;

function normalizePath(pathOrUrl: string | undefined): string {
  if (!pathOrUrl) return '/';
  try {
    return new URL(pathOrUrl, 'http://placeholder').pathname;
  } catch {
    return pathOrUrl;
  }
}

const includesText = (haystack: string, needle: string) => haystack.toLowerCase().includes(needle.toLowerCase());

/** Turns a step selector into a test over inventory items, or null when its form can't be checked. */
function matcherFor(selector: string): Matcher | null {
  const s = selector.trim();
  let m: RegExpMatchArray | null;

  if ((m = s.match(/^\[data-(?:testid|test|cy|qa)\s*=\s*["']?([^"'\]]+)["']?\]$/))) {
    const testId = m[1];
    return (el) => el.testId === testId;
  }
  if ((m = s.match(/^#([A-Za-z_][\w-]*)$/))) {
    const id = m[1];
    return (el) => el.id === id;
  }
  if ((m = s.match(/^([a-z]+)?\[name\s*=\s*["']?([^"'\]]+)["']?\]$/))) {
    const [, tag, name] = m;
    return (el) => el.nameAttribute === name && (!tag || el.tagName === tag);
  }
  if ((m = s.match(/^role=([a-z]+)\[name\s*=\s*"((?:[^"\\]|\\.)*)"i?\]$/))) {
    const role = m[1];
    const name = m[2].replace(/\\(.)/g, '$1');
    return (el) => el.role === role && includesText(el.name, name);
  }
  if ((m = s.match(/^(?:text=)?["']?([^"'=[\]#.:>]+)["']?$/)) && /\s/.test(m[1])) {
    // Plain words such as "Save invoice": the runner falls back to label, role name and visible text.
    const words = m[1].trim();
    return (el) => includesText(el.name, words);
  }
  if ((m = s.match(/:has-text\(\s*["']([^"']+)["']\s*\)/))) {
    const words = m[1];
    return (el) => includesText(el.name, words);
  }
  if (/^[A-Za-z0-9_-]+$/.test(s)) {
    // A bare word: the runner tries it as a test id, then as a label or name.
    return (el) => el.testId === s || el.id === s || el.nameAttribute === s || includesText(el.name, s);
  }
  return null;
}

/**
 * Checks an AI-written plan against the elements the crawler actually found, so no step aimed at
 * an element that doesn't exist ever reaches the test runner.
 */
export class PlanValidator {
  private readonly elementsByPath = new Map<string, ElementInventoryItem[]>();
  private readonly formSelectorsByPath = new Map<string, Set<string>>();
  private readonly allElements: ElementInventoryItem[] = [];
  private readonly allFormSelectors = new Set<string>();

  constructor(pages: PageInventoryItem[], forms: KnownFormSelectors[] = []) {
    for (const page of pages) {
      if (!page.elements) continue;
      const path = normalizePath(page.urlPath);
      this.elementsByPath.set(path, page.elements);
      this.allElements.push(...page.elements);
    }
    for (const form of forms) {
      const path = normalizePath(form.urlPath);
      const known = this.formSelectorsByPath.get(path) || new Set<string>();
      for (const sel of [...form.inputs.map((i) => i.selector), form.submitButtonSelector]) {
        if (!sel) continue;
        known.add(sel);
        this.allFormSelectors.add(sel);
      }
      this.formSelectorsByPath.set(path, known);
    }
  }

  /** False for drafts written before the crawler recorded elements: there is nothing to check against. */
  get canCheck(): boolean {
    return this.allElements.length > 0;
  }

  checkFlow(flow: DiscoveredFlow): PlanIssue[] {
    if (!this.canCheck) return [];
    const issues: PlanIssue[] = [];
    // The page each step runs on is known at the start and after a direct navigation. After a
    // click the page may have changed, so later steps are checked against every page found.
    let currentPath: string | null = normalizePath(flow.startPage);

    (flow.steps || []).forEach((step, stepIndex) => {
      const issue = (message: string) => issues.push({ flowId: flow.id, stepIndex, stepName: step.name, message });

      if (step.action === 'navigate') {
        const target = normalizePath(step.value);
        currentPath = this.elementsByPath.has(target) ? target : null;
        return;
      }
      if (step.action === 'wait') return;

      if (!step.selector) {
        issue(`Step "${step.name}" (${step.action}) has no selector.`);
        return;
      }

      const onPage = currentPath !== null && this.elementsByPath.has(currentPath);
      const candidates = onPage ? this.elementsByPath.get(currentPath!)! : this.allElements;
      const formSelectors = onPage ? this.formSelectorsByPath.get(currentPath!) : this.allFormSelectors;
      const where = onPage ? `on ${currentPath}` : 'on any page that was found';

      const matcher = matcherFor(step.selector);
      const matches = candidates.filter((el) => el.selector === step.selector || (matcher !== null && matcher(el)));
      const isKnownFormSelector = formSelectors?.has(step.selector) ?? false;

      if (matches.length === 0 && !isKnownFormSelector) {
        issue(
          matcher === null
            ? `Step "${step.name}" uses selector ${step.selector}, which isn't one of the listed selectors. Copy a selector from the element list.`
            : `Step "${step.name}" targets ${step.selector}, but no such element exists ${where}.`
        );
      } else if (step.action === 'fill' && matches.length > 0 && !matches.some((el) => FILLABLE_ROLES.has(el.role))) {
        issue(`Step "${step.name}" fills ${step.selector}, which is a ${matches[0].role}, not a field.`);
      }

      if (step.action === 'click' || step.action === 'check') currentPath = null;
    });

    return issues;
  }

  check(flows: DiscoveredFlow[]): PlanIssue[] {
    return flows.flatMap((flow) => this.checkFlow(flow));
  }

  /**
   * Marks every flow with an issue as needing help, so it isn't run until someone fixes it, and
   * clears the mark from a flow that has been fixed.
   */
  markFlowsNeedingHelp(flows: DiscoveredFlow[]): PlanIssue[] {
    const issues = this.check(flows);
    for (const flow of flows) {
      const own = issues.filter((i) => i.flowId === flow.id).map((i) => i.message);
      if (own.length > 0) flow.needsHelp = own;
      else delete flow.needsHelp;
    }
    return issues;
  }

  /** The element list of one page, formatted for the AI prompt (visible elements only). */
  static describePageForPrompt(page: PageInventoryItem): string {
    const visible = (page.elements || []).filter((el) => el.visible);
    const lines = visible.slice(0, MAX_PROMPT_ELEMENTS_PER_PAGE).map((el) => {
      const type = el.inputType && el.role === 'textbox' ? ` (${el.inputType})` : '';
      const state = el.enabled ? '' : ' [disabled]';
      return `  - ${el.role}${type} "${el.name}"${state} → selector: ${el.selector}`;
    });
    if (visible.length > MAX_PROMPT_ELEMENTS_PER_PAGE) {
      lines.push(`  - …and ${visible.length - MAX_PROMPT_ELEMENTS_PER_PAGE} more`);
    }
    const reachedBy = page.reachedBy?.length ? ` (reached by: ${page.reachedBy.join(', ')})` : '';
    return [
      `Page ${page.urlPath} — "${page.title}"${reachedBy}`,
      ...(lines.length ? lines : ['  (no interactive elements)']),
    ].join('\n');
  }
}
