import type { StorageStateData } from '@qa/types/src/evidence-finding.js';

/** A saved session file is small; anything larger is not one. */
export const MAX_SESSION_BYTES = 256 * 1024;

export type SessionFileResult = { ok: true; state: StorageStateData } | { ok: false; message: string };

/**
 * Checks a Playwright saved-session file (cookies and local storage) before it is sent.
 * The body is returned to the caller's React state only; it is never stored, logged or echoed in
 * a message here.
 */
export function parseSessionFile(name: string, sizeBytes: number, text: string): SessionFileResult {
  const shape = `“${name}” doesn’t look like a saved session. It should hold “cookies” and “origins” lists.`;
  if (sizeBytes > MAX_SESSION_BYTES) {
    return { ok: false, message: `“${name}” is larger than 256 KB, so it is not a saved session file.` };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      ok: false,
      message: `“${name}” isn’t a saved session file. It must be the JSON file saved from a signed-in browser.`,
    };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, message: shape };
  const { cookies, origins } = data as { cookies?: unknown; origins?: unknown };
  if (!Array.isArray(cookies) || !Array.isArray(origins)) return { ok: false, message: shape };
  const badCookie = cookies.some(
    (c) =>
      !c ||
      typeof c !== 'object' ||
      typeof (c as { name?: unknown }).name !== 'string' ||
      typeof (c as { domain?: unknown }).domain !== 'string'
  );
  if (badCookie) {
    return { ok: false, message: `“${name}” has a cookie without a name or site, so it can’t be used.` };
  }
  return { ok: true, state: { cookies, origins } };
}
