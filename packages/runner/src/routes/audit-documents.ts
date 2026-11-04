import type http from 'http';
import {
  AUDIT_API,
  type AuditEditsPatch,
  type AuditEditsReply,
  type AuditErrorCode,
  type AuditErrorReply,
  type AuditResult,
  type EditOverlay,
  type PageContent,
} from '@qa/types';
import {
  AuditRecordError,
  AuditStoreError,
  emptyOverlay,
  mergeEditsPatch,
  pageContentName,
  validateAuditEditsPatch,
  type AuditStore,
} from '@qa/core';
import type { Route, RouteContext } from './route.js';
import { readJsonBody, sendJson } from './body.js';

/** What the Audit Document rows need: the Website Audit store (G6). */
export interface AuditDocumentDeps {
  store: AuditStore;
}

/** The overlay is saved beside the version's result: `audits/<id>/v<n>/edits.json`. */
const EDITS_NAME = 'edits';
/** A patch is at most 500 items of a few thousand characters each; far below the general body cap. */
const MAX_EDITS_BODY_CHARS = 2_000_000;

function refuse(res: http.ServerResponse, status: number, code: AuditErrorCode, error: string): void {
  const body: AuditErrorReply = { error, code };
  sendJson(res, status, body);
}

const NOT_FOUND = 'This Website Audit was not found. It may have been deleted.';

/** Store failures become fixed sentences: no keys, paths or provider text reach the caller. */
function refuseStoreFailure(res: http.ServerResponse, err: unknown): void {
  if (err instanceof AuditRecordError) {
    if (err.code === 'not-found') return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', NOT_FOUND);
    return refuse(res, 400, 'ERR_INVALID_REQUEST', 'The request is not valid.');
  }
  if (err instanceof AuditStoreError && err.code === 'invalid-key') {
    return refuse(res, 400, 'ERR_INVALID_REQUEST', 'The request is not valid.');
  }
  sendJson(res, 500, { error: 'The edits could not be read or saved. Try again.' });
}

/** `?version=`: absent means the latest; anything but a whole number from 1 is refused. */
function versionQuery(url: URL): number | undefined | 'invalid' {
  const raw = url.searchParams.get('version');
  if (raw === null) return undefined;
  if (!/^[1-9][0-9]{0,6}$/.test(raw)) return 'invalid';
  return Number(raw);
}

/** Writes to one version's edits go one at a time, so two saves never overwrite each other. */
const saveQueues = new Map<string, Promise<unknown>>();
function serialised<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (saveQueues.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => undefined);
  saveQueues.set(key, tail);
  void tail.then(() => {
    if (saveQueues.get(key) === tail) saveQueues.delete(key);
  });
  return run;
}

interface Target {
  auditId: string;
  version: number;
}

/** The version asked for (latest by default), or null after the refusal was sent. */
async function resolveTarget(store: AuditStore, c: RouteContext): Promise<Target | null> {
  const auditId = c.params?.id;
  const wanted = versionQuery(c.url);
  if (!auditId) {
    refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', NOT_FOUND);
    return null;
  }
  if (wanted === 'invalid') {
    refuse(c.res, 400, 'ERR_INVALID_REQUEST', 'The version must be a whole number from 1.');
    return null;
  }
  const record = await store.readAuditRecord(auditId);
  const version = wanted ?? record?.latestVersion;
  if (!record || version === undefined || (await store.getVersion(auditId, version)) === null) {
    refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', NOT_FOUND);
    return null;
  }
  return { auditId, version };
}

async function readOverlay(store: AuditStore, t: Target): Promise<EditOverlay> {
  return (await store.readVersionJson<EditOverlay>(t.auditId, t.version, EDITS_NAME)) ?? emptyOverlay();
}

/**
 * The one way to change a version's edits overlay: read, apply `mutate`, save and set the edited flag, all on
 * the version's save queue. PATCH and the rewrite "accept" both use it, so concurrent changes are never lost.
 */
export function updateEditsOverlay(
  store: AuditStore,
  auditId: string,
  version: number,
  mutate: (current: EditOverlay) => EditOverlay | Promise<EditOverlay>
): Promise<EditOverlay> {
  return serialised(`${auditId}/${version}`, async () => {
    const next = await mutate(await readOverlay(store, { auditId, version }));
    await store.writeVersionJson(auditId, version, EDITS_NAME, next);
    await store.updateVersion(auditId, version, { edited: true });
    return next;
  });
}

