/**
 * Website Audit start and progress (REQ-001, REQ-002, REQ-003): `POST /api/audits` and
 * `GET /api/audits/:id/stream`.
 *
 * Start: the body is checked (validateAuditStartBody), then the address (public and answering, Q-22), then the
 * RunSlot is claimed with kind 'audit' (DEC-002) and version 1 is created. The reply is 202; the audit runs in
 * the background: 'checking-address', the crawl ('crawling'), then the `afterCrawl` step (the analysis and
 * save pipeline, BE-192). The slot is released and the working folder removed when the run ends, whatever the
 * outcome; the version is never left 'running' when the store can still be written.
 *
 * Only the validated request reaches the crawl: unknown body fields are dropped by the check, so no field can
 * turn on sign-in, Roles, form submission or private addresses.
 *
 * Not registered here: BE-190 adds these rows to allRoutes with their real dependencies.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type http from 'http';
import {
  AUDIT_API,
  AUDIT_ID_PATTERN,
  validateAuditStartBody,
  type AuditAccess,
  type AuditErrorCode,
  type AuditErrorReply,
  type AuditProgressEvent,
  type AuditRequest,
  type AuditStartReply,
} from '@qa/types';
import {
  AuditPipelineError,
  checkAuditAddress,
  createPageRecorder,
  isAbortError,
  runAuditCrawl,
  runAuditPipeline,
  type AuditAddressResult,
  type AuditAiResolution,
  type AuditCrawlOptions,
  type AuditCrawlResult,
  type AuditPageRecorder,
  type AuditStore,
  type PageRecorderOptions,
  type PageSpeedDeps,
} from '@qa/core';
import type { Route, RouteContext } from './route.js';
import { readJsonBody, sendJson } from './body.js';
import { mayUseAudit, type AuditCaller } from './audit-store.js';
import type { RunSlot } from '../session/run-slot.js';
import { AuditRun, AuditRuns } from '../session/audit-run.js';

/** A start body is a URL, four limits and a language: far below this. */
const MAX_START_BODY_CHARS = 16_384;

export const AUDIT_INVALID = 'Some fields need a change. See the message next to each one.';
export const AUDIT_BAD_BODY = 'The request body must be a JSON object.';
export const AUDIT_FORBIDDEN_START = 'Only the owner of this QA Tool can start a Website Audit.';
export const AUDIT_UNREACHABLE = 'The site could not be reached.';
export const AUDIT_BUSY = 'Another Check-up, benchmark or Website Audit is in progress. Start this one when it has finished.';
export const AUDIT_NOT_FOUND_STREAM = 'This Website Audit was not found. It may have finished long ago or been deleted.';
export const AUDIT_START_FAILED = 'The Website Audit could not be started. Try again.';
/** Fixed wording of the 'failed' events and of the version's stored error. Never page text or internals. */
export const AUDIT_CRAWL_FAILED = 'The website could not be read to the end. Check that it is online, then run the audit again.';
export const AUDIT_SAVE_FAILED = 'The Website Audit could not be saved. Try again.';
export const AUDIT_STATUS_FAILED = 'The Website Audit was saved, but its status could not be updated. Try reloading it.';
export const AUDIT_STOPPED = 'The Website Audit was stopped before it finished.';

/**
 * AuditErrorCode of a 'failed' event. A crawl that broke off is ERR_UNREACHABLE (the site stopped answering);
 * the contract has no code for a stop or a storage failure, so those use ERR_INVALID_REQUEST with their own
 * fixed message (the wizard shows the message for codes it has no sentence for).
 */
const CRAWL_FAILED_CODE: AuditErrorCode = 'ERR_UNREACHABLE';
const OTHER_FAILED_CODE: AuditErrorCode = 'ERR_INVALID_REQUEST';

/** Everything the run needs after the crawl. The step must leave the version 'done' when it resolves. */
export interface AfterCrawlInput {
  auditId: string;
  version: number;
  request: AuditRequest;
  startedAt: string;
  crawl: AuditCrawlResult;
  recorder: AuditPageRecorder;
  /** The run's local working folder (the recorder's); removed when the run ends. */
  workDir: string;
  signal: AbortSignal;
  onProgress: (event: AuditProgressEvent) => void;
}

/**
 * The step after the crawl (analysis and save). Resolves: the version is 'done'. Throws AuditPipelineError
 * ('save-failed' | 'status-not-updated') or an AbortError; anything else counts as a failed save.
 */
export type AfterCrawlStep = (input: AfterCrawlInput) => Promise<void>;

