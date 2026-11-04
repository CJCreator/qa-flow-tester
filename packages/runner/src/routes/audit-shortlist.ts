import { AUDIT_API, isShortlistOutcome, type ShortlistListReply, type ShortlistReply } from '@qa/types';
import { AuditRecordError, isShortlistMark, type ShortlistFilter } from '@qa/core';
import type { Route } from './route.js';
import { readJsonBody, sendJson } from './body.js';
import {
  AUDIT_FORBIDDEN,
  AUDIT_NOT_FOUND,
  grantedAuditIds,
  mayUseAudit,
  refuse,
  refuseStoreFailure,
  type AuditRouteDeps,
} from './audit-store.js';

/** A Shortlist update is a few short fields (notes at most 4000 characters, plus JSON). */
const MAX_SHORTLIST_BODY_CHARS = 20_000;

function row(key: 'getShortlist' | 'putShortlist' | 'listShortlist', handle: Route['handle']): Route {
  const { method, path, access } = AUDIT_API[key];
  return { method, path, access, handle };
}

/** AUDIT_API getShortlist, putShortlist and listShortlist (REQ-023). */
export function auditShortlistRoutes(deps: Pick<AuditRouteDeps, 'store' | 'caller'>): Route[] {
  const { store } = deps;

  return [
    row('getShortlist', async (context) => {
      const { res } = context;
      try {
        const auditId = context.params?.id ?? '';
        const caller = await deps.caller(context);
        if (!(await mayUseAudit(store, caller, auditId, 'view'))) {
          return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
        }
        if (!(await store.readAuditRecord(auditId))) return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
        // An audit with no entry yet reads as an empty one, so the screen has one shape to show.
        const entry = (await store.getShortlist(auditId)) ?? {
          auditId,
          mark: null,
          notes: '',
          outcome: null,
          outcomeNote: '',
          updatedAt: '',
        };
        const reply: ShortlistReply = { entry };
        sendJson(res, 200, reply);
      } catch (err) {
        refuseStoreFailure(res, err);
      }
    }),

    row('putShortlist', async (context) => {
      const { res } = context;
      try {
        const auditId = context.params?.id ?? '';
        const caller = await deps.caller(context);
        if (!caller.owner && !(await mayUseAudit(store, caller, auditId, 'view'))) {
          return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
        }
        if (!(await mayUseAudit(store, caller, auditId, 'edit'))) {
          return refuse(res, 403, 'ERR_FORBIDDEN', AUDIT_FORBIDDEN);
        }
        let body: unknown;
        try {
          body = await readJsonBody<unknown>(context.req, MAX_SHORTLIST_BODY_CHARS);
        } catch {
          return refuse(res, 400, 'ERR_INVALID_REQUEST', 'The Shortlist update must be JSON and not too long.');
        }
        try {
          const entry = await store.putShortlist(auditId, body as never);
          const reply: ShortlistReply = { entry };
          sendJson(res, 200, reply);
        } catch (err) {
          // The store's own messages name the field ("The mark must be pitch or skip."): fixed text, safe to show.
          if (err instanceof AuditRecordError && err.code === 'invalid-input') {
            return refuse(res, 400, 'ERR_INVALID_REQUEST', err.message);
          }
          throw err;
        }
      } catch (err) {
        refuseStoreFailure(res, err);
      }
    }),

    row('listShortlist', async (context) => {
      const { res } = context;
      try {
        const filter: ShortlistFilter = {};
        const mark = context.url.searchParams.get('mark');
        if (mark !== null) {
          if (!isShortlistMark(mark)) return refuse(res, 400, 'ERR_INVALID_REQUEST', 'The mark must be pitch or skip.');
          filter.mark = mark;
        }
        const outcome = context.url.searchParams.get('outcome');
        if (outcome !== null) {
          if (!isShortlistOutcome(outcome)) {
            return refuse(res, 400, 'ERR_INVALID_REQUEST', 'The outcome is not one of the listed outcomes.');
          }
          filter.outcome = outcome;
        }
        const caller = await deps.caller(context);
        const ids = await grantedAuditIds(store, caller, 'view');
        const all = await store.listShortlist(filter);
        const entries = ids === null ? all : all.filter((e) => ids.has(e.auditId));
        const reply: ShortlistListReply = { entries };
        sendJson(res, 200, reply);
      } catch (err) {
        refuseStoreFailure(res, err);
      }
    }),
  ];
}
