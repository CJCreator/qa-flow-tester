import { randomBytes } from 'crypto';
import type { BrowserContext, Page } from 'playwright';
import { actionText, SENSITIVE_PATTERN_SOURCE } from './action-words.js';

/**
 * Runs in every document before site scripts: swallows submit events and turns the programmatic submit
 * APIs into no-ops, so no form can be sent by any path. The Competitive Benchmark's Safe Interaction Mode.
 */
export const BLOCK_FORM_SUBMISSION_SCRIPT = `
  document.addEventListener('submit', (e) => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
  HTMLFormElement.prototype.submit = function () {};
  HTMLFormElement.prototype.requestSubmit = function () {};
`;

/** A submit the guard stopped. Fixed wording plus the form's action path; never field values. */
export interface BlockedSubmit {
  /** 'event': a submit button or Enter in a field. 'submit' / 'requestSubmit': called from page script. */
  how: 'event' | 'submit' | 'requestSubmit';
  /** The form's submit control or action names a Sensitive Action. */
  sensitive: boolean;
  /** The form's action path (no query), when it has one. */
  action?: string;
}

export interface SubmitGuardOptions {
  /**
   * The run may not send forms (any App that is not a Test Copy): `form.submit()` and `requestSubmit()` from
   * page script do nothing. A Sensitive Action form is stopped either way.
   */
  readOnly: boolean;
  /** The profile's own restrictions, matched like the Safety Filter matches them. */
  forbiddenActions?: string[];
  /** Told about every submit the guard stopped. */
  onBlocked?: (blocked: BlockedSubmit) => void;
}

export interface SubmitGuard {
  /** Lets the next submit through for 2 s: an approved Plan Item's own click (T-421) must not be stopped. */
  allowNextSubmit(page: Page): Promise<void>;
}

interface GuardConfig {
  pattern: string;
  forbidden: string[];
  readOnly: boolean;
  allowKey: string;
  binding: string;
}

/** The in-page guard. Exported for tests; `installSubmitGuard` is the way in. */
export function submitGuardScript(cfg: GuardConfig): string {
  return `(() => {
  const cfg = ${JSON.stringify(cfg)};
  const re = new RegExp(cfg.pattern);
  const proto = HTMLFormElement.prototype;
  const origSubmit = proto.submit;
  const origRequestSubmit = proto.requestSubmit;
  const norm = (s) => String(s || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const labelOf = (el) => el ? [el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent, el.value].join(' ') : '';
  const controlsOf = (form) => Array.from(form.querySelectorAll('button, input[type="submit"], input[type="image"]'))
    .filter((b) => b.tagName !== 'BUTTON' || !['button', 'reset'].includes((b.getAttribute('type') || 'submit').toLowerCase()));
  const actionOf = (form) => { try { return new URL(form.getAttribute('action') || '', location.href).pathname; } catch (e) { return ''; } };
  const sensitive = (form, submitter) => {
    const controls = submitter ? [submitter] : controlsOf(form);
    const text = norm([...controls.map(labelOf), actionOf(form), form.getAttribute('aria-label') || ''].join(' '));
    return re.test(text) || cfg.forbidden.some((f) => f && text.includes(f));
  };
  let allowUntil = 0;
  Object.defineProperty(window, cfg.allowKey, { value: () => { allowUntil = Date.now() + 2000; }, enumerable: false });
  const report = (form, how, isSensitive) => {
    try { const fn = window[cfg.binding]; if (fn) fn({ how, sensitive: isSensitive, action: actionOf(form) || undefined }); } catch (e) {}
  };
  const allowed = (form, submitter, how) => {
    if (!(form instanceof HTMLFormElement)) return true;
    if (allowUntil > Date.now()) return true;
    const isSensitive = sensitive(form, submitter);
    if (!isSensitive && !(cfg.readOnly && how !== 'event')) return true;
    report(form, how, isSensitive);
    return false;
  };
  document.addEventListener('submit', (e) => {
    if (!allowed(e.target, e.submitter || null, 'event')) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  proto.submit = function () { if (allowed(this, null, 'submit')) return origSubmit.call(this); };
  proto.requestSubmit = function (submitter) {
    if (allowed(this, submitter || null, 'requestSubmit')) return origRequestSubmit.apply(this, arguments);
  };
})();`;
}

/**
 * Guards every page of a Check-up's browser context against a form being sent outside the Plan (T-422):
 * by page script (`form.submit()`, `requestSubmit()`), by Enter in a field, or by a click.
 * - Not a Test Copy: script submits do nothing.
 * - Always: a form whose submit control or action is a Sensitive Action is not sent; `onBlocked` is told.
 * The check is the Safety Filter's word list, run inside the page so it can stop the submit in time.
 */
export async function installSubmitGuard(context: BrowserContext, options: SubmitGuardOptions): Promise<SubmitGuard> {
  const id = randomBytes(6).toString('hex');
  const cfg: GuardConfig = {
    pattern: SENSITIVE_PATTERN_SOURCE,
    forbidden: (options.forbiddenActions ?? []).map((f) => actionText(f)).filter((f) => f.length > 0),
    readOnly: options.readOnly,
    allowKey: `__qaAllowSubmit_${id}`,
    binding: `__qaSubmitBlocked_${id}`,
  };
  await context.exposeBinding(cfg.binding, (_source, info: BlockedSubmit) => {
    options.onBlocked?.({
      how: info?.how === 'submit' || info?.how === 'requestSubmit' ? info.how : 'event',
      sensitive: info?.sensitive === true,
      action: typeof info?.action === 'string' ? info.action.slice(0, 200) : undefined,
    });
  });
  await context.addInitScript(submitGuardScript(cfg));
  return {
    allowNextSubmit: async (page: Page) => {
      await page
        .evaluate((key) => {
          const fn = (window as unknown as Record<string, unknown>)[key];
          if (typeof fn === 'function') (fn as () => void)();
        }, cfg.allowKey)
        .catch(() => undefined);
    },
  };
}
