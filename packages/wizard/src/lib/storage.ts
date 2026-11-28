/**
 * Safe reads and writes of the browser's localStorage and sessionStorage. Storage can be missing or blocked
 * (private mode, embedded frames), so a failed read gives nothing and a failed write is ignored.
 */
type Kind = 'local' | 'session';

function store(kind: Kind): Storage | undefined {
  try {
    return kind === 'local' ? localStorage : sessionStorage;
  } catch {
    return undefined;
  }
}

/** The saved text, or null when there is none or storage is unavailable. */
export function readStored(kind: Kind, key: string): string | null {
  try {
    return store(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** The saved JSON value, or undefined when there is none, it is unreadable, or storage is unavailable. */
export function readStoredJson<T>(kind: Kind, key: string): T | undefined {
  const saved = readStored(kind, key);
  if (!saved) return undefined;
  try {
    return JSON.parse(saved) as T;
  } catch {
    return undefined;
  }
}

/** Saves text. Blocked or full storage means the choice just is not remembered. */
export function writeStored(kind: Kind, key: string, value: string): void {
  try {
    store(kind)?.setItem(key, value);
  } catch {
    /* not remembered */
  }
}
