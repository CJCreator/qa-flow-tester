/**
 * The routes shut on a beta copy are listed twice: as BETA_CLOSED_ROUTES in server.ts (the code) and under
 * "Closed on the shared beta copy" in docs/API.md (the promise). This fails when the two drift apart.
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BETA_CLOSED_ROUTES } from '../src/server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** One request per closed route, as [method, path], keyed by the route's label. */
const SHUT: Record<string, [string, string]> = {
  'non-GET /api/runner/schedules': ['POST', '/api/runner/schedules'],
  'POST /api/runner/spec-override': ['POST', '/api/runner/spec-override'],
  'GET /api/runner/spec-overrides': ['GET', '/api/runner/spec-overrides'],
  'POST /api/settings/defaults': ['POST', '/api/settings/defaults'],
  'POST /api/runs/<runId>/triage': ['POST', '/api/runs/run-1/triage'],
  'POST /api/runs/<runId>/accept-judgement': ['POST', '/api/runs/run-1/accept-judgement'],
  'DELETE /api/runs/<runId>': ['DELETE', '/api/runs/run-1'],
  'DELETE /api/runner/baselines/<id>': ['DELETE', '/api/runner/baselines/b-1'],
};

/** Requests that stay open on a beta copy. */
const OPEN: Array<[string, string]> = [
  ['GET', '/api/runner/schedules'],
  ['GET', '/api/settings/defaults'],
  ['GET', '/api/runs'],
  ['GET', '/api/runs/run-1'],
  ['POST', '/api/runs/run-1/download'],
  ['GET', '/api/runner/baselines'],
  ['POST', '/api/runner/run'],
  ['POST', '/api/runner/benchmark'],
  ['DELETE', '/api/runner/benchmark/bench-1'],
  ['POST', '/api/runner/context/docx'],
  ['POST', '/api/runner/domain-proof'],
];

/** The bullets under "### Closed on the shared beta copy" in docs/API.md, in order. */
async function docRoutes(): Promise<string[]> {
  const doc = await fs.readFile(path.join(root, 'docs', 'API.md'), 'utf8');
  const start = doc.indexOf('### Closed on the shared beta copy');
  expect(start).toBeGreaterThan(-1);
  const rest = doc.slice(start + 1);
  const section = rest.slice(0, rest.search(/\n#{1,3} /) + 1 || rest.length);
  return [...section.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]);
}

describe('beta closed routes match docs/API.md', () => {
  it('the doc lists exactly the routes BETA_CLOSED_ROUTES closes', async () => {
    const doc = (await docRoutes()).sort();
    const code = BETA_CLOSED_ROUTES.map((r) => r.route).sort();
    expect(doc).toEqual(code);
  });

  it('every closed route has a sample request, and each sample is shut', () => {
    expect(Object.keys(SHUT).sort()).toEqual(BETA_CLOSED_ROUTES.map((r) => r.route).sort());
    for (const [label, [method, pathname]] of Object.entries(SHUT)) {
      const entry = BETA_CLOSED_ROUTES.find((r) => r.route === label);
      expect(entry?.closes(method, pathname), label).toBe(true);
    }
  });

  it('requests the doc says stay open are not shut', () => {
    const shut = (method: string, pathname: string) => BETA_CLOSED_ROUTES.some((r) => r.closes(method, pathname));
    for (const [method, pathname] of OPEN) expect(shut(method, pathname), `${method} ${pathname}`).toBe(false);
  });

  it('the doc names both spec-override routes', async () => {
    const doc = await fs.readFile(path.join(root, 'docs', 'API.md'), 'utf8');
    expect(doc).toContain('`POST /api/runner/spec-override`');
    expect(doc).toContain('`GET /api/runner/spec-overrides`');
  });
});
