import path from 'node:path';
import {
  AUDIT_AI_API,
  AUDIT_AI_STAGES,
  AUDIT_API,
  type AuditEndpoint,
  type EditOverlay,
  type PageContent,
} from '@qa/types';
import {
  AuditAiModelsStore,
  RewriteStore,
  applySettingsUpdate,
  emptyAuditSettings,
  generatePreview,
  pageContentName,
  resolveAuditAi,
  resolveAuditSettings,
  versionFolder,
  type LocalAuditStoreBackend,
  type PageSpeedDeps,
} from '@qa/core';
import type { Route, RouteContext } from './route.js';
import { sendNotFound } from './route.js';
import type { RunnerServer } from '../server.js';
import { planRoutes } from './plan.js';
import { AuditRuns } from '../session/audit-run.js';
import { auditCrawlRoutes } from './audit-crawl.js';
import { auditContentRoutes } from './audit-content.js';
import { auditRerunRoutes } from './audit-rerun.js';
import { auditStoreRoutes, type AuditCaller } from './audit-store.js';
import { auditEditsRoutes, updateEditsOverlay } from './audit-documents.js';
import { auditSettingsRoutes, auditSettingsStoreOn, type PagespeedKeyPort } from './audit-settings.js';
import { auditExportRoutes } from './audit-export.js';
import { auditPreviewRoutes } from './audit-preview.js';
import { auditShareRoutes } from './audit-share.js';
import { auditShortlistRoutes } from './audit-shortlist.js';
import { auditHelperRoutes } from './audit-helpers.js';
import { createAuditAiRoutes, type AuditAiRouteDeps } from './audit-ai.js';

export type {
  Route,
  RouteContext,
  RouteParams,
  RouteMatch,
  RouteBetaPolicy,
  RouteCaller,
  RouteDecision,
  HelperPermission,
} from './route.js';
export {
  matchRoute,
  resolveRoute,
  authorizeRoute,
  isLoopbackAddress,
  sendNotFound,
  notFound,
  fallbackNotFound,
  ACCESS_KEY_REFUSAL,
  BETA_REFUSAL,
  CLOSED_REFUSAL,
} from './route.js';
export { MAX_BODY_CHARS, readJsonBody, sendJson } from './body.js';
export * from './plan.js';
export * from './audit-ai.js';
export * from './audit-crawl.js';
export * from './audit-content.js';
export * from './audit-documents.js';
export * from './audit-export.js';
export * from './audit-helpers.js';
export * from './audit-preview.js';
export * from './audit-rerun.js';
export * from './audit-settings.js';
export * from './audit-share.js';
export * from './audit-shortlist.js';
export * from './audit-store.js';

/** One shared AuditRuns per runner: the start and re-run rows, and a stop at shutdown, see the same runs. */
const auditRunsByServer = new WeakMap<RunnerServer, AuditRuns>();
const auditRowsByServer = new WeakMap<RunnerServer, Map<string, Route>>();

const rowKey = (method: string, path: string) => `${method} ${path}`;

/**
 * The real audit rows of one runner, built on first use with the runner's data folder, key resolver and
 * Helper access. Rows are keyed by `METHOD path`.
 */