export type AuditAddressCheck = (url: string) => Promise<AuditAddressResult>;
export type AuditCrawl = (request: AuditRequest, opts: AuditCrawlOptions) => Promise<AuditCrawlResult>;
export type AuditRunStore = Pick<AuditStore, 'createAudit' | 'updateVersion' | 'getResult' | 'grantsFor'>;

/** What the background run uses. `runAuditVersion` takes these, so the re-run route (BE-603) shares them. */
export interface AuditRunServices {
  store: AuditRunStore;
  crawl?: AuditCrawl;
  afterCrawl?: AfterCrawlStep;
  createRecorder?: (opts: PageRecorderOptions) => AuditPageRecorder;
  /** A fresh local working folder for the run. Default: a temp folder. */
  makeWorkDir?: () => Promise<string>;
  now?: () => Date;
}

export interface AuditCrawlRouteDeps extends AuditRunServices {
  /** Reads the caller from the request; the owner when the access key was sent (as the other audit rows). */
  caller: (context: RouteContext) => AuditCaller | Promise<AuditCaller>;
  /** The single run slot (DEC-002). Default: the runner session's. */
  slot?: (context: RouteContext) => RunSlot;
  /** The address check (REQ-001 AC-2, Q-22). Default: checkAuditAddress. */
  checkAddress?: AuditAddressCheck;
  /** Running and recently ended audits. Share one instance with the re-run route. */
  runs?: AuditRuns;
}

/** What the production rows add: the pieces the default pipeline step needs. */
export interface AuditPipelineStepDeps {
  store: AuditStore;
  /** resolveAuditAi with the saved setup and the key resolver. Missing or failing: no AI key. */
  resolveAi?: () => Promise<AuditAiResolution>;
  /** The key resolver's resolveServiceKey, for PageSpeed. */
  resolveServiceKey?: PageSpeedDeps['resolveServiceKey'];
  /** Test seam. Default: runAuditPipeline. */
  pipeline?: typeof runAuditPipeline;
}

function refuse(
  res: http.ServerResponse,
  status: number,
  code: AuditErrorCode,
  error: string,
  fields?: AuditErrorReply['fields']
): void {
  const body: AuditErrorReply = fields ? { error, code, fields } : { error, code };
  sendJson(res, status, body);
}

function row(key: 'start' | 'stream', handle: Route['handle']): Route & { method: string; access: AuditAccess } {
  const { method, path: routePath, access } = AUDIT_API[key];
  // Closed on a beta copy (D-004): only 'public' Shared Link rows are served there.
  return { method, path: routePath, access, beta: 'closed', handle };
}

const defaultMakeWorkDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'qa-audit-'));

async function removeWorkDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // A leftover temp folder is not worth failing a finished audit for.
  }
}

/** The step when none is given: the crawl is all there is, so the version is marked done with its counts. */
function markCrawlDone(store: AuditRunStore, now: () => Date): AfterCrawlStep {
  return async ({ auditId, version, crawl }) => {
    await store.updateVersion(auditId, version, {
      status: 'done',
      finishedAt: now().toISOString(),
      pagesRecorded: crawl.pages.length,
      pagesSkipped: crawl.coverage.skipped.length,
      findings: 0,
    });
  };
}

/** The analysis and save pipeline (BE-192) as the step after the crawl. */
export function auditPipelineStep(deps: AuditPipelineStepDeps): AfterCrawlStep {
  const pipeline = deps.pipeline ?? runAuditPipeline;
  return async (input) => {
    let ai: AuditAiResolution = { ok: false, reason: 'no-ai-key' };
    if (deps.resolveAi) {
      try {
        ai = await deps.resolveAi();
      } catch {
        // Unreadable AI setup: the AI notes are recorded as not done; the rest of the audit still runs.
      }
    }
    // No pacer or Crawl-delay here: the pipeline uses the crawl's own (BE-204).
    await pipeline(input.crawl, {
      auditId: input.auditId,
      version: input.version,
      request: input.request,
      startedAt: input.startedAt,
      recorder: input.recorder,
      store: deps.store,
      workDir: input.workDir,
      ai,
      pageSpeed: deps.resolveServiceKey ? { resolveServiceKey: deps.resolveServiceKey } : {},
      signal: input.signal,
      onProgress: input.onProgress,
    });
  };
}

type Outcome = { kind: 'done' } | { kind: 'failed'; error: string; code: AuditErrorCode };

