import { describe, it, expect, vi } from 'vitest';
import type http from 'http';
import { matchRoute, sendNotFound, type Route } from '../src/routes/route.js';
import { allRoutes, planRoutes } from '../src/routes/index.js';

describe('route-table (T-206)', () => {
  describe('matchRoute unit tests', () => {
    it('matches exact path and method', () => {
      const route: Route = {
        method: 'GET',
        path: '/api/test',
        handle: () => {},
      };
      expect(matchRoute([route], 'GET', '/api/test')).toBe(route);
      expect(matchRoute([route], 'POST', '/api/test')).toBeUndefined();
      expect(matchRoute([route], 'GET', '/api/test/sub')).toBeUndefined();
      expect(matchRoute([route], 'GET', '/api/other')).toBeUndefined();
    });

    it('matches method case-insensitively', () => {
      const route: Route = {
        method: 'POST',
        path: '/api/submit',
        handle: () => {},
      };
      expect(matchRoute([route], 'post', '/api/submit')).toBe(route);
      expect(matchRoute([route], 'POST', '/api/submit')).toBe(route);
    });

    it('matches an array of exact paths (aliases)', () => {
      const route: Route = {
        method: 'POST',
        path: ['/api/runner/abort', '/api/runner/stop'],
        handle: () => {},
      };
      expect(matchRoute([route], 'POST', '/api/runner/abort')).toBe(route);
      expect(matchRoute([route], 'POST', '/api/runner/stop')).toBe(route);
      expect(matchRoute([route], 'POST', '/api/runner/cancel')).toBeUndefined();
    });

    it('matches prefix routes', () => {
      const prefixRoute: Route = {
        method: 'GET',
        path: '/api/runs',
        prefix: true,
        handle: () => {},
      };
      expect(matchRoute([prefixRoute], 'GET', '/api/runs')).toBe(prefixRoute);
      expect(matchRoute([prefixRoute], 'GET', '/api/runs/run-123')).toBe(prefixRoute);
      expect(matchRoute([prefixRoute], 'GET', '/api/runs/run-123/download/report.md')).toBe(prefixRoute);
      // Boundary check: does not match without slash separator
      expect(matchRoute([prefixRoute], 'GET', '/api/runs-other')).toBeUndefined();
    });

    it('matches prefix routes with trailing slash', () => {
      const prefixWithSlash: Route = {
        method: 'GET',
        path: '/api/evidence/',
        prefix: true,
        handle: () => {},
      };
      expect(matchRoute([prefixWithSlash], 'GET', '/api/evidence/')).toBe(prefixWithSlash);
      expect(matchRoute([prefixWithSlash], 'GET', '/api/evidence/run-1/image.png')).toBe(prefixWithSlash);
      expect(matchRoute([prefixWithSlash], 'GET', '/api/evidence')).toBe(prefixWithSlash);
    });

    it('matches anyMethod routes with any HTTP method', () => {
      const anyRoute: Route = {
        method: '*',
        path: '/api/runner/waiting-plans',
        anyMethod: true,
        handle: () => {},
      };
      expect(matchRoute([anyRoute], 'GET', '/api/runner/waiting-plans')).toBe(anyRoute);
      expect(matchRoute([anyRoute], 'POST', '/api/runner/waiting-plans')).toBe(anyRoute);
      expect(matchRoute([anyRoute], 'PATCH', '/api/runner/waiting-plans')).toBe(anyRoute);
      expect(matchRoute([anyRoute], 'DELETE', '/api/runner/waiting-plans')).toBe(anyRoute);
      expect(matchRoute([anyRoute], 'OPTIONS', '/api/runner/waiting-plans')).toBe(anyRoute);
    });

    it('exact rows beat prefix rows at the same path even when prefix is listed first', () => {
      const prefixRoute: Route = {
        method: 'GET',
        path: '/api/runs',
        prefix: true,
        handle: () => {},
      };
      const exactRoute: Route = {
        method: 'GET',
        path: '/api/runs',
        handle: () => {},
      };
      const routes = [prefixRoute, exactRoute];
      // Exact match wins for the exact path
      expect(matchRoute(routes, 'GET', '/api/runs')).toBe(exactRoute);
      // Prefix route matches subpaths
      expect(matchRoute(routes, 'GET', '/api/runs/123')).toBe(prefixRoute);
    });

    it('first match wins between conflicting exact rows', () => {
      const first: Route = {
        method: 'GET',
        path: '/api/item',
        handle: () => {},
      };
      const second: Route = {
        method: 'GET',
        path: '/api/item',
        handle: () => {},
      };
      expect(matchRoute([first, second], 'GET', '/api/item')).toBe(first);
    });

    it('first match wins between prefix rows matching the same subpath', () => {
      const first: Route = {
        method: 'GET',
        path: '/api',
        prefix: true,
        handle: () => {},
      };
      const second: Route = {
        method: 'GET',
        path: '/api/items',
        prefix: true,
        handle: () => {},
      };
      expect(matchRoute([first, second], 'GET', '/api/items/123')).toBe(first);
    });

    it('returns undefined for an unknown path', () => {
      const route: Route = {
        method: 'GET',
        path: '/api/known',
        handle: () => {},
      };
      expect(matchRoute([route], 'GET', '/api/unknown')).toBeUndefined();
      expect(matchRoute([], 'GET', '/api/known')).toBeUndefined();
    });
  });

  describe('fallback 404 handler', () => {
    it('writes 404 and {"error":"Not found"}', () => {
      const writeHead = vi.fn();
      const end = vi.fn();
      const fakeRes = { writeHead, end } as unknown as http.ServerResponse;

      sendNotFound(fakeRes);

      expect(writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
      expect(end).toHaveBeenCalledWith(JSON.stringify({ error: 'Not found' }));
    });
  });

  describe('planRoutes and allRoutes table', () => {
    it('contains all 11 plan routes in expected order', () => {
      expect(planRoutes).toHaveLength(11);

      const expected: Array<{ method: string; path: string; anyMethod?: boolean }> = [
        { method: 'GET', path: '/api/runner/plan' },
        { method: 'PATCH', path: '/api/runner/plan' },
        { method: 'POST', path: '/api/runner/plan/approve' },
        { method: 'POST', path: '/api/runner/plan/interpret' },
        { method: 'GET', path: '/api/runner/plan/markdown' },
        { method: 'GET', path: '/api/runner/plan/export' },
        { method: 'POST', path: '/api/runner/plan/replan' },
        { method: 'POST', path: '/api/runner/plan/add-page' },
        { method: '*', path: '/api/runner/waiting-plans', anyMethod: true },
        { method: 'POST', path: '/api/runner/plan/add-sign-in' },
        { method: 'POST', path: '/api/runner/plan/include-host' },
      ];

      for (let i = 0; i < expected.length; i++) {
        expect(planRoutes[i].path).toEqual(expected[i].path);
        expect(planRoutes[i].method).toEqual(expected[i].method);
        if (expected[i].anyMethod) {
          expect(planRoutes[i].anyMethod).toBe(true);
        }
      }
    });

    it('no two rows in allRoutes share a (method, path) pair', () => {
      const seen = new Set<string>();
      for (const route of allRoutes) {
        const paths = Array.isArray(route.path) ? route.path : [route.path];
        for (const p of paths) {
          const methodKey = route.anyMethod ? '*' : (route.method ?? '*');
          const pairKey = `${methodKey} ${p}`;
          expect(seen.has(pairKey), `Duplicate (method, path) pair: ${pairKey}`).toBe(false);
          seen.add(pairKey);
        }
      }
    });

    it('matches each plan route against allRoutes', () => {
      expect(matchRoute(allRoutes, 'GET', '/api/runner/plan')).toBe(planRoutes[0]);
      expect(matchRoute(allRoutes, 'PATCH', '/api/runner/plan')).toBe(planRoutes[1]);
      expect(matchRoute(allRoutes, 'POST', '/api/runner/plan/approve')).toBe(planRoutes[2]);
      expect(matchRoute(allRoutes, 'POST', '/api/runner/plan/interpret')).toBe(planRoutes[3]);
      expect(matchRoute(allRoutes, 'GET', '/api/runner/plan/markdown')).toBe(planRoutes[4]);
      expect(matchRoute(allRoutes, 'GET', '/api/runner/plan/export')).toBe(planRoutes[5]);
      expect(matchRoute(allRoutes, 'POST', '/api/runner/plan/replan')).toBe(planRoutes[6]);
      expect(matchRoute(allRoutes, 'POST', '/api/runner/plan/add-page')).toBe(planRoutes[7]);
      expect(matchRoute(allRoutes, 'GET', '/api/runner/waiting-plans')).toBe(planRoutes[8]);
      expect(matchRoute(allRoutes, 'POST', '/api/runner/waiting-plans')).toBe(planRoutes[8]);
      expect(matchRoute(allRoutes, 'POST', '/api/runner/plan/add-sign-in')).toBe(planRoutes[9]);
      expect(matchRoute(allRoutes, 'POST', '/api/runner/plan/include-host')).toBe(planRoutes[10]);
    });

    it('returns undefined for unmatched path in allRoutes', () => {
      expect(matchRoute(allRoutes, 'GET', '/api/runner/non-existent')).toBeUndefined();
      expect(matchRoute(allRoutes, 'DELETE', '/api/runner/plan')).toBeUndefined();
    });
  });
});
