/**
 * Routes that change what every tester sees; shut on a beta copy (403 ERR_BETA). Each `route` is a bullet in the
 * "Closed on the shared beta copy" list in docs/API.md; beta-closed-routes.test.ts checks that the two match.
 */
export const BETA_CLOSED_ROUTES: ReadonlyArray<{
  route: string;
  closes: (method: string | undefined, pathname: string) => boolean;
}> = [
  { route: 'non-GET /api/runner/schedules', closes: (m, p) => p.startsWith('/api/runner/schedules') && m !== 'GET' },
  { route: 'POST /api/runner/spec-override', closes: (m, p) => m === 'POST' && p === '/api/runner/spec-override' },
  { route: 'GET /api/runner/spec-overrides', closes: (m, p) => m === 'GET' && p === '/api/runner/spec-overrides' },
  { route: 'POST /api/settings/defaults', closes: (m, p) => m === 'POST' && p === '/api/settings/defaults' },
  // Triage is remembered for the whole copy's next check-ups; judgement edits a stored report.
  {
    route: 'POST /api/runs/<runId>/triage',
    closes: (m, p) => m === 'POST' && /^\/api\/runs\/[^/]+\/triage$/.test(p),
  },
  {
    route: 'POST /api/runs/<runId>/accept-judgement',
    closes: (m, p) => m === 'POST' && /^\/api\/runs\/[^/]+\/accept-judgement$/.test(p),
  },
  { route: 'DELETE /api/runs/<runId>', closes: (m, p) => m === 'DELETE' && p.startsWith('/api/runs/') },
  {
    route: 'DELETE /api/runner/baselines/<id>',
    closes: (m, p) => m === 'DELETE' && p.startsWith('/api/runner/baselines/'),
  },
];

