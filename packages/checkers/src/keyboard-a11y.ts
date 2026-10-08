import type { Page } from 'playwright';
import type { Breakpoint, Finding, FindingSeverity } from '@qa/types';
import { wcagCriteria } from './ux-quality.js';

/**
 * Keyboard and reflow checks (T-22): elements the Tab key cannot reach, focus hidden under a fixed
 * header, focus that gets stuck, and sideways scrolling at 320 px. Automatic checks only (ADR 0018):
 * wording says a criterion is "not met" by what the check saw, never that a page is accessible.
 *
 * Safety: the Tab walk presses Tab and, at most once, Escape. Never Enter, Space, a click or typing.
 */

export interface KeyboardA11yContext {
  testCaseId?: string;
  flowId?: string;
  role: string;
  breakpoint: Breakpoint;
  urlPath: string;
}

export interface TabStop {
  /** Position in a freshly queried list of visible focusable elements (-1 when not in it). */
  idx: number;
  selector: string;
  tag: string;
  testId?: string;
  rect: { x: number; y: number; width: number; height: number };
  /** True when fixed or sticky content covers the whole focused element. */
  obscured: boolean;
  focusableCount: number;
}

export interface TabWalk {
  stops: TabStop[];
  /** Focus went back to the page body (the normal end of a Tab walk). */
  leftPage: boolean;
  /** Focus came back to the first stop after visiting nearly every focusable element. */
  wrapped: boolean;
  focusableCount: number;
}

const TRAP_WINDOW = 24;
const TRAP_MAX_CYCLE = 8;
const TRAP_MIN_VISITS = 3;
const CAP = 5;

/** Pure: do the last stops circle through a small set of elements while more exist? */
export function detectTrap(
  stops: Array<{ idx: number }>,
  focusableCount: number
): { trapped: boolean; cycle: number[] } {
  if (stops.length < TRAP_WINDOW) return { trapped: false, cycle: [] };
  const counts = new Map<number, number>();
  for (const s of stops.slice(-TRAP_WINDOW)) counts.set(s.idx, (counts.get(s.idx) ?? 0) + 1);
  const cycle = [...counts.keys()];
  const small = cycle.length <= TRAP_MAX_CYCLE && [...counts.values()].every((n) => n >= TRAP_MIN_VISITS);
  return small && focusableCount > cycle.length ? { trapped: true, cycle } : { trapped: false, cycle: [] };
}