/** The result is stored but its status is not: set 'done' from the stored result (BE-192 'status-not-updated'). */
async function retryDoneStatus(store: AuditRunStore, run: AuditRun): Promise<Outcome> {
  try {
    const result = await store.getResult(run.auditId, run.version);
    if (result) {
      await store.updateVersion(run.auditId, run.version, {
        status: 'done',
        finishedAt: result.finishedAt,
        pagesRecorded: result.pages.length,
        pagesSkipped: result.coverage.skipped.length,
        findings: result.findings.length,
      });
      return { kind: 'done' };
    }
  } catch {
    // Falls through to the failure below; the stored result is left as it is.
  }
  return { kind: 'failed', error: AUDIT_STATUS_FAILED, code: OTHER_FAILED_CODE };
}

async function recordStatus(
  store: AuditRunStore,
  run: AuditRun,
  status: 'failed' | 'stopped',
  finishedAt: string,
  error?: string
): Promise<void> {
  try {
    await store.updateVersion(run.auditId, run.version, { status, finishedAt, ...(error ? { error } : {}) });
  } catch {
    // The store cannot be written: nothing more can be recorded. The stream still gets its final event.
  }
}

/**
 * Runs one Website Audit version that already exists in the store and holds the RunSlot (kind 'audit'):
 * crawl, then the after-crawl step, then the final event. Never throws. The slot is released and the working
 * folder removed before the final event is sent, so a client that sees 'done' can start the next run.
 */