/** The first finding, page or Section of the patch that the version does not have, as a sentence. */
async function unknownReference(
  store: AuditStore,
  t: Target,
  result: AuditResult,
  patch: AuditEditsPatch
): Promise<string | null> {
  const findingIds = new Set(result.findings.map((f) => f.id));
  const pages = new Set(result.pages.map((p) => p.urlPath));

  for (const f of patch.findings ?? []) {
    if (!findingIds.has(f.findingId)) return `Finding ${f.findingId} is not in this version.`;
  }
  const pagePaths = [
    ...(patch.removePages ?? []),
    ...(patch.restorePages ?? []),
    ...(patch.recommendations ?? []).map((r) => r.urlPath),
    ...(patch.sections ?? []).map((s) => s.urlPath),
  ];
  for (const p of pagePaths) if (!pages.has(p)) return `The page ${p} is not in this version.`;
  if (result.hierarchy?.root && (patch.removePages ?? []).includes(result.hierarchy.root.urlPath)) {
    return 'The start page cannot be removed.';
  }

  const contents = new Map<string, PageContent | null>();
  for (const s of patch.sections ?? []) {
    if (!contents.has(s.urlPath)) {
      contents.set(s.urlPath, await store.readVersionJson<PageContent>(t.auditId, t.version, pageContentName(s.urlPath)));
    }
    const content = contents.get(s.urlPath);
    if (!content || !content.sections.some((x) => x.id === s.sectionId)) {
      return `The page ${s.urlPath} has no Section ${s.sectionId}.`;
    }
  }
  return null;
}

/**
 * The edits rows (REQ-020): the saved overlay of a version, and the save. The overlay sits beside the
 * version's result; the result itself is never written (Q-25). BE-190 registers these in the route table.
 */
export function auditEditsRoutes(deps: AuditDocumentDeps): Route[] {
  const { store } = deps;

  const getEdits = async (c: RouteContext): Promise<void> => {
    try {
      const target = await resolveTarget(store, c);
      if (!target) return;
      const reply: AuditEditsReply = { edits: await readOverlay(store, target) };
      sendJson(c.res, 200, reply);
    } catch (err) {
      refuseStoreFailure(c.res, err);
    }
  };

  const patchEdits = async (c: RouteContext): Promise<void> => {
    try {
      const target = await resolveTarget(store, c);
      if (!target) return;
      const version = await store.getVersion(target.auditId, target.version);
      if (version?.status === 'running') {
        return refuse(c.res, 409, 'ERR_AUDIT_RUNNING', 'This version of the Website Audit is still running. Review it when it has finished.');
      }

      let body: unknown;
      try {
        body = await readJsonBody<unknown>(c.req, MAX_EDITS_BODY_CHARS);
      } catch {
        return refuse(c.res, 400, 'ERR_INVALID_REQUEST', 'The edits are not valid JSON or are too large.');
      }
      const checked = validateAuditEditsPatch(body);
      if (!checked.ok) {
        const first = Object.entries(checked.errors)[0];
        return sendJson(c.res, 400, {
          error: first ? `${first[0]}: ${first[1]}` : 'The edits are not valid.',
          code: 'ERR_INVALID_REQUEST',
          fields: checked.errors,
        });
      }

      const result = await store.getResult(target.auditId, target.version);
      if (!result) return refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', NOT_FOUND);
      const unknown = await unknownReference(store, target, result, checked.value);
      if (unknown) return refuse(c.res, 400, 'ERR_INVALID_REQUEST', unknown);

      const edits = await updateEditsOverlay(store, target.auditId, target.version, (current) =>
        mergeEditsPatch(current, checked.value, new Date())
      );
      const reply: AuditEditsReply = { edits };
      sendJson(c.res, 200, reply);
    } catch (err) {
      refuseStoreFailure(c.res, err);
    }
  };

  return [
    { method: AUDIT_API.getEdits.method, path: AUDIT_API.getEdits.path, access: AUDIT_API.getEdits.access, handle: getEdits },
    { method: AUDIT_API.patchEdits.method, path: AUDIT_API.patchEdits.path, access: AUDIT_API.patchEdits.access, handle: patchEdits },
  ];
}
