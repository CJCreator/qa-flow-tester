/** The landing page's colour theme. Dark is the default; the app's working screens are always dark. */
export type Theme = 'dark' | 'light';

export const THEME_KEY = 'qa-theme';

/** Anything but 'light' is dark, so a missing or damaged value never breaks the page. */
export function parseTheme(raw: string | null | undefined): Theme {
  return raw === 'light' ? 'light' : 'dark';
}

export function toggled(theme: Theme): Theme {
  return theme === 'light' ? 'dark' : 'light';
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
    return 'dark';
  }
}

export function saveTheme(theme: Theme, storage: Pick<Storage, 'setItem'> | undefined = defaultStorage()): void {
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch {
    /* private mode or blocked storage: the choice just is not remembered */
  }
}

export function applyTheme(theme: Theme, root: Pick<Element, 'setAttribute' | 'removeAttribute'>): void {
  if (theme === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
}
