import type { SiteFacts } from '../api';

/** Pages a scan explores unless the person asks for another number. */
export const DEFAULT_MAX_PAGES = 200;

/**
 * What the new check-up screen holds. It lives in App, so moving between screens (to Settings, to
 * the plan and back) never loses what was typed.
 */
export interface CheckupForm {
  address: string;
  owner: boolean;
  /** The person says this live-looking address is a test copy of their site. */
  markedTestCopy: boolean;
  specs: string;
  designNotes: string;
  journeys: string;
  maxPages: number;
  /** What the address check said about the site, and for which address. */
  facts?: CheckedAddress;
}

/** An address after it was checked: the one actually used, whether it answered, and what's known about the site. */
export interface CheckedAddress extends SiteFacts {
  url: string;
  reachable: boolean;
  /** Why it couldn't be reached, and what to do. */
  problem?: { reason: string; suggestion: string };
}

export const emptyForm: CheckupForm = {
  address: '',
  owner: false,
  markedTestCopy: false,
  specs: '',
  designNotes: '',
  journeys: '',
  maxPages: DEFAULT_MAX_PAGES,
};

/**
 * The specs, design notes and journeys as one document for the AI that writes the plan. Each has
 * its own top-level heading, so the heading-based context parser keeps them apart. Undefined when
 * nothing was added.
 */
export function productContextOf(form: Pick<CheckupForm, 'specs' | 'designNotes' | 'journeys'>): string | undefined {
  const parts: string[] = [];
  if (form.specs.trim()) parts.push(`# Specs\n\n${form.specs.trim()}`);
  if (form.designNotes.trim()) parts.push(`# Design notes\n\n${form.designNotes.trim()}`);
  if (form.journeys.trim()) parts.push(`# Journeys to test\n\n${form.journeys.trim()}`);
  return parts.length > 0 ? `${parts.join('\n\n')}\n` : undefined;
}

/**
 * The specs, design notes and journeys back out of a document productContextOf wrote, e.g. the one
 * a past check-up was planned with. Anything else is all specs.
 */
export function materialsOf(productContext?: string): Pick<CheckupForm, 'specs' | 'designNotes' | 'journeys'> {
  const materials = { specs: '', designNotes: '', journeys: '' };
  if (!productContext?.trim()) return materials;
  const parts = productContext.split(/^# (Specs|Design notes|Journeys to test)[ \t]*$/m);
  if (parts.length === 1) return { ...materials, specs: productContext.trim() };
  const keys = { Specs: 'specs', 'Design notes': 'designNotes', 'Journeys to test': 'journeys' } as const;
  const add = (key: keyof typeof materials, text: string) => {
    if (text.trim()) materials[key] = materials[key] ? `${materials[key]}\n\n${text.trim()}` : text.trim();
  };
  add('specs', parts[0]);
  for (let i = 1; i < parts.length; i += 2) add(keys[parts[i] as keyof typeof keys], parts[i + 1] ?? '');
  return materials;
}

/**
 * The address can't be tested fully by itself (it isn't this computer, a private network or a
 * tunnel), so the person may say it's a test copy. A host marked before still offers the choice, so
 * it can be taken back.
 */
export function canMarkTestCopy(facts?: SiteFacts): boolean {
  return !facts?.testCopy || !!facts.remembered?.markedTestCopy;
}

/** Whether the check-up will fill in and send forms: the owner said so, and it's a test copy. */
export function fullTesting(form: Pick<CheckupForm, 'owner' | 'markedTestCopy' | 'facts'>): boolean {
  if (!form.owner || !form.facts) return false;
  return canMarkTestCopy(form.facts) ? form.markedTestCopy : !!form.facts.testCopy;
}
