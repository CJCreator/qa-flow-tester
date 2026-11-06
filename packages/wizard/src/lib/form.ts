import type { RoleCredential, RunCap } from '@qa/types';
import { parseHeaderText, type StorageStateData } from '@qa/types/src/browser.js';
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
  /** The person ticked or unticked remember themselves; with consent the keychain is used only if ticked. */
  rememberTouched: boolean;
  /** The person accepted that the check-up fills in and sends forms with the typed sign-in details. */
  signInConsent: boolean;
  /** With consent, show the plan for review before testing starts (otherwise testing starts at once). */
  reviewFirst: boolean;
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
  /** Optional Test cap, as typed (blank: the default). */
  testCap: string;
  /** Crawl concurrency (1 to 5, default 2). */
  crawlConcurrency: number;
  /** Per-page pacing delay in ms (0-2000, default 100ms). */
  crawlDelayMs: number;
  /** Custom headers string e.g. "X-QA-Bypass-Token: secret". */
  customHeaders: string;
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
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
}

/** Pages a scan explores unless the person asks for another number. */
export const DEFAULT_MAX_PAGES = 200;
export const MAX_PAGES_LIMIT = 1000;

/** The page limit as typed, kept between 1 and 1000; anything that isn't a number keeps the default. */
export function clampMaxPages(typed: string): number {
  const n = Math.floor(Number(typed));
  return Number.isFinite(n) && typed.trim() !== '' ? Math.min(MAX_PAGES_LIMIT, Math.max(1, n)) : DEFAULT_MAX_PAGES;
}

/** The value a submit must use: the typed page limit clamped, and whether it differs from the stored one. */
export function committedMaxPages(typed: string, stored: number): { value: number; changed: boolean } {
  const value = clampMaxPages(typed);
  return { value, changed: value !== stored };
}

export const EMPTY_SIGN_IN: SignInEntry = {
  role: '',
  username: '',
  password: '',
  loginPath: '',
};

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
  rememberTouched: false,
  useSavedSignIns: true,
  signInConsent: false,
  reviewFirst: true,
  searchChecks: null,
  visibility: null,
  planWithoutAI: false,
  contextFiles: [],
  contextUrl: '',
  savedSessions: [],
  capRequests: '',
  capDollars: '',
  testCap: '',
  crawlConcurrency: 2,
  crawlDelayMs: 100,
  customHeaders: '',
};