export function buildAuditRoutes(server: RunnerServer): Route[] {
  const wiring = server.auditWiring;
  const { dataDir, store, keys, helperAccess } = wiring;
  const backend = store.backend;
  const settings = auditSettingsStoreOn(backend);
  const modelsStore = new AuditAiModelsStore(dataDir);
  const runs = auditRunsByServer.get(server) ?? new AuditRuns();
  auditRunsByServer.set(server, runs);

  const caller = (context: RouteContext): AuditCaller => {
    if (wiring.isOwnerRequest(context.req)) return { owner: true };
    const email = helperAccess.session(context.req)?.email;
    return email ? { owner: false, helperEmail: email } : { owner: false };
  };

  const readModels = () => modelsStore.read();
  const resolveAi = async () =>
    resolveAuditAi({ setup: await wiring.readAiModels(), keys, models: await readModels() });
  const resolveServiceKey: PageSpeedDeps['resolveServiceKey'] = (service) => keys.resolveServiceKey(service);

  const pagespeedKey: PagespeedKeyPort = {
    saved: async () => (await keys.resolveServiceKey('pagespeed')) !== null,
    save: async (key) => {
      if (key === null) await keys.removeServiceKey('pagespeed');
      else await keys.saveServiceKey('pagespeed', key);
    },
  };

  const storedSettings = async () => {
    const raw = await settings.load();
    const checked = raw ? applySettingsUpdate(emptyAuditSettings(), raw) : null;
    return resolveAuditSettings(checked?.ok ? checked.settings : emptyAuditSettings(), false);
  };

  const findVersion: AuditAiRouteDeps['findVersion'] = async (auditId, version) => {
    const audit = await store.getAudit(auditId);
    const v = version === undefined ? audit?.versions[audit.versions.length - 1] : audit?.versions.find((x) => x.version === version);
    return v ? { version: v.version, status: v.status, language: v.language } : null;
  };

  /** Rewrite state is a local file per version; a cloud store keeps it under the runner data folder. */
  const rewriteStoreFor = (auditId: string, version: number): RewriteStore => {
    const folder = versionFolder(auditId, version).split('/');
    const dir =
      backend.kind === 'local'
        ? path.join((backend as LocalAuditStoreBackend).root, ...folder)
        : path.join(dataDir, 'audit-rewrites', ...folder);
    return new RewriteStore(dir);
  };

  return [
    ...auditCrawlRoutes({ store, caller, runs, resolveAi, resolveServiceKey }),
    ...auditRerunRoutes({ store, caller, runs, resolveAi, resolveServiceKey }),
    ...auditStoreRoutes({
      store,
      caller,
      isRunning: (auditId) => {
        const run = runs.get(auditId);
        return run !== undefined && !run.finished;
      },
    }),
    ...auditEditsRoutes({ store }),
    ...auditContentRoutes({ store, caller }),
    ...auditSettingsRoutes({ settings, pagespeedKey }),
    ...auditExportRoutes({ store, settings }),
    ...auditPreviewRoutes({ store, caller, resolveAi, generate: generatePreview }),
    ...auditShareRoutes({ store, caller, optOutText: async () => (await storedSettings()).optOutText }),
    ...auditShortlistRoutes({ store, caller }),
    ...auditHelperRoutes({ store, access: helperAccess }),
    ...createAuditAiRoutes({
      readModels,
      writeModels: async (models) => {
        const body: Record<string, string | null> = {};
        for (const stage of AUDIT_AI_STAGES) body[stage] = models[stage] ?? null;
        const saved = await modelsStore.update({ models: body });
        if (!saved.ok) throw new Error('The AI models could not be saved.');
      },
      aiDefaults: async () => {
        const setup = await wiring.readAiModels();
        return { text: setup.text, vision: setup.vision };
      },
      hasAiKey: async () => (await resolveAi()).ok,
      findVersion,
      rewrites: (auditId, version) => {
        const rewrites = rewriteStoreFor(auditId, version);
        return {
          list: () => rewrites.list(),
          approve: (s) => rewrites.approve(s),
          run: (i, d) => rewrites.run(i, { ...d, resolveAi }),
          accept: (i, d) => rewrites.accept(i, d),
        };
      },
      loadSection: (auditId, version, urlPath) =>
        store.readVersionJson<PageContent>(auditId, version, pageContentName(urlPath)),
      applyRewriteEdit: (auditId, version, edit) =>
        updateEditsOverlay(store, auditId, version, (current): EditOverlay => {
          const sections = current.sections.filter(
            (s) => !(s.urlPath === edit.urlPath && s.sectionId === edit.sectionId)
          );
          return { ...current, sections: [...sections, edit], updatedAt: edit.editedAt };
        }),
      overlapWords: async () => (await storedSettings()).rewriteOverlapWords,
    }),
  ];
}

function rowsFor(server: RunnerServer): Map<string, Route> {
  let rows = auditRowsByServer.get(server);
  if (!rows) {
    rows = new Map();
    for (const route of buildAuditRoutes(server)) {
      for (const path of Array.isArray(route.path) ? route.path : [route.path]) {
        rows.set(rowKey((route.method ?? 'GET').toUpperCase(), path), route);
      }
    }
    auditRowsByServer.set(server, rows);
  }
  return rows;
}

/**
 * One table row per Website Audit contract entry. Method, path, access and beta policy are declared here
 * from the contract (D-004: only 'public' rows are served on a beta copy); the handler is the real row,
 * built for the runner on first use (the table is static, the dependencies belong to the runner).
 */
function contractRows(): Route[] {
  const entries = Object.entries({ ...AUDIT_API, ...AUDIT_AI_API }) as Array<[string, AuditEndpoint]>;
  return entries
    .map(([, { method, path, access }]) => ({
      method,
      path,
      access,
      beta: access === 'public' ? ('allow' as const) : ('closed' as const),
      handle: (context: RouteContext) => {
        const real = rowsFor(context.server).get(rowKey(method, path));
        if (!real) return sendNotFound(context.res);
        return real.handle(context);
      },
    }));
}

export const auditRoutes: readonly Route[] = contractRows();

export const allRoutes: readonly Route[] = [...planRoutes, ...auditRoutes];
