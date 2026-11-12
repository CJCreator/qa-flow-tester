/**
 * Single-key shortcuts (WCAG 2.1.4 Character Key Shortcuts): j, k, g and G on the plan, and ? for the shortcuts list.
 * They never fire while someone types in a form control, and the person can switch them off (saved in localStorage, on by default).
 */

export const SINGLE_KEY_SHORTCUTS = ['j', 'k', 'g', 'G'] as const;

/** An open dialog of either kind: a native <dialog> opened with showModal (ConfirmDialog) or role="dialog" (the palette). */
export const OPEN_DIALOG_SELECTOR = 'dialog[open], [role="dialog"]';

const STORAGE_KEY = 'qa-single-key-shortcuts';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** On unless the person switched it off. Storage that is blocked or unreadable counts as on. */
export function readSingleKeyShortcuts(storage: Pick<Store, 'getItem'> | undefined = defaultStore()): boolean {
  try {
    return storage?.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Saves the choice. If storage is blocked the choice lasts until the page is closed. */
export function writeSingleKeyShortcuts(
  on: boolean,
  storage: Pick<Store, 'setItem'> | undefined = defaultStore()
): void {
  try {
    storage?.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked: nothing to save.
  }
}

export function isSingleKeyShortcut(key: string): boolean {
  return (SINGLE_KEY_SHORTCUTS as readonly string[]).includes(key);
}

/** The part of an element that decides whether a key is typed into it. */
export interface FocusLike {
  tagName: string;
  getAttribute(name: string): string | null;
  isContentEditable?: boolean;
}

const TEXT_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);

/** True when the focused element takes typed characters: input, textarea, select, contenteditable, or a text-entry ARIA role. */
export function isTypingTarget(el: FocusLike | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  const editable = el.getAttribute('contenteditable');
  if (editable !== null && editable !== 'false') return true;
  const role = el.getAttribute('role');
  return role !== null && TEXT_ROLES.has(role);
}

/** True when `?` should open the shortcuts list: no modifier, not typing, and single-key shortcuts are on. */
export function opensShortcutList(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  active: FocusLike | null,
  enabled: boolean = readSingleKeyShortcuts()
): boolean {
  return e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && enabled && !isTypingTarget(active);
}
