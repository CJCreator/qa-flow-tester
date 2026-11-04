/**
 * Is the caller a signed-in Helper (ADR 0037)? `GET /api/runner/status` answers `helper: true` for a Helper
 * without the access key. Kept apart from helper-api.ts so the owner's screens can ask without importing the
 * Helper screens' module; helper-api.ts re-exports it. Any failure answers false: the owner screens then show
 * every action and the runner still refuses what a Helper may not do.
 */

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function loadCallerIsHelper(fetchImpl: Fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl('/api/runner/status', { credentials: 'same-origin' });
    if (!res.ok) return false;
    const body: unknown = await res.json();
    return typeof body === 'object' && body !== null && (body as { helper?: unknown }).helper === true;
  } catch {
    return false;
  }
}
