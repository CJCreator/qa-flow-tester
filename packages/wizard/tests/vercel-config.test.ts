import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(path.join(dir, '..', '..', '..', 'vercel.json'), 'utf8')) as {
  buildCommand: string;
  outputDirectory: string;
  git: { deploymentEnabled: Record<string, boolean> };
  rewrites: Array<{ source: string; destination: string }>;
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};
const RUNNER = 'https://qa-check-up-cnhl7suwnq-uc.a.run.app';

describe('root vercel.json', () => {
  it('forwards the runner paths before the single-page catch-all', () => {
    const sources = config.rewrites.map((r) => r.source);
    expect(sources.indexOf('/api/:path*')).toBeGreaterThanOrEqual(0);
    expect(sources.indexOf('/s/:path*')).toBeGreaterThanOrEqual(0);
    expect(sources[sources.length - 1]).toBe('/(.*)');
    expect(config.rewrites.at(-1)?.destination).toBe('/index.html');
    expect(config.rewrites.find((r) => r.source === '/api/:path*')?.destination).toBe(`${RUNNER}/api/:path*`);
    expect(config.rewrites.find((r) => r.source === '/s/:path*')?.destination).toBe(`${RUNNER}/s/:path*`);
  });

  it('never forwards /healthz', () => {
    expect(config.rewrites.some((r) => r.source.includes('healthz'))).toBe(false);
  });

  it('builds through site-output so %ORIGIN% and version.json are filled', () => {
    expect(config.buildCommand).toBe('pnpm run site-build');
    expect(config.outputDirectory).toBe('public');
    expect(config.git.deploymentEnabled['lane/*']).toBe(false);
  });

  it('the page CSP is enforced, allows Firebase sign-in and does not name the run.app host', () => {
    const page = config.headers.find((h) => h.source.includes('(?!'));
    const csp = page?.headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
    for (const part of [
      'identitytoolkit.googleapis.com',
      'securetoken.googleapis.com',
      'apis.google.com',
      'firebaseapp.com',
    ]) {
      expect(csp).toContain(part);
    }
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('run.app');
  });

  it('the page headers skip the runner paths, so the runner keeps its own headers', () => {
    const page = config.headers.find((h) => h.source.includes('(?!'));
    expect(page?.source).toContain('api/');
    expect(page?.source).toContain('s/');
  });

  it('hashed assets are cached for a year', () => {
    const assets = config.headers.find((h) => h.source.startsWith('/assets/'));
    expect(assets?.headers.find((h) => h.key === 'Cache-Control')?.value).toContain('immutable');
  });
});
