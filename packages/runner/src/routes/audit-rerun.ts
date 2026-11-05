/**
 * Website Audit re-run (REQ-028 AC-3): `POST /api/audits/:id/rerun` (owner only).
 *
 * Adds the next version of a saved audit with the latest version's address, limits and language, and runs it
 * through the same background run as the start route (`runAuditVersion`, BE-205). The saved address is checked
 * again first (it may have gone private or offline since). Order of answers: not the owner 403; unknown audit
 * 404; latest version still running 409 ERR_AUDIT_RUNNING; slot held by a Check-up, benchmark or audit 409
 * ERR_RUN_IN_PROGRESS (no version is added); address problems 400/422. Once the version exists, a start failure
 * marks it failed with fixed wording and releases the slot.
 *
 * Not registered here: BE-190 adds `...auditRerunRoutes({ store, caller, runs, resolveAi, resolveServiceKey })`
 * to allRoutes, with the same `runs` instance as the start route.
 */
import { randomUUID } from 'node:crypto';
import {
  AUDIT_API,
  AUDIT_ID_PATTERN,
  type AuditAccess,
  type AuditErrorCode,
  type AuditErrorReply,
  type AuditRequest,
  type AuditStartReply,
} from '@qa/types';
import { checkAuditAddress, type AuditAddressResult, type AuditStore } from '@qa/core';
import type { Route, RouteContext } from './route.js';
import { sendJson } from './body.js';
import type { AuditCaller } from './audit-store.js';
import {
  AUDIT_BUSY,
  AUDIT_FORBIDDEN_START,
  AUDIT_NOT_FOUND_STREAM,
  AUDIT_START_FAILED,
  AUDIT_UNREACHABLE,
  auditPipelineStep,
  runAuditVersion,
  type AuditAddressCheck,
  type AuditPipelineStepDeps,
  type AuditRunServices,
} from './audit-crawl.js';
import type { RunSlot } from '../session/run-slot.js';
import { AuditRun, AuditRuns } from '../session/audit-run.js';

export const AUDIT_RERUN_FORBIDDEN = 'Only the owner of this QA Tool can run a Website Audit again.';
export const AUDIT_RERUN_RUNNING = 'This Website Audit is still running. Run it again when it has finished.';

type RerunStore = Pick<AuditStore, 'getAudit' | 'addVersion'> & AuditRunServices['store'];

/** Starts the background run of a version that exists and holds the slot. Default: runAuditVersion. */
export type AuditStarter = (
  services: AuditRunServices,
  input: { run: AuditRun; request: AuditRequest; startedAt: string; slot: RunSlot }
) => Promise<void>;

export interface AuditRerunRouteDeps extends Omit<AuditRunServices, 'store'> {
  store: RerunStore;
  caller: (context: RouteContext) => AuditCaller | Promise<AuditCaller>;
  slot?: (context: RouteContext) => RunSlot;
  checkAddress?: AuditAddressCheck;
  /** Share one instance with the start route. */
  runs?: AuditRuns;
  /** Is a version of this audit running now? Default: a live, unfinished run of its latest version in `runs`. */
  isRunning?: (auditId: string) => boolean | Promise<boolean>;
  /** Test seam: the audit starter. Default: runAuditVersion. */
  start?: AuditStarter;
}

function refuse(res: Parameters<typeof sendJson>[0], status: number, code: AuditErrorCode, error: string): void {
  const body: AuditErrorReply = { error, code };
  sendJson(res, status, body);
}

export function createAuditRerunRoutes(deps: AuditRerunRouteDeps): Route[] {
  const runs = deps.runs ?? new AuditRuns();
  const slotOf = deps.slot ?? ((context: RouteContext) => context.server.session.run);
  const checkAddress =
    deps.checkAddress ??
    ((url: string) => checkAuditAddress(url, { allowPrivateAddresses: deps.allowPrivateAddresses === true }));
  const starter = deps.start ?? runAuditVersion;
  const { method, path: routePath, access } = AUDIT_API.rerun;

  const handle: Route['handle'] = async (context) => {
    const { res } = context;
    const caller = await deps.caller(context);
    if (!caller.owner) return refuse(res, 403, 'ERR_FORBIDDEN', AUDIT_RERUN_FORBIDDEN);

    const auditId = context.params?.id ?? '';
    if (!AUDIT_ID_PATTERN.test(auditId)) return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND_STREAM);

    let request: AuditRequest;
    try {
      const audit = await deps.store.getAudit(auditId);
      const latest = audit?.versions[audit.versions.length - 1];
      if (!audit || !latest) return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND_STREAM);
      // Running means a live run of this runner, not a stored "running" status: a version left so by a stop or
      // crash must not block a re-run for ever.
      const live = runs.get(auditId);
      const running = deps.isRunning
        ? await deps.isRunning(auditId)
        : live !== undefined && live.version === latest.version && !live.finished;
      if (running) return refuse(res, 409, 'ERR_AUDIT_RUNNING', AUDIT_RERUN_RUNNING);
      request = { url: latest.url, limits: latest.limits, language: latest.language };
    } catch {
      return sendJson(res, 500, { error: AUDIT_START_FAILED });
    }

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

    let version: Awaited<ReturnType<RerunStore['addVersion']>> | undefined;
    let started: Promise<void>;
    let run: AuditRun | undefined;
    const endRun = () =>
      run?.emit({
        type: 'failed',
        auditId,
        version: run.version,
        error: AUDIT_START_FAILED,
        code: 'ERR_INVALID_REQUEST',
      });
    try {
      version = await deps.store.addVersion(auditId);
      run = runs.start(auditId, version.version);
      started = starter(deps, { run, request, startedAt: version.startedAt, slot });
    } catch {
      endRun();
      await failVersion(deps.store, auditId, version?.version, deps.now);
      if (slot.kind === 'audit') slot.release();
      return sendJson(res, 500, { error: AUDIT_START_FAILED });
    }

    const reply: AuditStartReply = { auditId, version: version.version };
    sendJson(res, 202, reply);
    const versionNumber = version.version;
    // runAuditVersion never rejects; a starter that does leaves the version failed and the slot free.
    started.catch(async () => {
      endRun();
      await failVersion(deps.store, auditId, versionNumber, deps.now);
      if (slot.kind === 'audit') slot.release();
    });
  };

  return [{ method, path: routePath, access: access as AuditAccess, beta: 'closed', handle }];
}

async function failVersion(
  store: AuditRunServices['store'],
  auditId: string,
  version: number | undefined,
  now: (() => Date) | undefined
): Promise<void> {
  if (version === undefined) return;
  try {
    await store.updateVersion(auditId, version, {
      status: 'failed',
      finishedAt: (now ?? (() => new Date()))().toISOString(),
      error: AUDIT_START_FAILED,
    });
  } catch {
    // The store cannot be written: nothing more can be recorded.
  }
}

/** The production row: the analysis and save pipeline runs after the crawl unless `afterCrawl` is given. */
export function auditRerunRoutes(
  deps: AuditRerunRouteDeps & Omit<AuditPipelineStepDeps, 'store' | 'pipeline'> & { store: AuditStore }
): Route[] {
  return createAuditRerunRoutes({
    ...deps,
    afterCrawl:
      deps.afterCrawl ??
      auditPipelineStep({ store: deps.store, resolveAi: deps.resolveAi, resolveServiceKey: deps.resolveServiceKey }),
  });
}