/** Parses multi-line "Header: Value" text into a Record<string, string>. */
export function parseCustomHeaders(headersText: string): Record<string, string> | undefined {
  if (!headersText || !headersText.trim()) return undefined;
  const { headers, errors } = parseHeaderText(headersText);
  if (errors.length > 0) return undefined;
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/** Returns validation error messages for the custom headers text, with line numbers and never echoing values. */
export function headerErrorsOf(form: Pick<CheckupForm, 'customHeaders'>): string[] {
  if (!form.customHeaders || !form.customHeaders.trim()) return [];
  return parseHeaderText(form.customHeaders).errors;
}

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
export function savedSessionsOf(
  form: Pick<CheckupForm, 'savedSessions'>
): Record<string, StorageStateData> | undefined {
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

/** The Test cap as typed: a whole number from 1 to 100000, or nothing (the default applies). */
export function testCapOf(form: Pick<CheckupForm, 'testCap'>): number | undefined {
  const typed = form.testCap.trim();
  if (typed === '') return undefined;
  const n = Math.floor(Number(typed));
  return Number.isFinite(n) && n >= 1 ? Math.min(100000, n) : undefined;
}

/** The sign-ins filled in, as the runner takes them: a role name is made up when none was given. */
export function rolesOf(form: Pick<CheckupForm, 'signIns'>): RoleCredential[] {
  return form.signIns
    .filter((s) => s.username.trim() && s.password)
    .map((s, i) => {
      const entry: RoleCredential = {
        role: s.role.trim().toLowerCase() || (i === 0 ? 'member' : `member-${i + 1}`),
        username: s.username.trim(),
        password: s.password,
      };
      if (s.loginPath && s.loginPath.trim()) entry.loginPath = s.loginPath.trim();
      if (s.usernameSelector && s.usernameSelector.trim()) entry.usernameSelector = s.usernameSelector.trim();
      if (s.passwordSelector && s.passwordSelector.trim()) entry.passwordSelector = s.passwordSelector.trim();
      if (s.submitSelector && s.submitSelector.trim()) entry.submitSelector = s.submitSelector.trim();
      return entry;
    });
}

/**
 * Hint shown when sign-in details are typed but consent is unticked, blocking start.
 * Undefined when details are missing or consent is given.
 */
export function scanBlockedHint(form: Pick<CheckupForm, 'signIns' | 'signInConsent'>): string | undefined {
  if (hasSignInDetails(form) && !form.signInConsent) {
    return "Tick 'I accept this' to scan with sign-in";
  }
  return undefined;
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

/** The first sign-in as the address-step fields show it (role `member` unless named). */
export function primarySignInOf(form: Pick<CheckupForm, 'signIns'>): SignInEntry {
  return form.signIns[0] ?? EMPTY_SIGN_IN;
}

/** The first sign-in (the quick fields under the address) has both username and password. Only it triggers the consent notice. */
export function hasSignInDetails(form: Pick<CheckupForm, 'signIns'>): boolean {
  const first = form.signIns[0];
  return !!first && !!first.username.trim() && !!first.password;
}

/** Consent counts only while the details are still there. */
export function signInConsentGiven(form: Pick<CheckupForm, 'signIns' | 'signInConsent'>): boolean {
  return form.signInConsent && hasSignInDetails(form);
}

/** Sign-in consent dropped and "review the plan first" put back to its default (ticked). */
export function resetSignInChoices(form: CheckupForm): CheckupForm {
  return form.signInConsent || !form.reviewFirst ? { ...form, signInConsent: false, reviewFirst: true } : form;
}

/** Shown when a plan saved with sign-in consent is approved after the details were forgotten (a restart). */
export const SIGN_IN_AGAIN_TEXT = 'Type the sign-in details again to approve this plan.';

/** The sign-ins typed again at approval: one per role in pending, or member if none specified. */
export function approveRolesOf(username: string, password: string, pending?: string[]): RoleCredential[] {
  if (!username.trim() || !password) return [];
  const u = username.trim();
  if (pending && pending.length > 0) {
    return pending.map((role) => ({ role, username: u, password }));
  }
  return [{ role: 'member', username: u, password }];
}

/** Consent never outlives the details it was given for. */
export function settleConsent(form: CheckupForm): CheckupForm {
  return hasSignInDetails(form) ? form : resetSignInChoices(form);
}

/** A new address; consent given for another host does not carry over. */
export function withAddress(
  form: CheckupForm,
  address: string,
  hostOf: (address: string) => string | null
): CheckupForm {
  const next = { ...form, address };
  return hostOf(form.address) === hostOf(address) ? next : resetSignInChoices(next);
}

/** "Only look at it instead": the quick sign-in fields and consent are cleared. */
export function lookOnly(form: CheckupForm): CheckupForm {
  return {
    ...resetSignInChoices(form),
    // Looking only records no ownership.
    owner: false,
    markedTestCopy: false,
    signIns: form.signIns.map((s, n) => (n === 0 ? { ...s, username: '', password: '' } : s)),
  };
}

/** After a check-up starts: consent, plan-first and the remember choice are not kept for the next one. */
export function afterStart(form: CheckupForm): CheckupForm {
  return {
    ...resetSignInChoices(form),
    rememberTouched: false,
    savedSessions: form.savedSessions.length > 0 ? [] : form.savedSessions,
  };
}

/** Keychain storage: with consent the quick-field password is stored only if the person ticked remember. */
export function rememberSignInsOf(form: CheckupForm, consentFlow: boolean): boolean {
  return consentFlow ? form.rememberTouched && form.rememberSignIns : form.rememberSignIns;
}

/** The consent-related parts of the start request. */
export function consentRequestOf(
  form: CheckupForm,
  stagingHost: boolean | undefined
): {
  owner: boolean;
  signInConsent?: true;
  skipReview?: boolean;
  stagingHost: boolean | undefined;
  rememberSignIns: boolean;
} {
  const consent = signInConsentGiven(form);
  const roles = rolesOf(form);
  return {
    owner: consent ? true : form.owner,
    ...(consent ? { signInConsent: true as const, skipReview: !form.reviewFirst } : {}),
    // Consent is no proof of a test copy: never let it be remembered as one.
    stagingHost: consent ? undefined : stagingHost,
    rememberSignIns: roles.length > 0 && rememberSignInsOf(form, consent),
  };
}
