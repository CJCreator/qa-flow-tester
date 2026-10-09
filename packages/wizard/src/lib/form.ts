import type { RunCap } from '@qa/types';
import type { StorageStateData } from '@qa/types/src/evidence-finding.js';
import { capFromInputs } from './cap';
import { toContextDocuments, type ReferenceFile } from './context';

/**
 * What the person types on the new check-up screen. It lives in App, above every screen, so going
 * to Settings, adding the AI key or looking at a past report never loses it.
 */
export interface CheckupForm {
  address: string;
  /** The person owns the site, or may test it. */
  owner: boolean;
  /** The person says this live-looking address is a test copy. */
  markedTestCopy: boolean;
  /**
   * The site the choices were made for, by the person or from what was remembered. A different
   * site starts from what was remembered for it.
   */
  choicesFor: string | null;
  specs: string;
  designNotes: string;
  journeys: string;
  maxPages: number;
  /** Sign-ins to explore and test the signed-in pages with. Passwords stay in memory only, unless remembered. */
  signIns: SignInEntry[];
  /** Remember the sign-ins for this site (passwords in this computer's keychain). */
  rememberSignIns: boolean;
  /** Sign in with the ones saved for this site. */
  useSavedSignIns: boolean;
  /** Check how search engines see the site; null: the usual (a live site yes, a test copy no). */
  searchChecks: boolean | null;
  /** Granular 4-lens visibility choices: search, answers, aiSearch, marketing. */
  visibility?: VisibilityChoice | null;
  /** Plan with fixed rules now, spending no AI requests; re-plan with the AI later. */
  planWithoutAI: boolean;
  /** Product Context files (.md / .txt), each kept as its own document. */
  contextFiles: ReferenceFile[];
  /** A docs address; same-site pages are read. */
  contextUrl: string;
  /** Saved sessions per role. In memory only; cleared as soon as the check-up starts. */
  savedSessions: SavedSessionEntry[];
  /** Optional cap on AI requests, as typed. */
  capRequests: string;
  /** Optional cap on dollars, as typed (only offered when the provider reports a price). */
  capDollars: string;
}

export interface SavedSessionEntry {
  role: string;
  /** Shown instead of the contents. */
  fileName: string;
  state: StorageStateData;
}

export interface VisibilityChoice {
  search: boolean;
  answers: boolean;
  aiSearch: boolean;
  marketing: boolean;
}

export const DEFAULT_VISIBILITY: VisibilityChoice = {
  search: true,
  answers: true,
  aiSearch: true,
  marketing: true,
};

export interface SignInEntry {
  role: string;
  username: string;
  password: string;
  loginPath: string;
}

/** Pages a scan explores unless the person asks for another number. */
export const DEFAULT_MAX_PAGES = 200;
export const MAX_PAGES_LIMIT = 1000;

/** The page limit as typed, kept between 1 and 1000; anything that isn't a number keeps the default. */
export function clampMaxPages(typed: string): number {
  const n = Math.floor(Number(typed));
  return Number.isFinite(n) && typed.trim() !== '' ? Math.min(MAX_PAGES_LIMIT, Math.max(1, n)) : DEFAULT_MAX_PAGES;
}

export const EMPTY_SIGN_IN: SignInEntry = { role: '', username: '', password: '', loginPath: '' };

export const EMPTY_FORM: CheckupForm = {
  address: '',
  owner: false,
  markedTestCopy: false,
  choicesFor: null,
  specs: '',
  designNotes: '',
  journeys: '',
  maxPages: DEFAULT_MAX_PAGES,
  signIns: [],
  rememberSignIns: true,
  useSavedSignIns: true,
  searchChecks: null,
  visibility: null,
  planWithoutAI: false,
  contextFiles: [],
  contextUrl: '',
  savedSessions: [],
  capRequests: '',
  capDollars: '',
};

/** The Product Context files as the run body takes them; undefined when none were added. */
export function contextDocumentsOf(form: Pick<CheckupForm, 'contextFiles'>) {
  const docs = toContextDocuments(form.contextFiles);
  return docs.length > 0 ? docs : undefined;
}

/** The docs address, trimmed; undefined when empty. */
export function contextUrlOf(form: Pick<CheckupForm, 'contextUrl'>): string | undefined {
  return form.contextUrl.trim() || undefined;
}

/** The saved sessions keyed by role (a role name is made up when none was given); undefined when none. */
export function savedSessionsOf(form: Pick<CheckupForm, 'savedSessions'>): Record<string, StorageStateData> | undefined {
  if (form.savedSessions.length === 0) return undefined;
  const sessions: Record<string, StorageStateData> = {};
  form.savedSessions.forEach((s, i) => {
    sessions[s.role.trim().toLowerCase() || (i === 0 ? 'member' : `member-${i + 1}`)] = s.state;
  });
  return sessions;
}

/** The cap the person typed, or undefined. */
export function capOf(form: Pick<CheckupForm, 'capRequests' | 'capDollars'>): RunCap | undefined {
  return capFromInputs(form.capRequests, form.capDollars);
}

/** The sign-ins filled in, as the runner takes them: a role name is made up when none was given. */
export function rolesOf(
  form: Pick<CheckupForm, 'signIns'>
): Array<{ role: string; username: string; password: string; loginPath?: string }> {
  return form.signIns
    .filter((s) => s.username.trim() && s.password)
    .map((s, i) => ({
      role: s.role.trim().toLowerCase() || (i === 0 ? 'member' : `member-${i + 1}`),
      username: s.username.trim(),
      password: s.password,
      loginPath: s.loginPath.trim() || undefined,
    }));
}

/**
 * The Product Context the AI plans with: the specs, design notes and journeys, each under its own
 * top-level heading so the context parser keeps them apart. Undefined when nothing was added.
 */
export function productContextOf(form: Pick<CheckupForm, 'specs' | 'designNotes' | 'journeys'>): string | undefined {
  const sections: string[] = [];
  if (form.specs.trim()) sections.push(`# Specs\n\n${form.specs.trim()}`);
  if (form.designNotes.trim()) sections.push(`# Design notes\n\n${form.designNotes.trim()}`);
  if (form.journeys.trim()) sections.push(`# Journeys to test\n\n${form.journeys.trim()}`);
  return sections.length > 0 ? sections.join('\n\n---\n\n') : undefined;
}

/** The address a visitor typed on the landing page (/check?url=...), or '' when there isn't one. Only the address is read. */
export function addressFromSearch(search: string): string {
  const typed = new URLSearchParams(search).get('url')?.trim() ?? '';
  return typed.length > 0 && typed.length <= 2048 ? typed : '';
}
