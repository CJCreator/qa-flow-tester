import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

/**
 * ADR 0031 (T-43): no call site in core or checkers sends a request on a page-derived URL with the
 * Playwright request API or Node's fetch. Each file below is a known call still to move; the list
 * shrinks as the handoffs land, and the test fails if a listed file no longer exists.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.join(here, '..', '..');
const ROOTS = [path.join(packagesDir, 'core', 'src'), path.join(packagesDir, 'checkers', 'src')];

const PATTERNS = [
  /\bpage\.request\b/,
  /\bcontext\.request\b/,
  /\b(?:request|requestContext)\.fetch\(/,
  /(?<![\w.])fetch\(/,
];

const OPEN_HANDOFFS = new Set([
  'core/src/access-control.ts', // context.request.get on a Check-up URL (handoff: access-control owner)
  'core/src/competitive/robots.ts', // Node fetch of robots.txt, redirects unchecked (ADR 0014 follow-up)
  'core/src/discovery/docs-fetch.ts', // Node fetch fallback for a docs URL (handoff)
  'core/src/preflight.ts', // Node fetch to the target URL before the run (handoff)
  'core/src/ai/providers/anthropic.ts', // fixed AI provider endpoint, not page-derived
  'core/src/ai/providers/gemini.ts', // fixed AI provider endpoint, not page-derived
  'core/src/ai/providers/openai.ts', // fixed AI provider endpoint, not page-derived
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith('.ts') ? [full] : [];
  });
}

const keyOf = (file: string) => path.relative(packagesDir, file).split(path.sep).join('/');

describe('outbound requests go through the pinned helper (ADR 0031)', () => {
  it('no core or checkers source file calls a request API outside the open handoff list', () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        const key = keyOf(file);
        if (OPEN_HANDOFFS.has(key)) continue;
        readFileSync(file, 'utf8')
          .split(/\r?\n/)
          .forEach((line, i) => {
            const code = line.trim();
            if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
            if (PATTERNS.some((p) => p.test(line))) offenders.push(`${key}:${i + 1}: ${code}`);
          });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the T-43 files are not on the open list', () => {
    for (const key of [
      'core/src/safe-net.ts',
      'core/src/discovery/deterministic-spider.ts',
      'core/src/orchestrator.ts',
      'checkers/src/seo.ts',
      'checkers/src/security-depth.ts',
    ]) {
      expect(OPEN_HANDOFFS.has(key), key).toBe(false);
    }
  });

  it('every open-list entry still exists, so the list cannot rot', () => {
    for (const key of OPEN_HANDOFFS) {
      expect(existsSync(path.join(packagesDir, key)), key).toBe(true);
    }
  });
});
