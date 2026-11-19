/**
 * Competitors (T-416, ADR 0049): AUDIT_COMPETITOR_API getCompetitors (view), discoverCompetitors and
 * crawlCompetitors (owner: discovery spends the tool user's AI key, and the crawl makes requests to sites the
 * tool user did not name). Started from the Improved version screen after the audit; not a pipeline stage.
 *
 * - Discover: one AI request names 3 similar sites; each address passes the public-address check. Stored as
 *   `competitors.json` in the version folder.
 * - Crawl: only hosts from the stored candidates that passed the check; each is checked again, then read
 *   lightly (GET only, paced, robots.txt honoured). On the hosted copy, competitor pages count toward the
 *   200-page cap: the allowance is the cap minus the audit's own recorded pages.
 *
 * Handlers take their dependencies as arguments, so they run without a RunnerServer.
 */
import {
  AUDIT_COMPETITOR_API,
  COMPETITOR_PAGE_TYPES,
  type AuditEndpoint,
  type AuditResult,
  type CompetitorExample,
  type CompetitorPageFacts,
  type CompetitorSite,
  type CompetitorsReply,
  type CompetitorsState,
  type PageContent,
} from '@qa/types';
import {
  COMPETITORS_NAME,
  auditedPagesByType,
  checkAuditAddress,
  compareSites,
  competitorExamples,
  competitorSummary,
  discoverCompetitors,
  lightCrawlSites,
  pageContentName,
  pageFactsFromContent,
  type AuditAddressResult,
  type AuditAiResolution,
  type AuditStore,
  type LightCrawlOptions,
} from '@qa/core';
import type { Route, RouteContext } from './route.js';
import { sendJson } from './body.js';
import { versionQuery } from './audit-common.js';
import {
  AUDIT_FORBIDDEN,
  AUDIT_NOT_FOUND,
  mayUseAudit,
  refuse,
  refuseStoreFailure,
  type AuditCaller,
} from './audit-store.js';

export const COMPETITORS_NONE = 'No competitors have been found for this version yet.';
export const COMPETITORS_AI_FAILED = 'The AI could not name similar sites this time. Nothing was saved. Try again.';
export const COMPETITORS_NO_AI_KEY = 'An AI key is needed to find similar sites. Add one in Settings.';
export const COMPETITORS_FIND_FIRST = 'Find similar sites first.';
export const COMPETITORS_UNKNOWN_HOST = 'Only the sites found for this version can be read.';
export const COMPETITORS_KEEP_ONE = 'Keep at least one site to read.';
const RUNNING = 'This version of the Website Audit is still running. Come back when it has finished.';
const NOT_FINISHED = 'This version has no finished result.';
const MAX_BODY = 4_000;

export interface AuditCompetitorRouteDeps {
  store: AuditStore;
  caller: (context: RouteContext) => AuditCaller | Promise<AuditCaller>;
  /** The tool user's audit AI; every request it makes counts toward the run's request counter (T-398). */
  resolveAi: () => Promise<AuditAiResolution>;
  /** The hosted copy's page cap (200); unset on a local runner. Competitor pages count toward it. */
  maxPages?: number;
  /** The public-address check; default `checkAuditAddress` with private addresses refused on every runner. */
  checkAddress?: (url: string) => Promise<AuditAddressResult>;
  /** Test seams for the light crawl: the GET, the pacer gap and the clock. */
  crawl?: Pick<LightCrawlOptions, 'fetch' | 'minGapMs' | 'sleep' | 'now'>;
  now?: () => Date;
}

/** T-418: what each read site shows for each of the top 10 findings. */
function examplesFor(result: AuditResult | null, state: CompetitorsState): CompetitorExample[] {
  if (!result) return [];
  return [...competitorExamples(result.findings.slice(0, 10), state).values()].flat();
}

function row(endpoint: AuditEndpoint, handle: Route['handle']): Route {
  return { method: endpoint.method, path: endpoint.path, access: endpoint.access, handle };
}

/** `{ version? }` plus the named extra fields; anything else is refused. */
function checkBody(
  value: unknown,
  extra: readonly string[]
): { version?: number; body: Record<string, unknown> } | string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'The request must be a JSON object.';
  const body = value as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (key !== 'version' && !extra.includes(key)) return `Unknown field: ${key.slice(0, 40)}.`;
  }
  if (body.version !== undefined) {
    if (typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 1) {
      return 'The version must be a whole number from 1.';
    }
  }
  return { version: body.version as number | undefined, body };
}

