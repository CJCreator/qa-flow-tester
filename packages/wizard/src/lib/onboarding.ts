import type { RunSummary } from '@qa/types';

/** Command palette and shortcut buttons are for people who have already done a check-up. */
export function hasFinishedCheckup(recent: RunSummary[] | null | undefined): boolean {
  return Array.isArray(recent) && recent.length > 0;
}
