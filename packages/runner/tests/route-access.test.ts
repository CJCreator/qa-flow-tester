/**
 * REQ-048 (BE-102): every route-table row declares who may call it and whether a beta copy serves it.
 * authorizeRoute is pure; these are its unit tests, plus the `:id` / `:linkId` parameter matching.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  authorizeRoute,
  isLoopbackAddress,
  resolveRoute,
  matchRoute,
  type Route,
  type RouteCaller,
  type HelperPermission,
} from '../src/routes/route.js';
import { allRoutes, planRoutes } from '../src/routes/index.js';
import * as routesIndex from '../src/routes/index.js';

const OWNER: RouteCaller = { hasAccessKey: true, beta: false };
const STRANGER: RouteCaller = { hasAccessKey: false, beta: false };

const AUDIT_ID = 'audit_12345';
const LINK_ID = 'L'.repeat(22);

function helperWith(...granted: HelperPermission[]): RouteCaller['helper'] {
  return (permission) => granted.includes(permission);
}

describe('authorizeRoute: access levels (REQ-048)', () => {
  it('AC-1: refuses a row without an access level, even for the owner (closed by default)', () => {
    for (const caller of [OWNER, STRANGER, { hasAccessKey: true, beta: true }]) {
      const decision = authorizeRoute({ beta: 'allow' }, caller);
      expect(decision).toMatchObject({ allow: false, status: 403, code: 'ERR_ROUTE_CLOSED' });
    }
  });

  it('refuses an access level it does not know', () => {
    const decision = authorizeRoute({ access: 'admin' as never, beta: 'allow' }, OWNER);
    expect(decision).toMatchObject({ allow: false, status: 403, code: 'ERR_ROUTE_CLOSED' });
  });

  it("AC-3: 'owner' needs the access key, and a Helper grant never stands in for it", () => {
    expect(authorizeRoute({ access: 'owner' }, OWNER)).toEqual({ allow: true });
    expect(authorizeRoute({ access: 'owner' }, STRANGER)).toMatchObject({
      allow: false,
      status: 401,
      code: 'ERR_ACCESS_KEY',
    });
    const helper = helperWith('view', 'edit', 'export');
    expect(authorizeRoute({ access: 'owner' }, { ...STRANGER, helper })).toMatchObject({ allow: false, status: 401 });
  });

  it("AC-4: 'public' and 'sign-in' are reachable without the key", () => {
    expect(authorizeRoute({ access: 'public' }, STRANGER)).toEqual({ allow: true });
    expect(authorizeRoute({ access: 'sign-in' }, STRANGER)).toEqual({ allow: true });
  });

  it.each(['view', 'edit', 'export'] as const)(
    "'%s' accepts the access key, or a Helper holding that permission",
    (access) => {
      expect(authorizeRoute({ access }, OWNER)).toEqual({ allow: true });
      // Default hook: no Helper.
      expect(authorizeRoute({ access }, STRANGER)).toMatchObject({ allow: false, status: 401, code: 'ERR_ACCESS_KEY' });
      expect(authorizeRoute({ access }, { ...STRANGER, helper: helperWith(access) })).toEqual({ allow: true });
      const others = (['view', 'edit', 'export'] as const).filter((p) => p !== access);
      expect(authorizeRoute({ access }, { ...STRANGER, helper: helperWith(...others) })).toMatchObject({
        allow: false,
        status: 401,
      });
    }
  );

  it('asks the Helper hook only for the permission the row needs', () => {
    const helper = vi.fn((_permission: HelperPermission) => false);
    authorizeRoute({ access: 'edit' }, { ...STRANGER, helper });
    expect(helper).toHaveBeenCalledWith('edit');
    helper.mockClear();
    authorizeRoute({ access: 'owner' }, { ...STRANGER, helper });
    authorizeRoute({ access: 'public' }, { ...STRANGER, helper });
    expect(helper).not.toHaveBeenCalled();
  });
});

describe('authorizeRoute: beta policy (REQ-048 AC-5, D-004, D-005)', () => {
  const BETA_OWNER: RouteCaller = { hasAccessKey: true, beta: true };
  const BETA_VISITOR: RouteCaller = { hasAccessKey: false, beta: true };

  it("serves only rows whose beta policy is 'allow'; a missing policy is closed", () => {
    expect(authorizeRoute({ access: 'owner', beta: 'allow' }, BETA_OWNER)).toEqual({ allow: true });
    expect(authorizeRoute({ access: 'owner', beta: 'closed' }, BETA_OWNER)).toMatchObject({
      allow: false,
      status: 403,
      code: 'ERR_BETA',
    });
    expect(authorizeRoute({ access: 'owner' }, BETA_OWNER)).toMatchObject({ allow: false, code: 'ERR_BETA' });
    expect(authorizeRoute({ access: 'view' }, BETA_OWNER)).toMatchObject({ allow: false, code: 'ERR_BETA' });
  });

  it("a 'public' row with beta 'allow' is served to a beta visitor; one without is not", () => {
    expect(authorizeRoute({ access: 'public', beta: 'allow' }, BETA_VISITOR)).toEqual({ allow: true });
    expect(authorizeRoute({ access: 'public', beta: 'closed' }, BETA_VISITOR)).toMatchObject({
      allow: false,
      code: 'ERR_BETA',
    });
  });

  it('D-005: Helper sign-in rows and rows a Helper holds a grant for pass the beta policy', () => {
    expect(authorizeRoute({ access: 'sign-in' }, BETA_VISITOR)).toEqual({ allow: true });
    expect(authorizeRoute({ access: 'view' }, { ...BETA_VISITOR, helper: helperWith('view') })).toEqual({
      allow: true,
    });
    // A grant of another permission does not.
    expect(authorizeRoute({ access: 'export' }, { ...BETA_VISITOR, helper: helperWith('view') })).toMatchObject({
      allow: false,
      status: 401,
    });
    // The owner of a beta copy gets no such exception on a closed audit row.
    expect(authorizeRoute({ access: 'edit' }, BETA_OWNER)).toMatchObject({ allow: false, code: 'ERR_BETA' });
  });

  it('a missing access level is refused before the beta policy is looked at', () => {
    expect(authorizeRoute({ beta: 'allow' }, BETA_OWNER)).toMatchObject({ code: 'ERR_ROUTE_CLOSED' });
  });
});

describe('resolveRoute: :id / :linkId parameters', () => {
  const noop = () => {};
  const shared: Route = { method: 'GET', path: '/s/:linkId', access: 'public', beta: 'allow', handle: noop };
  const audit: Route = { method: 'GET', path: '/api/audits/:id', access: 'view', handle: noop };
  const revoke: Route = { method: 'DELETE', path: '/api/audits/:id/share/:linkId', access: 'owner', handle: noop };

  it('matches values meeting AUDIT_ID_PATTERN / SHARE_LINK_ID_PATTERN and hands them over decoded', () => {
    expect(resolveRoute([shared], 'GET', `/s/${LINK_ID}`)).toEqual({ route: shared, params: { linkId: LINK_ID } });
    expect(resolveRoute([audit], 'GET', `/api/audits/${AUDIT_ID}`)).toEqual({
      route: audit,
      params: { id: AUDIT_ID },
    });
    expect(resolveRoute([revoke], 'DELETE', `/api/audits/${AUDIT_ID}/share/${LINK_ID}`)?.params).toEqual({
      id: AUDIT_ID,
      linkId: LINK_ID,
    });
    // Percent-encoded characters that the rule allows arrive decoded.
    expect(resolveRoute([audit], 'GET', '/api/audits/audit%5F12345')?.params).toEqual({ id: AUDIT_ID });
  });

  it('does not match a malformed parameter (a 404, never another folder)', () => {
    for (const bad of [
      'short',
      'L'.repeat(21),
      'L'.repeat(129),
      `${'L'.repeat(22)}%2F..`,
      '..',
      '%E0%A4%A',
      'a.b'.repeat(8),
    ]) {
      expect(resolveRoute([shared], 'GET', `/s/${bad}`), bad).toBeUndefined();
    }
    for (const bad of ['abc', 'x'.repeat(65), '..%2F..%2Fetc', 'audit 1234']) {
      expect(resolveRoute([audit], 'GET', `/api/audits/${bad}`), bad).toBeUndefined();
    }
    expect(resolveRoute([audit], 'GET', `/api/audits/${AUDIT_ID}/extra`)).toBeUndefined();
    expect(resolveRoute([audit], 'POST', `/api/audits/${AUDIT_ID}`)).toBeUndefined();
  });

  it('parameter rows rank with exact rows in table order, and both beat prefix rows', () => {
    const exact: Route = { method: 'GET', path: '/api/audits/list_of_all', access: 'view', handle: noop };
    const prefix: Route = { method: 'GET', path: '/api/audits', prefix: true, access: 'owner', handle: noop };
    expect(resolveRoute([prefix, audit, exact], 'GET', '/api/audits/list_of_all')?.route).toBe(audit);
    expect(resolveRoute([prefix, exact, audit], 'GET', '/api/audits/list_of_all')?.route).toBe(exact);
    // A malformed id falls through to the prefix row, as any unmatched exact row would.
    expect(resolveRoute([prefix, audit], 'GET', '/api/audits/bad')?.route).toBe(prefix);
    expect(resolveRoute([prefix, audit], 'GET', '/api/audits/bad')?.params).toEqual({});
  });

  it('exact rows still carry no parameters, and matchRoute gives the same row', () => {
    const plain: Route = { method: 'GET', path: '/api/plain', access: 'owner', handle: noop };
    expect(resolveRoute([plain], 'GET', '/api/plain')).toEqual({ route: plain, params: {} });
    expect(matchRoute([plain, shared], 'GET', `/s/${LINK_ID}`)).toBe(shared);
  });
});

describe('the route table declares access and beta policy', () => {
  it("every Plan row is 'owner' and served on a beta copy, as before", () => {
    expect(planRoutes).toHaveLength(11);
    for (const route of planRoutes) {
      expect(route.access, String(route.path)).toBe('owner');
      expect(route.beta, String(route.path)).toBe('allow');
    }
  });

  it('every row in allRoutes declares an access level', () => {
    for (const route of allRoutes) expect(route.access, String(route.path)).toBeDefined();
  });

  it('routes/index re-exports authorizeRoute and the parameter-aware matcher', () => {
    expect(routesIndex.authorizeRoute).toBe(authorizeRoute);
    expect(routesIndex.resolveRoute).toBe(resolveRoute);
    expect(routesIndex.isLoopbackAddress).toBe(isLoopbackAddress);
  });
});

describe('isLoopbackAddress: the owner without a key is the local machine (DEC-004)', () => {
  it('accepts the loopback socket addresses', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1'])
      expect(isLoopbackAddress(address), address).toBe(true);
  });

  it('refuses every other address, and a missing one', () => {
    for (const address of [
      undefined,
      '',
      '10.0.0.5',
      '192.168.1.20',
      '::ffff:10.0.0.5',
      '0.0.0.0',
      'localhost',
      '::',
    ]) {
      expect(isLoopbackAddress(address), String(address)).toBe(false);
    }
  });
});

describe('schedule rows and the scheduler access level (ADR 0039)', () => {
  const rows = allRoutes.filter((r) => String(r.path).startsWith('/api/runner/schedules'));

  it('the four owner rows are owner / allow, and the tick row is scheduler / allow', () => {
    const tick = rows.filter((r) => r.access === 'scheduler');
    expect(tick).toHaveLength(1);
    expect(tick[0]).toMatchObject({ method: 'POST', path: '/api/runner/schedules/tick', beta: 'allow' });
    const owner = rows.filter((r) => r.access === 'owner');
    expect(owner).toHaveLength(4);
    for (const row of owner) expect(row.beta).toBe('allow');
  });

  it('owner rows: the key passes in beta, no key is 401', () => {
    expect(authorizeRoute({ access: 'owner', beta: 'allow' }, { hasAccessKey: true, beta: true })).toEqual({
      allow: true,
    });
    expect(authorizeRoute({ access: 'owner', beta: 'allow' }, { hasAccessKey: false, beta: true })).toMatchObject({
      allow: false,
      status: 401,
    });
  });

  it("'scheduler' is allowed only with a verified token, and the access key is not enough", () => {
    const row = { access: 'scheduler', beta: 'allow' } as const;
    expect(authorizeRoute(row, { hasAccessKey: false, beta: true, scheduler: true })).toEqual({ allow: true });
    expect(authorizeRoute(row, { hasAccessKey: false, beta: false, scheduler: true })).toEqual({ allow: true });
    for (const caller of [
      { hasAccessKey: false, beta: true },
      { hasAccessKey: true, beta: true },
      { hasAccessKey: true, beta: false, scheduler: false },
    ]) {
      expect(authorizeRoute(row, caller)).toMatchObject({ allow: false, status: 401, code: 'ERR_SCHEDULER_AUTH' });
    }
  });

  it("'scheduler' without a beta policy is closed in beta", () => {
    expect(authorizeRoute({ access: 'scheduler' }, { hasAccessKey: false, beta: true, scheduler: true })).toMatchObject(
      {
        allow: false,
        code: 'ERR_BETA',
      }
    );
  });

  it('every row declares an access level', () => {
    for (const row of allRoutes) expect(row.access, String(row.path)).toBeDefined();
  });

  it('the tick beats the schedule id prefix rows, and ids resolve to the prefix rows', () => {
    expect(resolveRoute(allRoutes, 'POST', '/api/runner/schedules/tick')?.route.access).toBe('scheduler');
    expect(resolveRoute(allRoutes, 'POST', '/api/runner/schedules/sched_1_ab/toggle')?.route.access).toBe('owner');
    expect(resolveRoute(allRoutes, 'DELETE', '/api/runner/schedules/sched_1_ab')?.route.access).toBe('owner');
    expect(resolveRoute(allRoutes, 'GET', '/api/runner/schedules/tick')).toBeUndefined();
  });
});
