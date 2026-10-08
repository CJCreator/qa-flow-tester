import type { RunSummary } from '@qa/types';
import { DEFAULT_MAX_PAGES, type CheckupForm } from './form';

/**
 * True when the person has changed anything that lives under "More options" on the new check-up
 * screen, so it opens by itself and nothing they set is hidden from them.
 */
export function hasNonDefaultOptions(form: CheckupForm): boolean {
  return (
    form.maxPages !== DEFAULT_MAX_PAGES ||
    form.signIns.some((s) => s.username.trim() !== '' || s.password !== '') ||
    form.specs.trim() !== '' ||
    form.designNotes.trim() !== '' ||
    form.journeys.trim() !== '' ||
    form.searchChecks !== null ||
    (form.visibility ?? null) !== null
  );
}

/** Command palette and shortcut buttons are for people who have already done a check-up. */
export function hasFinishedCheckup(recent: RunSummary[] | null | undefined): boolean {
  return Array.isArray(recent) && recent.length > 0;
}
