/** A screen's code file can be gone after a deploy. The page reloads once to fetch the new files. */

const KEY = 'qa-chunk-reload-at';
/** A second failure this soon after a reload means reloading does not help: stop, so the page never loops. */
const MIN_GAP_MS = 60_000;

interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** True when a reload is worth trying now; records the time so the next call inside a minute says no. */
export function shouldReloadForChunk(store: Store, now: number): boolean {
  const last = Number(store.getItem(KEY));
  if (Number.isFinite(last) && last > 0 && now - last < MIN_GAP_MS) return false;
  store.setItem(KEY, String(now));
  return true;
}

/** Reloads the page when Vite reports that a code file could not be loaded. */
export function reloadOnMissingChunk(win: Window = window): void {
  win.addEventListener('vite:preloadError', (event) => {
    let store: Store;
    try {
      store = win.sessionStorage;
    } catch {
      return; // Storage is blocked: without it a loop cannot be ruled out, so do nothing.
    }
    if (!shouldReloadForChunk(store, Date.now())) return;
    event.preventDefault(); // The reload handles it: the import error is not thrown as well.
    win.location.reload();
  });
}
