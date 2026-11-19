import type { Locator } from 'playwright';
import type { SensitiveAction } from '@qa/types';
import { SafetyFilter } from './safety-filter.js';

/** The reason a step gets when the click-time gate pauses it (T-421). */
export const SENSITIVE_PAUSED = 'Sensitive Action: paused by the Safety Filter';

/** The Plan Item step a click belongs to, as far as the gate needs it. */
export interface ClickGateItem {
  /** The step's name in the Plan, e.g. `Click “Delete account”`. */
  name?: string;
  selector?: string;
  /** Approved in Plan Review as a Sensitive Action. */
  sensitiveApproved?: boolean;
  /** The App is a Test Copy: only there does an approval let a Sensitive Action run. */
  testCopy: boolean;
  /** The profile's own restrictions, matched like the Safety Filter matches them. */
  forbiddenActions?: string[];
}

export type ClickGateResult = { allowed: true } | { allowed: false; reason: string; sensitive: SensitiveAction };

/**
 * What the element says about itself right now: its accessible name parts (`aria-label`, `aria-labelledby`,
 * `title`, an image's `alt`), its visible text and its `value`. Read live, so a Plan made on another
 * version of the page cannot hide what the button does today.
 */
export async function readClickLabel(locator: Locator): Promise<string[]> {
  const parts = await locator
    .first()
    .evaluate((el: Element) => {
      const out: string[] = [];
      const attr = (n: string) => el.getAttribute(n) ?? '';
      out.push(attr('aria-label'), attr('title'));
      for (const id of attr('aria-labelledby').split(/\s+/).filter(Boolean)) {
        out.push(el.ownerDocument.getElementById(id)?.textContent ?? '');
      }
      out.push((el as HTMLElement).innerText ?? el.textContent ?? '');
      if ('value' in el && typeof (el as HTMLInputElement).value === 'string') out.push((el as HTMLInputElement).value);
      for (const img of Array.from(el.querySelectorAll('img[alt]'))) out.push(img.getAttribute('alt') ?? '');
      return out;
    })
    .catch(() => [] as string[]);
  return parts.map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length > 0);
}

/**
 * The Safety Filter at the moment of the click. A Sensitive Action is not clicked unless the person approved
 * it in Plan Review and the App is a Test Copy: that approval is the pause the glossary describes.
 */
export async function clickGate(locator: Locator, item: ClickGateItem): Promise<ClickGateResult> {
  const label = await readClickLabel(locator);
  const text = [...label, item.name ?? ''].join(' ').trim();
  const sensitive = new SafetyFilter(item.forbiddenActions).isSensitive(text, item.selector ?? '');
  if (!sensitive) return { allowed: true };
  if (item.sensitiveApproved && item.testCopy) return { allowed: true };
  return { allowed: false, reason: SENSITIVE_PAUSED, sensitive };
}