async function readStop(page: Page): Promise<TabStop | null> {
  const raw: unknown = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el === document.documentElement) return null;
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const sel = (e: Element): string => {
      const t = e.getAttribute('data-testid');
      if (t) return `[data-testid="${t}"]`;
      if (e.id) return `#${e.id}`;
      const parts: string[] = [];
      let n: Element | null = e;
      for (let i = 0; n && n !== document.body && i < 3; i++) {
        const p: Element | null = n.parentElement;
        const tag = n.tagName.toLowerCase();
        if (!p) {
          parts.unshift(tag);
          break;
        }
        const same = Array.from(p.children).filter((c) => c.tagName === n!.tagName);
        parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(n) + 1})` : tag);
        n = p;
      }
      return parts.join(' > ');
    };
    const list = Array.from(
      document.querySelectorAll(
        'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex],[contenteditable=""],[contenteditable="true"]'
      )
    ).filter((e) => !(e as HTMLInputElement).disabled && e.getAttribute('tabindex') !== '-1' && visible(e));
    const r = el.getBoundingClientRect();
    // Is the whole element hidden under something fixed or sticky? Needs >= 3 sample points in view.
    const inset = Math.max(0, Math.min(4, r.width / 4, r.height / 4));
    const points: Array<[number, number]> = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + inset, r.top + inset],
      [r.right - inset, r.top + inset],
      [r.left + inset, r.bottom - inset],
      [r.right - inset, r.bottom - inset],
    ];
    const inView = points.filter(([x, y]) => x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight);
    const pinned = (e: Element | null) => {
      for (let n = e; n; n = n.parentElement) {
        const pos = getComputedStyle(n).position;
        if (pos === 'fixed' || pos === 'sticky') return true;
      }
      return false;
    };
    const obscured =
      inView.length >= 3 &&
      inView.every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && hit !== el && !el.contains(hit) && !hit.contains(el) && pinned(hit);
      });
    return {
      idx: list.indexOf(el),
      selector: sel(el),
      tag: el.tagName.toLowerCase(),
      testId: el.getAttribute('data-testid') || undefined,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      obscured,
      focusableCount: list.length,
    };
  });
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as TabStop;
  return typeof s.idx === 'number' && typeof s.selector === 'string' ? s : null;
}

export class KeyboardA11yChecker {
  /** Press Tab repeatedly and note where focus lands. Presses only Tab. */
  async walkTabOrder(page: Page, opts: { maxPresses?: number } = {}): Promise<TabWalk> {
    const max = opts.maxPresses ?? 60;
    await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (a && a !== document.body) a.blur();
    });
    const stops: TabStop[] = [];
    let leftPage = false;
    let wrapped = false;
    let focusableCount = 0;
    for (let i = 0; i < max; i++) {
      await page.keyboard.press('Tab');
      const stop = await readStop(page);
      if (!stop) {
        leftPage = true;
        break;
      }
      focusableCount = stop.focusableCount;
      const first = stops[0];
      stops.push(stop);
      if (first && first.idx >= 0 && stop.idx === first.idx) {
        const distinct = new Set(stops.map((s) => s.idx)).size;
        if (distinct >= focusableCount - 1) {
          wrapped = true;
          break;
        }
      }
    }
    return { stops, leftPage, wrapped, focusableCount };
  }

  /** All keyboard checks on the current page. One Tab walk is shared by the checks that need it. */
  async checkKeyboard(page: Page, context: KeyboardA11yContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    try {
      findings.push(...(await this.checkKeyboardTraversal(page, context)));
      const walk = await this.walkTabOrder(page);
      findings.push(...(await this.checkFocusObscured(page, context, walk.stops)));
      findings.push(...(await this.checkFocusTrap(page, context, walk)));
    } catch {
      findings.push({
        ...this.finding('KEYBOARD-NOTRUN', 1, context, {
          title: 'Keyboard checks could not be completed',
          severity: 'Suggestion',
          expected: 'The keyboard checks can finish on this page',
          actual:
            'The page changed or closed during the checks, so keyboard use was not checked (automatic check only)',
          steps: [`Open ${context.urlPath}`, 'Press Tab through the page'],
          resolution: 'Try the keyboard by hand: Tab through the page and make sure every control can be reached.',
        }),
        needsConfirmation: true,
      });
    }
    return findings;
  }

  // --- S5: elements the Tab key cannot reach (WCAG 2.1.1) -----------------------------------

  async checkKeyboardTraversal(page: Page, context: KeyboardA11yContext): Promise<Finding[]> {
    const raw: unknown = await page.evaluate(() => {
      const NATIVE =
        'a[href],button,input:not([type=hidden]),select,textarea,summary,iframe,[contenteditable=""],[contenteditable="true"],audio[controls],video[controls]';
      const ROLES = 'button|link|tab|menuitem|checkbox|switch';
      const roleSel = ROLES.split('|')
        .map((r) => `[role="${r}"]`)
        .join(',');
      const COMPOSITE =
        '[role=tablist],[role=menu],[role=menubar],[role=listbox],[role=radiogroup],[role=toolbar],[role=tree],[role=grid]';
      const sel = (e: Element): string => {
        const t = e.getAttribute('data-testid');
        if (t) return `[data-testid="${t}"]`;
        if (e.id) return `#${e.id}`;
        const parts: string[] = [];
        let n: Element | null = e;
        for (let i = 0; n && n !== document.body && i < 3; i++) {
          const p: Element | null = n.parentElement;
          const tag = n.tagName.toLowerCase();
          if (!p) {
            parts.unshift(tag);
            break;
          }
          const same = Array.from(p.children).filter((c) => c.tagName === n!.tagName);
          parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(n) + 1})` : tag);
          n = p;
        }
        return parts.join(' > ');
      };
      const out: Array<{ selector: string; tag: string; role: string | null; onclickOnly: boolean }> = [];
      for (const el of Array.from(document.querySelectorAll(`${roleSel},[onclick]`))) {
        if (el.matches(NATIVE) || el.closest('a[href],button')) continue;
        const ti = el.getAttribute('tabindex');
        if (ti !== null && Number(ti) >= 0) continue;
        if (ti === '-1' && el.parentElement?.closest(COMPOSITE)) continue;
        if (el.closest('[aria-hidden="true"],[inert]')) continue;
        if (el.matches('[disabled],[aria-disabled="true"]')) continue;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width <= 0 || r.height <= 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (el.querySelector('a[href],button,input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])'))
          continue;
        const hasRole = el.matches(roleSel);
        out.push({
          selector: sel(el),
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role'),
          onclickOnly: !hasRole,
        });
        if (out.length >= 5) break;
      }
      return out;
    });
    if (!Array.isArray(raw)) return [];
    const crit = wcagCriteria(['wcag211'])[0];
    const findings: Finding[] = [];
    for (const r of raw.slice(0, CAP) as Array<{
      selector: string;
      tag: string;
      role: string | null;
      onclickOnly: boolean;
    }>) {
      if (!r || typeof r.selector !== 'string') continue;
      const confirm = r.onclickOnly;
      findings.push({
        ...this.finding('TAB', findings.length + 1, context, {
          title: confirm
            ? 'Element with a click handler may not be reachable with the Tab key'
            : 'Element that works like a control cannot be reached with the Tab key',
          severity: 'Minor',
          expected: `Every control can be reached with the keyboard (${crit})`,
          actual: confirm
            ? `${r.selector} reacts to clicks but is not a link, button or form field and has no tabindex. It does not meet ${crit} unless it can be used another way (automatic check only)`
            : `${r.selector} has role="${r.role}" but no tabindex, so Tab skips it. It does not meet ${crit} (automatic check only)`,
          steps: [`Open ${context.urlPath}`, 'Press Tab through the page', `Look for ${r.selector}`],
          resolution: confirm
            ? 'Use a real button or link, or add tabindex="0" and key handling for Enter and Space.'
            : 'Use a real button or link, or add tabindex="0" plus keyboard handling for Enter and Space.',
          cssSelector: r.selector,
        }),
        ...(confirm ? { needsConfirmation: true } : {}),
      });
    }
    return findings;
  }

  // --- S6: focus hidden under fixed content (WCAG 2.4.11) ------------------------------------

  async checkFocusObscured(page: Page, context: KeyboardA11yContext, stops?: TabStop[]): Promise<Finding[]> {
    const list = stops ?? (await this.walkTabOrder(page)).stops;
    const crit = wcagCriteria(['wcag2411'])[0];
    const seen = new Set<string>();
    const findings: Finding[] = [];
    for (const s of list) {
      if (!s.obscured || seen.has(s.selector)) continue;
      seen.add(s.selector);
      findings.push(
        this.finding('FOCUS-OBSCURED', findings.length + 1, context, {
          title: 'Focused element is completely hidden under fixed content',
          severity: 'Minor',
          expected: `A focused element is not entirely hidden by sticky or fixed content (${crit})`,
          actual: `When Tab reached ${s.selector}, fixed or sticky content covered all of it. It does not meet ${crit} (automatic check only)`,
          steps: [
            `Open ${context.urlPath}`,
            'Press Tab until focus reaches the element',
            'Check that the focused element is visible',
          ],
          resolution: 'Add scroll-padding (or scroll-margin) equal to the height of the fixed header or footer.',
          cssSelector: s.selector,
        })
      );
      if (findings.length >= CAP) break;
    }
    return findings;
  }

  // --- S7: focus trap (WCAG 2.1.2) -----------------------------------------------------------

  async checkFocusTrap(page: Page, context: KeyboardA11yContext, walk?: TabWalk): Promise<Finding[]> {
    const w = walk ?? (await this.walkTabOrder(page));
    if (w.leftPage || w.wrapped) return [];
    const { trapped, cycle } = detectTrap(w.stops, w.focusableCount);
    if (!trapped) return [];
    const cycleStops = w.stops.slice(-TRAP_WINDOW).filter((s) => cycle.includes(s.idx));
    const selectors = [...new Set(cycleStops.map((s) => s.selector))];

    // A dialog that holds focus on purpose is not a trap.
    const inDialog: unknown = await page.evaluate((sels: string[]) => {
      return sels.some((s) => {
        try {
          return !!document
            .querySelector(s)
            ?.closest('dialog[open],[aria-modal="true"],[role="dialog"],[role="alertdialog"]');
        } catch {
          return false;
        }
      });
    }, selectors);
    if (inDialog === true) return [];

    // One Escape and one more Tab: if focus leaves the cycle, it was not stuck.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    const after = await readStop(page);
    if (!after || !cycle.includes(after.idx)) return [];

    const crit = wcagCriteria(['wcag212'])[0];
    return [
      this.finding('TRAP', 1, context, {
        title: 'Keyboard focus gets stuck in part of the page',
        severity: 'Major',
        expected: `Focus can move away from every element using the keyboard alone (${crit})`,
        actual: `Pressing Tab ${w.stops.length} times only cycled through ${cycle.length} elements (first: ${selectors[0]}) while ${w.focusableCount} exist, and Escape did not release it. It does not meet ${crit} (automatic check only)`,
        steps: [
          `Open ${context.urlPath}`,
          'Press Tab repeatedly',
          'Notice that focus never leaves the same few elements',
        ],
        resolution:
          'Let Tab move on past the last element, or move focus on a dialog close and return focus to the control that opened it.',
        cssSelector: selectors[0],
        allTargets: selectors.slice(0, 8),
      }),
    ];
  }

  // --- S8: reflow at 320 px (WCAG 1.4.10) ----------------------------------------------------

  async checkReflow(
    page: Page,
    context: KeyboardA11yContext & { restoreViewport: { width: number; height: number } }
  ): Promise<Finding[]> {
    try {
      await page.setViewportSize({ width: 320, height: 256 });
      await page.waitForTimeout(150);
      const raw: unknown = await page.evaluate(() => {
        const scrollWidth = document.documentElement.scrollWidth;
        if (scrollWidth <= 321) return null;
        const EXEMPT = 'table,pre,code,img,svg,canvas,video,iframe,map';
        const sel = (e: Element): string => {
          const t = e.getAttribute('data-testid');
          if (t) return `[data-testid="${t}"]`;
          if (e.id) return `#${e.id}`;
          const parts: string[] = [];
          let n: Element | null = e;
          for (let i = 0; n && n !== document.body && i < 3; i++) {
            const p: Element | null = n.parentElement;
            const tag = n.tagName.toLowerCase();
            if (!p) {
              parts.unshift(tag);
              break;
            }
            const same = Array.from(p.children).filter((c) => c.tagName === n!.tagName);
            parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(n) + 1})` : tag);
            n = p;
          }
          return parts.join(' > ');
        };
        const scrolls = (e: Element | null) => {
          for (let n = e; n && n !== document.body; n = n.parentElement) {
            const ox = getComputedStyle(n).overflowX;
            if (ox === 'auto' || ox === 'scroll') return true;
          }
          return false;
        };
        const all = Array.from(document.body.querySelectorAll('*')).slice(0, 4000);
        for (const el of all) {
          if (el.closest(EXEMPT)) continue;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0 || r.right <= 321) continue;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          if (scrolls(el.parentElement) || scrolls(el)) continue;
          return { scrollWidth, selector: sel(el) };
        }
        return null;
      });
      if (!raw || typeof raw !== 'object') return [];
      const r = raw as { scrollWidth: number; selector: string };
      const crit = wcagCriteria(['wcag1410'])[0];
      return [
        this.finding('REFLOW', 1, context, {
          title: 'Page needs sideways scrolling at 320 px wide',
          severity: 'Minor',
          expected: `Content fits a 320 px wide window without scrolling sideways (${crit})`,
          actual: `At 320 px the page is ${r.scrollWidth} px wide; ${r.selector} reaches past the edge. It does not meet ${crit} (automatic check only)`,
          steps: [
            `Open ${context.urlPath}`,
            'Make the window 320 px wide (or zoom a 1280 px window to 400%)',
            'Look for sideways scrolling',
          ],
          resolution:
            'Let wide elements shrink or wrap (max-width: 100%, flexible grids). Wide tables may scroll inside their own box.',
          cssSelector: r.selector,
        }),
      ];
    } catch {
      return [
        {
          ...this.finding('REFLOW-NOTRUN', 1, context, {
            title: 'Reflow check could not be completed',
            severity: 'Suggestion',
            expected: 'The page can be checked at 320 px wide',
            actual:
              'The page changed or closed during the check, so narrow-window use was not checked (automatic check only)',
            steps: [`Open ${context.urlPath}`, 'Make the window 320 px wide'],
            resolution: 'Look at the page in a 320 px wide window by hand.',
          }),
          needsConfirmation: true,
        },
      ];
    } finally {
      await page.setViewportSize(context.restoreViewport).catch(() => {});
    }
  }

  private finding(
    kind: string,
    n: number,
    context: KeyboardA11yContext,
    detail: {
      title: string;
      severity: FindingSeverity;
      expected: string;
      actual: string;
      steps: string[];
      resolution: string;
      cssSelector?: string;
      allTargets?: string[];
    }
  ): Finding {
    return {
      id: `F-A11Y-${kind}-${context.testCaseId || 'GEN'}-${n}`,
      testCaseId: context.testCaseId,
      flowId: context.flowId,
      severity: detail.severity,
      checker: 'ux-quality',
      title: detail.title,
      where: {
        urlPath: context.urlPath,
        role: context.role,
        breakpoint: context.breakpoint,
        ...(detail.cssSelector ? { cssSelector: detail.cssSelector } : {}),
      },
      expectedVsActual: { expected: detail.expected, actual: detail.actual },
      stepsToReproduce: detail.steps,
      evidence: detail.allTargets ? { allTargets: detail.allTargets } : {},
      resolution: detail.resolution,
    };
  }
}
