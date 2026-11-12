/**
 * Check-up schedule rows (ADR 0039, amends ADR 0037): the owner's list, add, pause and delete; on the hosted
 * copy only an owner signed in with an AUDIT_OWNER_EMAILS Google account reaches them (the access key is shared
 * by every tester there, T-298), and the tick the Cloud Scheduler job calls. Schedule ids (`sched_<ts>_<rand>`) are not
 * audit ids, so the id rows are prefix rows and the handler reads the id itself.
 */
import type { Route, RouteContext } from './route.js';
import { readJsonBody, sendJson } from './body.js';

const SCHEDULES_PATH = '/api/runner/schedules';
const SCHEDULE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Fixed wording: a store failure never shows what the store said. */
const STORE_FAILED = 'The schedules could not be read or saved. Try again in a moment.';
const NOT_FOUND = { error: 'Schedule not found' };

/** The id in `/api/runner/schedules/<id>[/toggle]`, or null when the path is not that shape. */
function idFrom(pathname: string, suffix: '' | '/toggle'): string | null {
  const rest = pathname.slice(`${SCHEDULES_PATH}/`.length);
  const raw = suffix && rest.endsWith(suffix) ? rest.slice(0, -suffix.length) : suffix ? null : rest;
  if (raw === null) return null;
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return SCHEDULE_ID.test(id) ? id : null;
}

/** Runs a handler; any failure (a store that is down) is one fixed 500, nothing else leaks. */
async function guarded(context: RouteContext, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch {
    if (!context.res.headersSent) sendJson(context.res, 500, { error: STORE_FAILED, code: 'ERR_SCHEDULE_STORE' });
  }
}

export const scheduleRoutes: readonly Route[] = [
  {
    method: 'POST',
    path: `${SCHEDULES_PATH}/tick`,
    access: 'scheduler',
    beta: 'allow',
    handle: (context) =>
      guarded(context, async () => {
        const { started, failed, skipped, busy } = await context.server.runScheduleTick();
        sendJson(context.res, 200, { started, failed, skipped, busy });
      }),
  },
  {
    method: 'GET',
    path: SCHEDULES_PATH,
    access: 'owner',
    handle: (context) => guarded(context, async () => sendJson(context.res, 200, await context.server.listSchedules())),
  },
  {
    method: 'POST',
    path: SCHEDULES_PATH,
    access: 'owner',
    handle: (context) => guarded(context, () => context.server.addScheduleFromRequest(context.req, context.res)),
  },
  {
    method: 'POST',
    path: `${SCHEDULES_PATH}/`,
    prefix: true,
    access: 'owner',
    handle: (context) =>
      guarded(context, async () => {
        const id = idFrom(context.url.pathname, '/toggle');
        if (!id) return sendJson(context.res, 404, NOT_FOUND);
        const body = await readJsonBody<{ enabled?: unknown }>(context.req).catch(() => ({ enabled: true }));
        const enabled = typeof body.enabled === 'boolean' ? body.enabled : true;
        const updated = await context.server.toggleScheduleById(id, enabled);
        sendJson(context.res, updated ? 200 : 404, updated ?? NOT_FOUND);
      }),
  },
  {
    method: 'DELETE',
    path: `${SCHEDULES_PATH}/`,
    prefix: true,
    access: 'owner',
    handle: (context) =>
      guarded(context, async () => {
        const id = idFrom(context.url.pathname, '');
        if (!id) return sendJson(context.res, 404, { ok: false });
        const ok = await context.server.deleteScheduleById(id);
        sendJson(context.res, ok ? 200 : 404, { ok });
      }),
  },
];
