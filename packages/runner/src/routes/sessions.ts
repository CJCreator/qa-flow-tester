/**
 * The Cloud Scheduler's visitor cleanup (ADR 0039, M3): forgets visitor sessions and their folders idle for 24
 * hours. Same access as the schedule tick: only a valid Google-signed token from the scheduler service account.
 */
import type { Route, RouteContext } from './route.js';
import { sendJson } from './body.js';

const CLEANUP_PATH = '/api/runner/sessions/cleanup';

/** Fixed wording: a failure never shows what went wrong. */
const CLEANUP_FAILED = 'The visitor sessions could not be cleaned up. Try again in a moment.';

export const sessionRoutes: readonly Route[] = [
  {
    method: 'POST',
    path: CLEANUP_PATH,
    access: 'scheduler',
    beta: 'allow',
    handle: async (context: RouteContext) => {
      try {
        const { sessions, folders } = await context.server.purgeVisitorSessions();
        sendJson(context.res, 200, { sessions, folders });
      } catch {
        if (!context.res.headersSent)
          sendJson(context.res, 500, { error: CLEANUP_FAILED, code: 'ERR_SESSION_CLEANUP' });
      }
    },
  },
];