export async function runAuditVersion(
  services: AuditRunServices,
  input: { run: AuditRun; request: AuditRequest; startedAt: string; slot: RunSlot }
): Promise<void> {
  const { run, request, startedAt, slot } = input;
  const { store } = services;
  const now = services.now ?? (() => new Date());
  const crawlFn = services.crawl ?? runAuditCrawl;
  const afterCrawl = services.afterCrawl ?? markCrawlDone(store, now);
  const signal = run.signal;
  let workDir: string | undefined;
  let crawled = false;
  let outcome: Outcome;

  try {
    workDir = await (services.makeWorkDir ?? defaultMakeWorkDir)();
    const recorder = (services.createRecorder ?? createPageRecorder)({ workDir });
    const crawl = await crawlFn(request, {
      signal,
      // The crawl redacts currentPath; the run adds the audit id and version.
      onProgress: (p) =>
        run.emit({
          type: 'progress',
          auditId: run.auditId,
          version: run.version,
          stage: p.stage,
          pagesFound: p.pagesFound,
          pagesRecorded: p.pagesRecorded,
          pagesSkipped: p.pagesSkipped,
          ...(p.currentPath !== undefined ? { currentPath: p.currentPath } : {}),
        }),
      onRenderedPage: recorder.onRenderedPage,
    });
    crawled = true;
    if (signal.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
    await afterCrawl({
      auditId: run.auditId,
      version: run.version,
      request,
      startedAt,
      crawl,
      recorder,
      workDir,
      signal,
      onProgress: (event) => run.emit(event),
    });
    outcome = { kind: 'done' };
  } catch (err) {
    const finishedAt = now().toISOString();
    if (isAbortError(err) || signal.aborted) {
      // A stop is neither done nor failed.
      await recordStatus(store, run, 'stopped', finishedAt);
      outcome = { kind: 'failed', error: AUDIT_STOPPED, code: OTHER_FAILED_CODE };
    } else if (err instanceof AuditPipelineError && err.code === 'status-not-updated') {
      // The result IS stored: never mark it failed.
      outcome = await retryDoneStatus(store, run);
    } else if (!crawled) {
      await recordStatus(store, run, 'failed', finishedAt, AUDIT_CRAWL_FAILED);
      outcome = { kind: 'failed', error: AUDIT_CRAWL_FAILED, code: CRAWL_FAILED_CODE };
    } else {
      await recordStatus(store, run, 'failed', finishedAt, AUDIT_SAVE_FAILED);
      outcome = { kind: 'failed', error: AUDIT_SAVE_FAILED, code: OTHER_FAILED_CODE };
    }
  }

  if (workDir) await removeWorkDir(workDir);
  if (slot.kind === 'audit') slot.release();
  run.emit(
    outcome.kind === 'done'
      ? { type: 'done', auditId: run.auditId, version: run.version }
      : { type: 'failed', auditId: run.auditId, version: run.version, error: outcome.error, code: outcome.code }
  );
}

/** `?version=`: absent means the run's own; anything but a whole number from 1 is refused. */
function versionQuery(url: URL): number | undefined | 'invalid' {
  const raw = url.searchParams.get('version');
  if (raw === null) return undefined;
  return /^[1-9][0-9]{0,6}$/.test(raw) ? Number(raw) : 'invalid';
}

/** The start and stream rows with every dependency injectable (tests use a fake crawl and address check). */
export function createAuditCrawlRoutes(deps: AuditCrawlRouteDeps): Route[] {
  const runs = deps.runs ?? new AuditRuns();
  const slotOf = deps.slot ?? ((context: RouteContext) => context.server.session.run);
  const checkAddress = deps.checkAddress ?? ((url: string) => checkAuditAddress(url));

  const start = row('start', async (context) => {
    const { req, res } = context;
    const caller = await deps.caller(context);
    if (!caller.owner) return refuse(res, 403, 'ERR_FORBIDDEN', AUDIT_FORBIDDEN_START);

    let body: unknown;
    try {
      body = await readJsonBody<unknown>(req, MAX_START_BODY_CHARS);
    } catch {
      return refuse(res, 400, 'ERR_INVALID_REQUEST', AUDIT_BAD_BODY);
    }
    const check = validateAuditStartBody(body);
    if (!check.ok) return refuse(res, 400, 'ERR_INVALID_AUDIT', AUDIT_INVALID, check.errors);
    const request = check.value;

    // Busy now: answer before spending a network check on it. Claimed for real after the check, below.
    const slot = slotOf(context);
    if (slot.kind !== null) return refuse(res, 409, 'ERR_RUN_IN_PROGRESS', AUDIT_BUSY);

    let address: AuditAddressResult;
    try {
      address = await checkAddress(request.url);
    } catch {
      address = { ok: false, code: 'ERR_UNREACHABLE', reason: AUDIT_UNREACHABLE };
    }
    if (!address.ok) {
      if (address.code === 'ERR_PRIVATE_ADDRESS') return refuse(res, 400, 'ERR_PRIVATE_ADDRESS', address.reason);
      return refuse(res, 422, 'ERR_UNREACHABLE', address.reason);
    }

    // Synchronous claim, no await before it after the check (BE-103).
    if (!slot.begin(`audit-${randomUUID()}`, request.url, 'audit')) {
      return refuse(res, 409, 'ERR_RUN_IN_PROGRESS', AUDIT_BUSY);
    }

    let run: AuditRun;
    let startedAt: string;
    try {
      const version = await deps.store.createAudit(request);
      run = runs.start(version.auditId, version.version);
      startedAt = version.startedAt;
    } catch {
      if (slot.kind === 'audit') slot.release();
      sendJson(res, 500, { error: AUDIT_START_FAILED });
      return;
    }

    const reply: AuditStartReply = { auditId: run.auditId, version: run.version };
    sendJson(res, 202, reply);
    void runAuditVersion(deps, { run, request, startedAt, slot });
  });

  const stream = row('stream', async (context) => {
    const { req, res } = context;
    const auditId = context.params?.id ?? '';
    if (!AUDIT_ID_PATTERN.test(auditId)) return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND_STREAM);
    const wanted = versionQuery(context.url);
    if (wanted === 'invalid') {
      return refuse(res, 400, 'ERR_INVALID_REQUEST', 'The version must be a whole number from 1.');
    }
    const caller = await deps.caller(context);
    // A Helper without a 'view' grant gets the same answer as for an audit that does not exist.
    let allowed: boolean;
    try {
      allowed = await mayUseAudit(deps.store as AuditStore, caller, auditId, 'view');
    } catch {
      allowed = false;
    }
    const run = allowed ? runs.get(auditId) : undefined;
    if (!run || (wanted !== undefined && wanted !== run.version)) {
      return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND_STREAM);
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: AuditProgressEvent) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'done' || event.type === 'failed') res.end();
    };
    // The last event first (a late subscriber catches up), then every later one.
    const unsubscribe = run.subscribe(send);
    req.on('close', unsubscribe);
  });

  return [start, stream];
}

/**
 * The production rows: the analysis and save pipeline runs after the crawl unless `afterCrawl` is given.
 * BE-190 registers them: `...auditCrawlRoutes({ store, caller, runs, resolveAi, resolveServiceKey })`.
 */
export function auditCrawlRoutes(deps: AuditCrawlRouteDeps & Omit<AuditPipelineStepDeps, 'store' | 'pipeline'> & { store: AuditStore }): Route[] {
  return createAuditCrawlRoutes({
    ...deps,
    afterCrawl:
      deps.afterCrawl ??
      auditPipelineStep({ store: deps.store, resolveAi: deps.resolveAi, resolveServiceKey: deps.resolveServiceKey }),
  });
}
