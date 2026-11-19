/**
 * The Check-up endpoints still answered inline by `server.ts` (no row in the route table yet) that a signed-in
 * account may reach on a beta copy in account mode (ADR 0050, access level 'account' of ADR 0037). The plan
 * rows in the table declare `access: 'account'` themselves. Everything else outside the table keeps the access
 * key: sites, defaults, baselines, benchmarks, overrides, schedules. Default is closed: a path not listed here
 * is not reachable with an account alone.
 */

/** Exact paths and the methods an account may use on them. */
const EXACT: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
  ['/api/runner/status', new Set(['GET'])],
  ['/api/runner/stream', new Set(['GET'])],
  ['/api/runner/run', new Set(['POST'])],
  ['/api/runner/queue', new Set(['DELETE'])],
  ['/api/runner/abort', new Set(['POST'])],
  ['/api/runner/stop', new Set(['POST'])],
  ['/api/runner/ai-estimate', new Set(['POST'])],
  ['/api/runner/preflight', new Set(['POST'])],
  ['/api/runner/context/docx', new Set(['POST'])],
  ['/api/runner/domain-proof', new Set(['POST'])],
  ['/api/runner/ai/finish', new Set(['POST'])],
  ['/api/report', new Set(['GET'])],
  // Where a visitor enters and checks their OWN AI key (held in memory for their session on a beta copy).
  // Nothing else under /api/ai/ (models lists, test-model, usage) is open to an account.
  ['/api/ai/settings', new Set(['GET', 'POST'])],
  ['/api/ai/openrouter/key', new Set(['GET', 'POST'])],
  ['/api/ai/openrouter/validate', new Set(['POST'])],
  ['/api/runs', new Set(['GET'])],
];

/** Prefixes (`/api/x/…`) and the methods an account may use under them. */
const PREFIXES: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
  ['/api/report/download/', new Set(['GET'])],
  ['/api/evidence/', new Set(['GET'])],
  // Past Check-ups: list, read, download, and (closed in beta by closedInBeta) delete/triage.
  ['/api/runs/', new Set(['GET', 'POST', 'DELETE'])],
];

/** May an account that holds no access key reach this inline path with this method? */
export function accountMayReach(method: string | undefined, pathname: string): boolean {
  const m = (method ?? 'GET').toUpperCase();
  for (const [path, methods] of EXACT) if (pathname === path) return methods.has(m);
  for (const [prefix, methods] of PREFIXES) if (pathname.startsWith(prefix)) return methods.has(m);
  return false;
}