/** The JSON body; an empty body is `{}`. */
async function readBody(c: RouteContext): Promise<unknown> {
  if (typeof c.req.setEncoding === 'function') c.req.setEncoding('utf8');
  let raw = '';
  try {
    for await (const chunk of c.req) {
      raw += chunk;
      if (raw.length > MAX_BODY) return 'too-large';
    }
  } catch {
    return 'too-large';
  }
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw);
  } catch {
    return 'not-json';
  }
}

export function auditCompetitorRoutes(deps: AuditCompetitorRouteDeps): Route[] {
  const { store } = deps;
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  const check = deps.checkAddress ?? ((url: string) => checkAuditAddress(url, { allowPrivateAddresses: false }));

  /** The finished version and its result, or a refusal already sent. */
  const finishedVersion = async (
    c: RouteContext,
    wanted: number | undefined
  ): Promise<{ version: number; result: AuditResult } | null> => {
    const auditId = c.params?.id ?? '';
    const record = await store.readAuditRecord(auditId);
    const number = wanted ?? record?.latestVersion;
    const version = record && number !== undefined ? await store.getVersion(auditId, number) : null;
    if (!version) {
      refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
      return null;
    }
    if (version.status === 'running') {
      refuse(c.res, 409, 'ERR_AUDIT_RUNNING', RUNNING);
      return null;
    }
    const result = await store.getResult(auditId, version.version);
    if (!result) {
      refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', NOT_FINISHED);
      return null;
    }
    return { version: version.version, result };
  };

  /** Owner only, a JSON body, then the finished version. */
  const ownerStart = async (
    c: RouteContext,
    extra: readonly string[]
  ): Promise<{ version: number; result: AuditResult; body: Record<string, unknown> } | null> => {
    const caller = await deps.caller(c);
    if (!caller.owner) {
      refuse(c.res, 403, 'ERR_FORBIDDEN', AUDIT_FORBIDDEN);
      return null;
    }
    const raw = await readBody(c);
    if (raw === 'too-large') {
      refuse(c.res, 400, 'ERR_INVALID_REQUEST', 'The request is too large.');
      return null;
    }
    if (raw === 'not-json') {
      refuse(c.res, 400, 'ERR_INVALID_REQUEST', 'The request is not valid JSON.');
      return null;
    }
    const checked = checkBody(raw, extra);
    if (typeof checked === 'string') {
      refuse(c.res, 400, 'ERR_INVALID_REQUEST', checked);
      return null;
    }
    const found = await finishedVersion(c, checked.version);
    return found ? { ...found, body: checked.body } : null;
  };

  const getCompetitors = async (c: RouteContext): Promise<void> => {
    try {
      const auditId = c.params?.id ?? '';
      const wanted = versionQuery(c.url);
      if (wanted === 'invalid') {
        return refuse(c.res, 400, 'ERR_INVALID_REQUEST', 'The version must be a whole number from 1.');
      }
      const caller = await deps.caller(c);
      if (!(await mayUseAudit(store, caller, auditId, 'view'))) {
        return refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
      }
      const record = await store.readAuditRecord(auditId);
      const number = wanted ?? record?.latestVersion;
      if (!record || number === undefined) return refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
      const state = await store.readVersionJson<CompetitorsState>(auditId, number, COMPETITORS_NAME);
      if (!state) return refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', COMPETITORS_NONE);
      const result = await store.getResult(auditId, number);
      const reply: CompetitorsReply = { competitors: state, examples: examplesFor(result, state) };
      sendJson(c.res, 200, reply);
    } catch (err) {
      refuseStoreFailure(c.res, err);
    }
  };

  const discover = async (c: RouteContext): Promise<void> => {
    try {
      const started = await ownerStart(c, []);
      if (!started) return;
      const auditId = c.params?.id ?? '';
      const resolved = await deps.resolveAi();
      if (!resolved.ok) return refuse(c.res, 409, 'ERR_NO_AI_KEY', COMPETITORS_NO_AI_KEY);
      const home = await store.readVersionJson<PageContent>(
        auditId,
        started.version,
        pageContentName(started.result.hierarchy.root.urlPath)
      );
      let outcome: Awaited<ReturnType<typeof discoverCompetitors>>;
      try {
        outcome = await discoverCompetitors(resolved.ai, competitorSummary(started.result, home), {
          checkAddress: check,
        });
      } catch {
        outcome = { ok: false, reason: 'no-answer' };
      }
      // Fixed wording: no provider text or key reaches the reply. Nothing is stored.
      if (!outcome.ok) return sendJson(c.res, 502, { error: COMPETITORS_AI_FAILED, code: 'ERR_AI_FAILED' });
      const state: CompetitorsState = { version: started.version, discoveredAt: now(), candidates: outcome.candidates };
      await store.writeVersionJson(auditId, started.version, COMPETITORS_NAME, state);
      const reply: CompetitorsReply = { competitors: state };
      sendJson(c.res, 200, reply);
    } catch (err) {
      refuseStoreFailure(c.res, err);
    }
  };

  const crawl = async (c: RouteContext): Promise<void> => {
    try {
      const started = await ownerStart(c, ['hosts']);
      if (!started) return;
      const auditId = c.params?.id ?? '';
      const hosts = started.body.hosts;
      if (!Array.isArray(hosts) || hosts.some((h) => typeof h !== 'string') || hosts.length > 10) {
        return refuse(c.res, 400, 'ERR_INVALID_REQUEST', 'hosts must be a list of site names.');
      }
      const stored = await store.readVersionJson<CompetitorsState>(auditId, started.version, COMPETITORS_NAME);
      if (!stored) return refuse(c.res, 409, 'ERR_INVALID_REQUEST', COMPETITORS_FIND_FIRST);
      const wanted = [...new Set((hosts as string[]).map((h) => h.toLowerCase()))];
      if (wanted.length === 0) return refuse(c.res, 400, 'ERR_INVALID_REQUEST', COMPETITORS_KEEP_ONE);
      const kept = wanted.map((h) => stored.candidates.find((cand) => cand.host === h && cand.status === 'ok'));
      if (kept.some((k) => k === undefined)) return refuse(c.res, 400, 'ERR_INVALID_REQUEST', COMPETITORS_UNKNOWN_HOST);

      // Checked again just before reading: a name can move to another address after discovery.
      const readable: Array<{ url: string; host: string; reason: string }> = [];
      const refused: CompetitorSite[] = [];
      for (const cand of kept as NonNullable<(typeof kept)[number]>[]) {
        const site = { url: cand.url, host: cand.host, reason: cand.reason };
        const address = await check(cand.url).catch((): AuditAddressResult => ({
          ok: false,
          code: 'ERR_UNREACHABLE',
          reason: '',
        }));
        if (address.ok) readable.push(site);
        else
          refused.push({
            ...site,
            status: 'not-read',
            notReadReason:
              address.code === 'ERR_PRIVATE_ADDRESS'
                ? 'This address points to a private or local network, so it is not read.'
                : 'The site could not be reached.',
            pages: [],
          });
      }

      const allowance =
        deps.maxPages !== undefined ? Math.max(0, deps.maxPages - started.result.pages.length) : undefined;
      const read = await lightCrawlSites(readable, {
        ...(deps.crawl ?? {}),
        ...(allowance !== undefined ? { pageAllowance: allowance } : {}),
      });
      const sites = wanted.map(
        (h) => read.find((s) => s.host === h) ?? refused.find((s) => s.host === h)
      ) as CompetitorSite[];

      const audited: CompetitorPageFacts[] = [];
      for (const [type, urlPath] of auditedPagesByType(started.result)) {
        if (!(COMPETITOR_PAGE_TYPES as readonly string[]).includes(type)) continue;
        const content = await store.readVersionJson<PageContent>(auditId, started.version, pageContentName(urlPath));
        if (content) audited.push({ ...pageFactsFromContent(content), pageType: type });
      }

      const state: CompetitorsState = {
        ...stored,
        crawledAt: now(),
        sites,
        comparison: compareSites(audited, sites),
      };
      await store.writeVersionJson(auditId, started.version, COMPETITORS_NAME, state);
      const reply: CompetitorsReply = { competitors: state, examples: examplesFor(started.result, state) };
      sendJson(c.res, 200, reply);
    } catch (err) {
      refuseStoreFailure(c.res, err);
    }
  };

  return [
    row(AUDIT_COMPETITOR_API.getCompetitors, getCompetitors),
    row(AUDIT_COMPETITOR_API.discoverCompetitors, discover),
    row(AUDIT_COMPETITOR_API.crawlCompetitors, crawl),
  ];
}
