import type http from 'http';
import {
  AUDIT_API,
  type AuditAccess,
  type AuditGetReply,
  type AuditListReply,
  type AuditSummary,
  type EditOverlay,
  type HelperPermission,
} from '@qa/types';
import { type AuditStore } from '@qa/core';
import type { Route, RouteContext } from './route.js';
import { AUDIT_NOT_FOUND, readEdits, refuse, refuseStoreFailure, versionQuery } from './audit-common.js';
import { sendJson } from './body.js';
import { allows } from '../helpers/index.js';

export { AUDIT_NOT_FOUND, refuse, refuseStoreFailure } from './audit-common.js';

/** Who is asking: the tool user, or a signed-in Helper (their Google address, from REQ-033's sign-in). */
export interface AuditCaller {
  owner: boolean;
  helperEmail?: string;
}

/** What the saved-audit and Shortlist rows need (BE-190 supplies them from the runner). */
export interface AuditRouteDeps {
  store: AuditStore;
  /** Reads the caller from the request (BE-102's route context); the owner when the access key was sent. */
  caller: (context: RouteContext) => AuditCaller | Promise<AuditCaller>;
  /** Is a version of this audit running now? Default: a stored version still marked 'running'. */
  isRunning?: (auditId: string) => boolean | Promise<boolean>;
}

export const AUDIT_FORBIDDEN = 'You do not have permission to do this on this Website Audit.';

/**
 * The audits a Helper holds `permission` on; null for the owner (all of them).
 * Uses the one permission check (`allows`): 'edit' and 'export' include 'view'.
 */
export async function grantedAuditIds(
  store: AuditStore,
  caller: AuditCaller,
  permission: HelperPermission
): Promise<Set<string> | null> {
  if (caller.owner) return null;
  if (!caller.helperEmail) return new Set();
  const grants = await store.grantsFor(caller.helperEmail);
  return new Set(grants.filter((g) => allows(g, permission)).map((g) => g.auditId));
}

/** May the caller use this audit with `permission`? Checked where the data is read, not only at dispatch. */
export async function mayUseAudit(
  store: AuditStore,
  caller: AuditCaller,
  auditId: string,
  permission: HelperPermission
): Promise<boolean> {
  const ids = await grantedAuditIds(store, caller, permission);
  return ids === null || ids.has(auditId);
}

/** Declared access comes from AUDIT_API, so a row can never drift from the contract. */
function row(key: 'list' | 'get' | 'remove', handle: Route['handle']): Route & { method: string; access: AuditAccess } {
  const { method, path, access } = AUDIT_API[key];
  return { method, path, access, handle };
}

/** AUDIT_API list, get and remove (REQ-028). */
export function auditStoreRoutes(deps: AuditRouteDeps): Route[] {
  const { store } = deps;

  const running = async (auditId: string, summary: AuditSummary | null): Promise<boolean> => {
    if (deps.isRunning) return deps.isRunning(auditId);
    return summary?.versions.some((v) => v.status === 'running') ?? false;
  };

  return [
    row('list', async (context) => {
      try {
        const caller = await deps.caller(context);
        const ids = await grantedAuditIds(store, caller, 'view');
        const all = await store.listAudits();
        const audits = ids === null ? all : all.filter((a) => ids.has(a.auditId));
        const reply: AuditListReply = { audits };
        sendJson(context.res, 200, reply);
      } catch (err) {
        refuseStoreFailure(context.res, err);
      }
    }),

    row('get', async (context) => {
      const { res } = context;
      try {
        const auditId = context.params?.id ?? '';
        const wanted = versionQuery(context.url);
        if (wanted === 'invalid') {
          return refuse(res, 400, 'ERR_INVALID_REQUEST', 'The version must be a whole number from 1.');
        }
        const caller = await deps.caller(context);
        // A Helper without the grant gets the same answer as for an audit that does not exist.
        if (!(await mayUseAudit(store, caller, auditId, 'view'))) {
          return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
        }
        const summary = await store.getAudit(auditId);
        if (!summary || summary.versions.length === 0) {
          return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
        }
        const version =
          wanted === undefined
            ? summary.versions[summary.versions.length - 1]
            : summary.versions.find((v) => v.version === wanted);
        if (!version) return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);

        const result = version.status === 'done' ? await store.getResult(auditId, version.version) : null;
        const edits = await readEdits(store, auditId, version.version);
        const reply: AuditGetReply = { summary, version, result, edits };
        sendJson(res, 200, reply);
      } catch (err) {
        refuseStoreFailure(res, err);
      }
    }),

    row('remove', async (context) => {
      const { res } = context;
      try {
        const auditId = context.params?.id ?? '';
        const caller = await deps.caller(context);
        // 'owner' only: a Helper never deletes, even with every permission.
        if (!caller.owner) return refuse(res, 403, 'ERR_FORBIDDEN', AUDIT_FORBIDDEN);
        const summary = await store.getAudit(auditId);
        if (!summary) return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
        if (await running(auditId, summary)) {
          return refuse(
            res,
            409,
            'ERR_AUDIT_RUNNING',
            'This Website Audit is still running. Stop it first, then delete it.'
          );
        }
        await store.deleteAudit(auditId);
        sendJson(res, 200, { deleted: true });
      } catch (err) {
        refuseStoreFailure(res, err);
      }
    }),
  ];
}
