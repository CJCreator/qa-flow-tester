/**
 * The check-up to move focus to once one is deleted: the next row of the same site, else the row before it.
 * `null` when the site has no other check-up left, so focus goes to the page heading instead.
 */
export function neighbourAfterDelete(list: Array<{ runId: string; host: string }>, runId: string): string | null {
  const target = list.find((r) => r.runId === runId);
  if (!target) return null;
  const ofSite = list.filter((r) => r.host === target.host);
  const index = ofSite.findIndex((r) => r.runId === runId);
  return ofSite[index + 1]?.runId ?? ofSite[index - 1]?.runId ?? null;
}
