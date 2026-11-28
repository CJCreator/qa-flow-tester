import {
  isRecord,
  PROPOSAL_PLACEHOLDERS,
  AUDIT_API,
  auditPath,
  type AuditErrorCode,
  type AuditSettingsReply,
  type AuditSettingsUpdate,
  type CompanyDetails,
} from '@qa/types/src/browser.js';
import { callAudit, type Fetch } from '../audit-call';

/**
 * The document settings screen's calls to the runner (REQ-027, REQ-019, REQ-018): the saved settings and
 * the tool's defaults (`GET /api/audit-settings`) and the save (`PUT /api/audit-settings`). A save sends
 * only the fields that changed; null puts a field's default back. Every refusal becomes a plain sentence
 * safe to show as-is.
 */

export type SettingsOutcome<T> = { ok: true; value: T } | { ok: false; message: string; code?: AuditErrorCode };

/** The languages the settings screen edits opt-out text for. */
export const OPT_OUT_LANGUAGES = ['en', 'ta'] as const;
export type OptOutLanguage = (typeof OPT_OUT_LANGUAGES)[number];

/** The company details fields, in the order the screen shows them. */
export const COMPANY_FIELDS: readonly (keyof CompanyDetails)[] = [
  'name',
  'address',
  'phone',
  'email',
  'website',
  'terms',
];

/** The placeholders a Proposal template may use: the one list in @qa/types, shared with the filler in @qa/core. */
export { PROPOSAL_PLACEHOLDERS };

/** What the screen's fields hold. */
export interface SettingsDraft {
  proposalTemplate: string;
  optOutText: Record<OptOutLanguage, string>;
  company: CompanyDetails;
  /** The words of a copied phrase that block an accepted rewrite, as typed. */
  rewriteOverlapWords: string;
  /** A PageSpeed key being typed. Write-only: never filled from a reply. */
  pagespeedKey: string;
}

/** The most words a copied phrase may have, as the runner checks it. */
export const MAX_REWRITE_OVERLAP_WORDS = 100;

/** The overlap field's number, or null when it is not a whole number from 1 to the maximum. */
export function overlapWordsValue(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= 1 && n <= MAX_REWRITE_OVERLAP_WORDS ? n : null;
}

/** The opt-out text in effect for a language: the saved one, else the tool's default. */
export function optOutInEffect(reply: AuditSettingsReply, language: OptOutLanguage): string {
  return reply.settings.optOutText[language] ?? reply.defaults.optOutText[language] ?? '';
}

/** The fields as saved. */
export function draftFrom(reply: AuditSettingsReply): SettingsDraft {
  return {
    proposalTemplate: reply.settings.proposalTemplate,
    optOutText: { en: optOutInEffect(reply, 'en'), ta: optOutInEffect(reply, 'ta') },
    company: { ...reply.settings.company },
    rewriteOverlapWords: String(reply.settings.rewriteOverlapWords ?? reply.defaults.rewriteOverlapWords ?? ''),
    pagespeedKey: '',
  };
}

/** The PUT body for the fields that differ from what is saved; empty when nothing changed. */
export function settingsUpdate(reply: AuditSettingsReply, draft: SettingsDraft): AuditSettingsUpdate {
  const saved = draftFrom(reply);
  const update: AuditSettingsUpdate = {};
  if (draft.proposalTemplate !== saved.proposalTemplate) update.proposalTemplate = draft.proposalTemplate;
  for (const language of OPT_OUT_LANGUAGES) {
    if (draft.optOutText[language] !== saved.optOutText[language]) {
      update.optOutText = { ...update.optOutText, [language]: draft.optOutText[language] };
    }
  }
  for (const field of COMPANY_FIELDS) {
    if (draft.company[field] !== saved.company[field])
      update.company = { ...update.company, [field]: draft.company[field] };
  }
  if (draft.rewriteOverlapWords !== saved.rewriteOverlapWords) {
    const words = overlapWordsValue(draft.rewriteOverlapWords);
    if (words !== null) update.rewriteOverlapWords = words;
  }
  if (draft.pagespeedKey.trim() !== '') update.pagespeedKey = draft.pagespeedKey.trim();
  return update;
}

export function isUpdateEmpty(update: AuditSettingsUpdate): boolean {
  return Object.keys(update).length === 0;
}

/** Puts the tool's default Proposal template back. */
export function resetProposalTemplate(): AuditSettingsUpdate {
  return { proposalTemplate: null };
}

/** Puts the tool's default opt-out text back for one language. */
export function resetOptOutText(language: OptOutLanguage): AuditSettingsUpdate {
  return { optOutText: { [language]: null } };
}

/** Removes the saved PageSpeed key. */
export function removePagespeedKey(): AuditSettingsUpdate {
  return { pagespeedKey: null };
}

const REFUSALS: Partial<Record<AuditErrorCode, string>> = {
  ERR_FORBIDDEN: 'Only the tool user can change the document settings.',
};

function acceptReply(body: unknown): AuditSettingsReply | null {
  if (!isRecord(body) || !isRecord(body.settings) || !isRecord(body.defaults)) return null;
  const { settings, defaults } = body;
  if (typeof settings.proposalTemplate !== 'string' || !isRecord(settings.optOutText) || !isRecord(settings.company))
    return null;
  if (typeof defaults.proposalTemplate !== 'string' || !isRecord(defaults.optOutText)) return null;
  return body as unknown as AuditSettingsReply;
}

function call(
  url: string,
  init: RequestInit,
  fetchImpl: Fetch,
  fallback: string
): Promise<SettingsOutcome<AuditSettingsReply>> {
  return callAudit(url, init, fetchImpl, fallback, acceptReply, REFUSALS);
}

/** `GET /api/audit-settings`: the saved settings and the tool's defaults. */
export function loadSettings(fetchImpl: Fetch = fetch): Promise<SettingsOutcome<AuditSettingsReply>> {
  return call(
    auditPath(AUDIT_API.getSettings.path, {}),
    { method: AUDIT_API.getSettings.method },
    fetchImpl,
    'The document settings could not be loaded. Try again.'
  );
}

/** `PUT /api/audit-settings`: saves the fields in `update` and returns the settings now in effect. */
export function saveSettings(
  update: AuditSettingsUpdate,
  fetchImpl: Fetch = fetch
): Promise<SettingsOutcome<AuditSettingsReply>> {
  return call(
    auditPath(AUDIT_API.putSettings.path, {}),
    {
      method: AUDIT_API.putSettings.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    },
    fetchImpl,
    'The document settings could not be saved. Try again.'
  );
}
