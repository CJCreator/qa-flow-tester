/**
 * Audit settings routes (REQ-027, REQ-019): `GET /api/audit-settings` and `PUT /api/audit-settings`.
 *
 * The Proposal template, the Pitch Glimpse opt-out text per language, the company details and the rewrite
 * overlap threshold are stored as one JSON object in the audit store (ADR 0036: a local file written
 * atomically, or the hosted Cloud Storage bucket). The PageSpeed key never goes there: it is handed to the
 * injected key port, and replies only say whether one is saved (`pagespeedKeySaved`).
 *
 * Handlers take their dependencies as arguments, so they run without a RunnerServer.
 */

import type http from 'http';
import { AUDIT_API, type AuditErrorReply, type AuditSettingsReply } from '@qa/types';
import {
  applySettingsUpdate,
  auditSettingsDefaults,
  emptyAuditSettings,
  resolveAuditSettings,
  type AuditSettingsErrors,
  type AuditStoreBackend,
  type StoredAuditSettings,
} from '@qa/core';
import type { Route, RouteContext } from './route.js';
import { readJsonBody, sendJson } from './body.js';

/** Largest settings body accepted (characters): the field caps add up to well under this. */
export const MAX_AUDIT_SETTINGS_BODY_CHARS = 200_000;

/** Where the settings object lives in the audit store; outside `audits/`, so deleting an audit keeps it. */
export const AUDIT_SETTINGS_KEY = 'settings/audit-settings.json';

/** Saves and reads the PageSpeed key (implemented over the key resolver). Never stores it in settings. */
export interface PagespeedKeyPort {
  saved(): Promise<boolean>;
  /** A key saves it; null removes it. */
  save(key: string | null): Promise<void>;
}

/** The stored settings object. */
export interface AuditSettingsStore {
  /** The stored settings, or null when nothing was saved yet. */
  load(): Promise<unknown>;
  save(settings: StoredAuditSettings): Promise<void>;
}

export interface AuditSettingsDeps {
  readonly settings: AuditSettingsStore;
  readonly pagespeedKey: PagespeedKeyPort;
}

/** The settings object over an audit store backend (`store.backend`). */
export function auditSettingsStoreOn(backend: Pick<AuditStoreBackend, 'getJson' | 'putJson'>): AuditSettingsStore {
  return {
    load: () => backend.getJson(AUDIT_SETTINGS_KEY),
    save: (settings) => backend.putJson(AUDIT_SETTINGS_KEY, settings),
  };
}

/** Settings refusals: `fields` holds one message per settings field (`company.email`, `optOutText.ta`...). */
type SettingsErrorReply = Omit<AuditErrorReply, 'fields'> & { fields?: AuditSettingsErrors };

const SAVE_FAILED = 'The settings could not be saved. Try again.';
const READ_FAILED = 'The settings could not be read. Try again.';

/**
 * Stored settings, checked again on the way in: whatever is on disk passes the same rules as a PUT, so a
 * hand-edited or damaged object cannot reach a reply. Nothing saved, or an object that fails, reads as the
 * defaults. A stray `pagespeedKey` in it is dropped, never returned.
 */
export async function loadStored(store: AuditSettingsStore): Promise<StoredAuditSettings> {
  const raw = await store.load();
  if (raw === null || raw === undefined) return emptyAuditSettings();
  const checked = applySettingsUpdate(emptyAuditSettings(), raw);
  return checked.ok ? checked.settings : emptyAuditSettings();
}

/** The saved settings over the defaults, as every reader sees them. A damaged stored object reads as the defaults. */
export async function loadResolvedSettings(store: AuditSettingsStore) {
  return resolveAuditSettings(await loadStored(store), false);
}

async function replyFor(stored: StoredAuditSettings, port: PagespeedKeyPort): Promise<AuditSettingsReply> {
  return { settings: resolveAuditSettings(stored, await port.saved()), defaults: auditSettingsDefaults() };
}

/** One PUT at a time per settings store, so two saves never read the same old settings. */
const writeQueues = new WeakMap<AuditSettingsStore, Promise<unknown>>();

function serialised<T>(store: AuditSettingsStore, fn: () => Promise<T>): Promise<T> {
  const tail = writeQueues.get(store) ?? Promise.resolve();
  const next = tail.then(fn, fn);
  writeQueues.set(
    store,
    next.catch(() => undefined)
  );
  return next;
}

/** `GET /api/audit-settings`: stored settings over the defaults, plus the defaults. */
export async function getAuditSettings(deps: AuditSettingsDeps, res: http.ServerResponse): Promise<void> {
  let reply: AuditSettingsReply;
  try {
    reply = await replyFor(await loadStored(deps.settings), deps.pagespeedKey);
  } catch {
    sendJson(res, 500, { error: READ_FAILED });
    return;
  }
  sendJson(res, 200, reply);
}

/**
 * `PUT /api/audit-settings`: checks the body with `applySettingsUpdate`; a refusal is 400
 * ERR_INVALID_REQUEST with one message per field, and nothing changes. Otherwise the PageSpeed key (when
 * sent) goes to the key port first, then the new settings are stored, and the reply is the same shape as GET.
 */
export async function putAuditSettings(
  deps: AuditSettingsDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody<unknown>(req, MAX_AUDIT_SETTINGS_BODY_CHARS);
  } catch {
    const reply: SettingsErrorReply = {
      error: 'The settings could not be read: send a JSON object of at most 200,000 characters.',
      code: 'ERR_INVALID_REQUEST',
    };
    sendJson(res, 400, reply);
    return;
  }

  type Outcome = { status: 200; reply: AuditSettingsReply } | { status: 400; reply: SettingsErrorReply };
  let outcome: Outcome;
  try {
    outcome = await serialised<Outcome>(deps.settings, async () => {
      const current = await loadStored(deps.settings);
      const result = applySettingsUpdate(current, body);
      if (!result.ok) {
        return {
          status: 400,
          reply: { error: 'Some settings are not valid.', code: 'ERR_INVALID_REQUEST', fields: result.errors },
        };
      }
      // The key goes to the key port only: never into the stored settings, a reply or a log line.
      if (result.pagespeedKey !== undefined) await deps.pagespeedKey.save(result.pagespeedKey);
      await deps.settings.save(result.settings);
      return { status: 200, reply: await replyFor(result.settings, deps.pagespeedKey) };
    });
  } catch {
    // Fixed wording: a store or key-resolver error could carry paths or the key.
    sendJson(res, 500, { error: SAVE_FAILED });
    return;
  }
  sendJson(res, outcome.status, outcome.reply);
}

/** The route-table rows for the audit settings (owner only, closed on a beta copy). */
export function auditSettingsRoutes(deps: AuditSettingsDeps): Route[] {
  return [
    {
      method: AUDIT_API.getSettings.method,
      path: AUDIT_API.getSettings.path,
      access: AUDIT_API.getSettings.access,
      handle: ({ res }: Pick<RouteContext, 'res'>) => getAuditSettings(deps, res),
    },
    {
      method: AUDIT_API.putSettings.method,
      path: AUDIT_API.putSettings.path,
      access: AUDIT_API.putSettings.access,
      handle: ({ req, res }: Pick<RouteContext, 'req' | 'res'>) => putAuditSettings(deps, req, res),
    },
  ];
}
