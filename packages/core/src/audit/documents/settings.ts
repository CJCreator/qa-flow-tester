/**
 * Document settings (REQ-027, REQ-019): the Proposal template, the Pitch Glimpse opt-out text per language,
 * the tool user's company details and the rewrite overlap threshold.
 *
 * - `auditSettingsDefaults` returns the tool's defaults (from TS modules, never files read at runtime).
 * - `applySettingsUpdate` checks a `PUT /api/audit-settings` body and folds it into the stored settings.
 * - `resolveAuditSettings` merges stored settings over the defaults for `GET /api/audit-settings`.
 *
 * Stored settings leave a field out when it uses the default, so a later change to a default reaches every
 * tool user who never edited it. The PageSpeed key is never stored here: `applySettingsUpdate` hands it
 * back untouched for the route to give to the key resolver.
 *
 * Pure: no I/O, and nothing passed in is changed.
 */

import {
  DEFAULT_REWRITE_OVERLAP_WORDS,
  isDocumentLanguage,
  type AuditSettings,
  type AuditSettingsDefaults,
  type AuditSettingsUpdate,
  type CompanyDetails,
  type DocumentLanguage,
} from '@qa/types';
import { DEFAULT_OPT_OUT_TEXT } from './templates/opt-out.js';
import { PROPOSAL_TEMPLATE_EN } from './templates/proposal-en.js';
import { PROPOSAL_TEMPLATE_TA } from './templates/proposal-ta.js';

// ---------------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------------

export const MAX_PROPOSAL_TEMPLATE_CHARS = 20000;
export const MAX_OPT_OUT_TEXT_CHARS = 2000;
/** Longest company name, phone, email or website. */
export const MAX_COMPANY_FIELD_CHARS = 300;
export const MAX_COMPANY_ADDRESS_CHARS = 1000;
export const MAX_COMPANY_TERMS_CHARS = 10000;
export const MAX_REWRITE_OVERLAP_WORDS = 100;
/** Longest PageSpeed key accepted; its content is the key resolver's concern. */
export const MAX_PAGESPEED_KEY_CHARS = 512;

const COMPANY_KEYS = ['name', 'address', 'phone', 'email', 'website', 'terms'] as const satisfies readonly (keyof CompanyDetails)[];

const COMPANY_CAPS: Record<keyof CompanyDetails, number> = {
  name: MAX_COMPANY_FIELD_CHARS,
  address: MAX_COMPANY_ADDRESS_CHARS,
  phone: MAX_COMPANY_FIELD_CHARS,
  email: MAX_COMPANY_FIELD_CHARS,
  website: MAX_COMPANY_FIELD_CHARS,
  terms: MAX_COMPANY_TERMS_CHARS,
};

// ---------------------------------------------------------------------------------------------------
// Defaults and stored settings
// ---------------------------------------------------------------------------------------------------

const PROPOSAL_TEMPLATES: Partial<Record<DocumentLanguage, string>> = { en: PROPOSAL_TEMPLATE_EN, ta: PROPOSAL_TEMPLATE_TA };

/** The default Proposal template for `lang`, or the English one when `lang` has none. */
export function defaultProposalTemplate(lang: DocumentLanguage): string {
  return PROPOSAL_TEMPLATES[lang] ?? PROPOSAL_TEMPLATE_EN;
}

/** The tool's defaults. `proposalTemplate` is the English template; `defaultProposalTemplate('ta')` gives Tamil. */
export function auditSettingsDefaults(): AuditSettingsDefaults {
  return {
    optOutText: { ...DEFAULT_OPT_OUT_TEXT },
    proposalTemplate: PROPOSAL_TEMPLATE_EN,
    rewriteOverlapWords: DEFAULT_REWRITE_OVERLAP_WORDS,
  };
}

/** What is saved. A field left out (or a language missing from `optOutText`) uses the default. */
export interface StoredAuditSettings {
  optOutText: Partial<Record<DocumentLanguage, string>>;
  company: CompanyDetails;
  proposalTemplate?: string;
  rewriteOverlapWords?: number;
}

/** Settings before the tool user saved anything: every field uses the default, company details empty. */
export function emptyAuditSettings(): StoredAuditSettings {
  return { optOutText: {}, company: { name: '', address: '', phone: '', email: '', website: '', terms: '' } };
}

/** The settings as `GET /api/audit-settings` shows them: stored values over the defaults. */
export function resolveAuditSettings(stored: StoredAuditSettings, pagespeedKeySaved: boolean): AuditSettings {
  const defaults = auditSettingsDefaults();
  return {
    optOutText: { ...defaults.optOutText, ...stored.optOutText },
    company: { ...emptyAuditSettings().company, ...stored.company },
    proposalTemplate: stored.proposalTemplate ?? defaults.proposalTemplate,
    rewriteOverlapWords: stored.rewriteOverlapWords ?? defaults.rewriteOverlapWords,
    pagespeedKeySaved,
  };
}

