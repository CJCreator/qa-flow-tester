/**
 * The colour theme of every page. Light is the default look; "system" follows the device, and a
 * saved choice of light or dark wins over the device (DESIGN.md, Theming).
 */
export type Theme = 'system' | 'light' | 'dark';

export const THEME_KEY = 'qa-theme';

/** Anything but 'light' or 'dark' follows the device, so a missing or damaged value never breaks the page. */
export function parseTheme(raw: string | null | undefined): Theme {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

/** Whether the device asks for dark. False where it can't be read. */
export function prefersDark(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** What the page actually shows for a theme. */
export function effectiveTheme(theme: Theme, dark: boolean = prefersDark()): 'light' | 'dark' {
  return theme === 'system' ? (dark ? 'dark' : 'light') : theme;
}

/** A toggle flips what is on screen, and that becomes the saved choice. */
export function toggled(theme: Theme, dark: boolean = prefersDark()): Theme {
  return effectiveTheme(theme, dark) === 'dark' ? 'light' : 'dark';
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readTheme(storage: Pick<Storage, 'getItem'> | undefined = defaultStorage()): Theme {
  try {
    return parseTheme(storage?.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

export function saveTheme(theme: Theme, storage: Pick<Storage, 'setItem'> | undefined = defaultStorage()): void {
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch {
    /* private mode or blocked storage: the choice just is not remembered */
  }
}

/** "system" leaves the choice to the stylesheet's prefers-color-scheme rule. */
export function applyTheme(theme: Theme, root: Pick<Element, 'setAttribute' | 'removeAttribute'>): void {
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
