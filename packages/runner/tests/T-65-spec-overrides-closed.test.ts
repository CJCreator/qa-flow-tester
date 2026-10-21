/**
 * T-65 (SEC-13): GET /api/runner/spec-overrides is closed on the hosted beta copy (403 ERR_BETA).
 * Source checks only: the route is in BETA_CLOSED_ROUTES and docs/API.md names it under the closed list.
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BETA_CLOSED_ROUTES } from '../src/server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('T-65 GET /api/runner/spec-overrides is closed on beta', () => {
  it('BETA_CLOSED_ROUTES closes the GET and nothing else on that path', () => {
    const closes = (method: string, pathname: string) =>
      BETA_CLOSED_ROUTES.some((r) => r.closes(method, pathname));
    expect(closes('GET', '/api/runner/spec-overrides')).toBe(true);
    expect(closes('GET', '/api/runner/spec-overrides/')).toBe(false);
    expect(BETA_CLOSED_ROUTES.map((r) => r.route)).toContain('GET /api/runner/spec-overrides');
  });

  it('docs/API.md names the GET under "Closed on the shared beta copy" and no longer says it stays open', async () => {
    const doc = await fs.readFile(path.join(root, 'docs', 'API.md'), 'utf8');
    const start = doc.indexOf('### Closed on the shared beta copy');
    expect(start).toBeGreaterThan(-1);
    const rest = doc.slice(start + 1);
    const section = rest.slice(0, rest.search(/\n#{1,3} /) + 1 || rest.length);
    expect(section).toContain('- `GET /api/runner/spec-overrides`');
    expect(doc).not.toContain('`GET /api/runner/spec-overrides` is one of them');
  });
});