// ---------------------------------------------------------------------------------------------------
// Updating
// ---------------------------------------------------------------------------------------------------

export type AuditSettingsErrors = Record<string, string>;

export type AuditSettingsUpdateResult =
  | {
      ok: true;
      /** The new stored settings. */
      settings: StoredAuditSettings;
      /**
       * Present only when the update sent one: the key as sent (null removes it), for the route to hand to
       * the key resolver. Never part of `settings`.
       */
      pagespeedKey?: string | null;
    }
  | { ok: false; errors: AuditSettingsErrors };

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Control characters other than tab, line feed and carriage return. */
// eslint-disable-next-line no-control-regex
const BAD_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function textProblem(value: unknown, max: number, allowEmpty: boolean): string | undefined {
  if (typeof value !== 'string') return 'must be text.';
  if (!allowEmpty && value.trim() === '') return 'must not be empty; use null to put the default back.';
  if (value.length > max) return `is longer than ${max} characters.`;
  if (BAD_CONTROL.test(value)) return 'must not contain invisible control characters.';
  return undefined;
}

function unknownKeys(value: Obj, allowed: readonly string[], at: string, errors: AuditSettingsErrors): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors[at ? `${at}.${key}` : key] = 'is not a setting that can be changed.';
  }
}

/**
 * Checks a `PUT /api/audit-settings` body and applies it to `current`. Only the fields sent change; null
 * puts the default back (a language's opt-out text, the Proposal template). Wrong types, unknown keys,
 * empty or over-long text, control characters and a `rewriteOverlapWords` that is not a whole number from
 * 1 to `MAX_REWRITE_OVERLAP_WORDS` are refused with one message per field, and then nothing changes.
 */
export function applySettingsUpdate(current: StoredAuditSettings, update: unknown): AuditSettingsUpdateResult {
  if (!isObject(update)) return { ok: false, errors: { body: 'must be an object.' } };
  const errors: AuditSettingsErrors = {};
  unknownKeys(update, ['optOutText', 'company', 'proposalTemplate', 'rewriteOverlapWords', 'pagespeedKey'], '', errors);

  const next: StoredAuditSettings = structuredClone(current);
  const body = update as Obj & AuditSettingsUpdate;

  if ('optOutText' in update) {
    if (!isObject(body.optOutText)) {
      errors.optOutText = 'must be an object of text per language, such as { "en": "..." }.';
    } else {
      for (const [lang, text] of Object.entries(body.optOutText as Obj)) {
        const at = `optOutText.${lang}`;
        if (!isDocumentLanguage(lang)) {
          errors[at] = 'is not a document language.';
        } else if (text === null) {
          delete next.optOutText[lang];
        } else {
          const problem = textProblem(text, MAX_OPT_OUT_TEXT_CHARS, false);
          if (problem) errors[at] = problem;
          else next.optOutText[lang] = text as string;
        }
      }
    }
  }

  if ('company' in update) {
    if (!isObject(body.company)) {
      errors.company = 'must be an object with name, address, phone, email, website or terms.';
    } else {
      const company = body.company as Obj;
      unknownKeys(company, COMPANY_KEYS, 'company', errors);
      for (const key of COMPANY_KEYS) {
        if (!(key in company)) continue;
        // Company details may be cleared with an empty string.
        const problem = textProblem(company[key], COMPANY_CAPS[key], true);
        if (problem) errors[`company.${key}`] = problem;
        else next.company[key] = company[key] as string;
      }
    }
  }

  if ('proposalTemplate' in update) {
    if (body.proposalTemplate === null) {
      delete next.proposalTemplate;
    } else {
      const problem = textProblem(body.proposalTemplate, MAX_PROPOSAL_TEMPLATE_CHARS, false);
      if (problem) errors.proposalTemplate = problem;
      else next.proposalTemplate = body.proposalTemplate as string;
    }
  }

  if ('rewriteOverlapWords' in update) {
    const n = body.rewriteOverlapWords;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_REWRITE_OVERLAP_WORDS) {
      errors.rewriteOverlapWords = `must be a whole number from 1 to ${MAX_REWRITE_OVERLAP_WORDS}.`;
    } else {
      next.rewriteOverlapWords = n;
    }
  }

  let pagespeedKey: string | null | undefined;
  if ('pagespeedKey' in update) {
    const key = body.pagespeedKey;
    // The message never repeats the key.
    if (key !== null && (typeof key !== 'string' || key.trim() === '' || key.length > MAX_PAGESPEED_KEY_CHARS)) {
      errors.pagespeedKey = `must be a key of 1 to ${MAX_PAGESPEED_KEY_CHARS} characters, or null to remove it.`;
    } else {
      pagespeedKey = key as string | null;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, settings: next, ...(pagespeedKey !== undefined ? { pagespeedKey } : {}) };
}
