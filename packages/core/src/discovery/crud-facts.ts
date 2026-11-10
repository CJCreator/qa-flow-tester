import type { Page } from 'playwright';
import type { PageInventoryItem } from '@qa/types';
import { guardPage } from './guard.js';

export type CrudFacts = NonNullable<PageInventoryItem['crud']>;

/** What the page's structure shows, before anything is clicked. */
export interface CrudStructure {
  /** Rows in a table or list that carry controls. */
  listRows: number;
  /** Names of controls outside any row or form (the Add control is among them). */
  addNames: string[];
  /** Names of the controls inside rows. */
  rowControlNames: string[];
}

const EDIT = /^(edit|modify|rename|update)\b/i;
/** A delete on one row; not "Delete account", "Delete all" and the like, which are never probed. */
const ROW_DELETE = /^(delete|remove|trash)(\s+(row|item|entry|record))?$/i;
const DELETE_ANY = /^(delete|remove|trash)\b/i;
const ADD = /^(add|new|create)\b/i;

export function isRowDeleteName(name: string): boolean {
  return ROW_DELETE.test(name.trim());
}

/** Facts about a list-and-edit page, from structure only. Undefined when the page is no list with Add/Edit/Delete. */
export function inferCrud(s: CrudStructure): CrudFacts | undefined {
  const add = s.addNames.find((n) => ADD.test(n.trim()));
  const editFromRow = s.rowControlNames.some((n) => EDIT.test(n.trim()));
  const hasDelete = s.rowControlNames.some((n) => DELETE_ANY.test(n.trim()));
  if (s.listRows < 1 || (!add && !editFromRow && !hasDelete)) return undefined;
  return { list: true, ...(add ? { add: add.trim() } : {}), ...(editFromRow ? { editFromRow: true } : {}) };
}

/** Whether a control's tag and href make it a link that navigates (never probed: a GET cannot be blocked). */
export function isNavigatingLink(tagName: string, href: string | null | undefined): boolean {
  if (tagName.toUpperCase() !== 'A') return false;
  const value = (href || '').trim();
  return value !== '' && !value.startsWith('#') && !/^javascript:/i.test(value);
}

/** Reads the page's list rows and controls. Marks the first single-row delete control so it can be found. */
export async function readCrudStructure(
  page: Page
): Promise<(CrudStructure & { hasProbeTarget: boolean }) | undefined> {
  return page
    .evaluate(
      ({ rowDelete }) => {
        const clean = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        const visible = (el: Element) =>
          el.getClientRects().length > 0 && el.checkVisibility({ checkVisibilityCSS: true });
        const nameOf = (el: Element) =>
          clean(el.getAttribute('aria-label')) || clean(el.textContent) || clean(el.getAttribute('title'));
        const controlsIn = (root: Element) =>
          Array.from(root.querySelectorAll('button, [role="button"], a')).filter(
            (c) => visible(c) && !c.closest('form')
          );
        document.querySelectorAll('[data-qa-delete-probe]').forEach((e) => e.removeAttribute('data-qa-delete-probe'));
        const tableRows = Array.from(document.querySelectorAll('tr')).filter(
          (r) => r.querySelector('td') && visible(r)
        );
        const listRows = Array.from(document.querySelectorAll('ul > li, ol > li')).filter(
          (r) =>
            visible(r) &&
            controlsIn(r).some((c) => /^(edit|modify|rename|update|delete|remove|trash)\b/i.test(nameOf(c)))
        );
        const rows = [...tableRows, ...listRows];
        const rowControlNames: string[] = [];
        let marked = false;
        // Same rule as isNavigatingLink. A link that goes somewhere is a GET the change-blocker cannot stop: never probe it.
        const goesSomewhere = (el: Element) => {
          if (el.tagName !== 'A') return false;
          const href = (el.getAttribute('href') || '').trim();
          return href !== '' && !href.startsWith('#') && !/^javascript:/i.test(href);
        };
        const re = new RegExp(rowDelete, 'i');
        for (const row of rows) {
          for (const c of controlsIn(row)) {
            const n = nameOf(c);
            if (!n) continue;
            rowControlNames.push(n);
            if (!marked && !goesSomewhere(c) && re.test(n)) {
              c.setAttribute('data-qa-delete-probe', '1');
              marked = true;
            }
          }
        }
        const addNames = Array.from(document.querySelectorAll('button, [role="button"], a'))
          .filter((c) => visible(c) && !c.closest('form') && !rows.some((r) => r.contains(c)))
          .map(nameOf)
          .filter(Boolean);
        return { listRows: rows.length, addNames, rowControlNames, hasProbeTarget: marked };
      },
      { rowDelete: ROW_DELETE.source }
    )
    .catch(() => undefined);
}

/**
 * Asks to delete the marked row and cancels at the confirm (ADR 0025). Requests that change things are
 * aborted and dialogs dismissed, so nothing is deleted even if the app has no confirm.
 * True: a confirm appeared. False: none did. Undefined: the control could not be clicked.
 */
export async function probeDeleteConfirm(page: Page): Promise<boolean | undefined> {
  const guard = await guardPage(page);
  try {
    await page.locator('[data-qa-delete-probe]').first().click({ timeout: 3000 });
    await page.waitForTimeout(500);
    if (guard.dialogs.length > 0) return true;
    const custom = page.locator('[role="alertdialog"]:visible, dialog[open]:visible').first();
    if ((await custom.count()) > 0) {
      const cancel = custom.getByRole('button', { name: /cancel|no\b|keep|close|back/i }).first();
      if ((await cancel.count()) > 0) await cancel.click({ timeout: 2000 }).catch(() => undefined);
      return true;
    }
    return false;
  } catch {
    return undefined;
  } finally {
    await guard.release();
  }
}
