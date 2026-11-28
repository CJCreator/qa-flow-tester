import {
  AUDIT_COMPETITOR_API,
  auditPath,
  isRecord,
  type AuditErrorCode,
  type CompetitorCrawlBody,
  type CompetitorDiscoverBody,
  type CompetitorExample,
  type CompetitorsState,
} from '@qa/types/src/browser.js';
import { isAuditErrorCode, jsonInit, NOT_ANSWERING, type Fetch } from '../audit-call';

/**
 * The competitor calls of the Improved version screen (T-416): read the stored competitors, find 3 similar
 * sites (one AI request), and read the kept ones. Every refusal becomes a plain sentence.
 */
export type CompetitorOutcome =
  | { ok: true; value: CompetitorsState | null; examples?: CompetitorExample[] }
  | { ok: false; message: string; code?: AuditErrorCode };

export const COMPETITOR_NO_AI_KEY = 'An AI key is needed to find similar sites. Add one in Settings.';

const REFUSALS: Partial<Record<AuditErrorCode, string>> = {
  ERR_NO_AI_KEY: COMPETITOR_NO_AI_KEY,
  ERR_AUDIT_RUNNING: 'This version of the Website Audit is still running. Try again when it has finished.',
  ERR_FORBIDDEN: 'You do not have permission to do this on this Website Audit.',
};

function isState(value: unknown): value is CompetitorsState {
  return isRecord(value) && typeof value.version === 'number' && Array.isArray(value.candidates);
}

async function call(url: string, init: RequestInit, fetchImpl: Fetch, fallback: string): Promise<CompetitorOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch {
    return { ok: false, message: NOT_ANSWERING };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (res.ok) {
    const state = isRecord(body) ? body.competitors : undefined;
    const raw = isRecord(body) && Array.isArray(body.examples) ? body.examples : [];
    const examples = raw.filter(
      (e): e is CompetitorExample =>
        isRecord(e) &&
        typeof e.findingId === 'string' &&
        typeof e.host === 'string' &&
        typeof e.urlPath === 'string' &&
        typeof e.text === 'string'
    );
    return isState(state) ? { ok: true, value: state, examples } : { ok: false, message: fallback };
  }
  const refusal = isRecord(body) ? body : {};
  const code = isAuditErrorCode(refusal.code) ? refusal.code : undefined;
  // A GET with nothing stored yet is not a problem: there are simply no competitors yet.
  if (res.status === 404 && init.method === 'GET' && code === 'ERR_AUDIT_NOT_FOUND') return { ok: true, value: null };
  if (code && REFUSALS[code]) return { ok: false, message: REFUSALS[code]!, code };
  const said = typeof refusal.error === 'string' && res.status === 400 ? refusal.error : fallback;
  return { ok: false, message: said, code };
}

export function loadCompetitors(auditId: string, version: number, fetchImpl: Fetch = fetch) {
  const url = `${auditPath(AUDIT_COMPETITOR_API.getCompetitors.path, { id: auditId })}?version=${version}`;
  return call(url, { method: 'GET' }, fetchImpl, 'The competitors could not be loaded. Try again.');
}

export function discoverCompetitors(auditId: string, version: number, fetchImpl: Fetch = fetch) {
  const body: CompetitorDiscoverBody = { version };
  return call(
    auditPath(AUDIT_COMPETITOR_API.discoverCompetitors.path, { id: auditId }),
    jsonInit('POST', body),
    fetchImpl,
    'Similar sites could not be found this time. Try again.'
  );
}

export function crawlCompetitors(auditId: string, version: number, hosts: string[], fetchImpl: Fetch = fetch) {
  const body: CompetitorCrawlBody = { version, hosts };
  return call(
    auditPath(AUDIT_COMPETITOR_API.crawlCompetitors.path, { id: auditId }),
    jsonInit('POST', body),
    fetchImpl,
    'The similar sites could not be read this time. Try again.'
  );
}
