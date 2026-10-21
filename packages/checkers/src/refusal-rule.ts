import type { Page } from 'playwright';

/**
 * The refusal rule (ticket 2.3): after a form is sent with a value it should not accept, the app
 * must have refused it. Refused means: the page did not move on, no new record appeared, and the
 * page showed a signal (a field marked invalid, an alert, or new error text). A toast with no role
 * and no error markup is NOT a signal.
 *
 * The in-page part is a plain function expression string so the Playwright export can embed it
 * verbatim and judge the same way the checker does.
 */

export type RefusalSignal = 'invalid' | 'aria-invalid' | 'alert' | 'error-text';

export interface RefusalBaseline {
  /** Pathname before the submit click. */
  path: string;
  /** Rows / list items / cards on the page before the click. */
  records: number;
  /** Visible error texts (alerts included) already on the page before the click. Not a signal after it. */
  errorTexts: string[];
}

export interface RefusalInput {
  baseline: RefusalBaseline;
  /** Only when a Source states the wording. */
  message?: string;
  /** Look only at `:invalid` / `aria-invalid`. */
  probeOnly?: boolean;
}

export interface RefusalResult {
  moved: boolean;
  newRecord: boolean;
  signals: RefusalSignal[];
  errorText?: string;
  crashed: boolean;
}

/** Local mirror of `TestCaseExpectations.refusal`. */
export interface RefusalExpectation {
  formPath: string;
  submitSelector?: string;
  message?: string;
  probeOnly?: boolean;
}

/** Function expression: `(baseline) => RefusalBaseline-like`, runs in the page. */
export const CAPTURE_BASELINE_SOURCE = String.raw`() => {
  const visibleTexts = () => {
    const out = [];
    const sel = '[role="alert"], [class*="error" i], [class*="invalid" i], [data-test*="error" i], [data-testid*="error" i]';
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const r = el.getBoundingClientRect();
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (t && r.width > 0 && r.height > 0 && !out.includes(t)) out.push(t);
    }
    return out;
  };
  return {
    path: location.pathname,
    records: document.querySelectorAll('tbody tr, [role="row"], ul > li, ol > li, [data-row], [data-testid*="row" i]').length,
    errorTexts: visibleTexts(),
  };
}`;

/** Function expression: `({ baseline, message, probeOnly }) => RefusalResult`, runs in the page. */
export const REFUSAL_RULE_SOURCE = String.raw`(input) => {
  const baseline = input.baseline;
  const probeOnly = !!input.probeOnly;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const textOf = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const signals = [];
  let errorText;
  const note = (t) => { if (t && errorText === undefined) errorText = t; };

  const controls = Array.from(document.querySelectorAll('input, select, textarea'));
  const invalidControl = controls.find((c) => c.matches(':invalid') && visible(c));
  if (invalidControl) signals.push('invalid');
  const ariaInvalid = Array.from(document.querySelectorAll('[aria-invalid="true"]')).find(visible);
  if (ariaInvalid) signals.push('aria-invalid');

  if (!probeOnly) {
    // An alert that was already on the page before the submit is not a refusal of this send.
    const alert = Array.from(document.querySelectorAll('[role="alert"]'))
      .map((el) => (visible(el) ? textOf(el) : ''))
      .find((t) => t && !baseline.errorTexts.includes(t));
    if (alert) { signals.push('alert'); note(alert); }
    const sel = '[class*="error" i], [class*="invalid" i], [data-test*="error" i], [data-testid*="error" i]';
    const fresh = [];
    for (const el of Array.from(document.querySelectorAll(sel))) {
      if (!visible(el)) continue;
      const t = textOf(el);
      if (t && !baseline.errorTexts.includes(t) && !fresh.includes(t)) fresh.push(t);
    }
    if (fresh.length > 0) { signals.push('error-text'); note(fresh[0]); }
  }
  // The browser's own wording comes last, so the text the page shows is what a Source's sentence is compared with.
  if (invalidControl) note(invalidControl.validationMessage || '');

  const nav = performance.getEntriesByType('navigation')[0];
  const status = (nav && nav.responseStatus) || 0;
  const bodyText = (document.body && document.body.innerText || '').replace(/\s+/g, ' ').trim();
  const media = document.querySelectorAll('img, svg, canvas, video').length;
  const h1 = document.querySelector('h1');
  const heading = h1 ? textOf(h1) : '';
  const notFound = /^(404\b|page not found|not found\b|this page (could not|couldn.t|can.t|cannot) be found|(internal )?server error)/i;
  const crashed =
    (status >= 500) ||
    (status >= 400 && signals.length === 0) ||
    (!bodyText && media === 0) ||
    notFound.test(heading) || notFound.test(document.title || '');

  const records = document.querySelectorAll('tbody tr, [role="row"], ul > li, ol > li, [data-row], [data-testid*="row" i]').length;
  const result = {
    moved: location.pathname !== baseline.path,
    newRecord: records > baseline.records,
    signals,
    crashed,
  };
  if (errorText) result.errorText = errorText;
  return result;
}`;

export interface RefusalJudgement {
  refused: boolean;
  crashed: boolean;
  /** Only set when a message was asked for and the app refused: did the shown text contain it? */
  messageMatches?: boolean;
}

/** Pure Node judge; the same rule the exported `expectRefused` applies. */
export function judgeRefusal(result: RefusalResult, opts: { message?: string } = {}): RefusalJudgement {
  const refused = !result.moved && !result.newRecord && result.signals.length > 0;
  const judgement: RefusalJudgement = { refused, crashed: result.crashed };
  if (refused && opts.message) {
    judgement.messageMatches = (result.errorText ?? '').toLowerCase().includes(opts.message.toLowerCase());
  }
  return judgement;
}

/** Looks at the page right before the submit click. */
export async function captureRefusalBaseline(page: Page): Promise<RefusalBaseline> {
  return page.evaluate(`(${CAPTURE_BASELINE_SOURCE})()`) as Promise<RefusalBaseline>;
}

/** Looks at the page after the click and returns what the rule saw. */
export async function readRefusal(page: Page, input: RefusalInput): Promise<RefusalResult> {
  return page.evaluate(`(${REFUSAL_RULE_SOURCE})(${JSON.stringify(input)})`) as Promise<RefusalResult>;
}
