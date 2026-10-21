import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (file: string) => readFileSync(path.join(here, '..', 'src', file), 'utf8');

const closeContext = vi.fn(async () => {});
const routeFails = vi.fn(async () => {
  throw new Error('route registration failed');
});
const newContext = vi.fn(async () => ({ route: routeFails, close: closeContext }));
const browserClose = vi.fn(async () => {});

vi.mock('playwright', () => ({
  chromium: { launch: vi.fn(async () => ({ isConnected: () => true, newContext, close: browserClose })) },
  webkit: { launch: vi.fn() },
  firefox: { launch: vi.fn() },
}));

describe('BrowserManager.createContext closes a context whose setup fails', () => {
  beforeEach(() => {
    closeContext.mockClear();
    newContext.mockClear();
    routeFails.mockClear();
  });

  it('closes the new context and rethrows when header routing cannot be registered', async () => {
    const { BrowserManager } = await import('../src/browser.js');
    const manager = new BrowserManager();
    await expect(
      manager.createContext({
        baseUrl: 'https://example.test',
        customHeaders: { 'X-QA-Bypass-Token': 'token-value' },
      })
    ).rejects.toThrow('route registration failed');
    expect(newContext).toHaveBeenCalledTimes(1);
    expect(closeContext).toHaveBeenCalledTimes(1);
  });

  it('keeps the context-creating code on one path: no bare browser.newContext outside openContext', () => {
    const browser = src('browser.ts');
    const bare = browser.match(/setupContext\(await browser\.newContext/g);
    expect(bare).toBeNull();
  });
});

describe('FlowTestOrchestrator.run closes its browsers on every exit', () => {
  // A source check: run() must delegate to a body in a try/finally that always closes the browser manager.
  const orchestrator = src('orchestrator.ts');

  it('wraps the run body in try/finally with browserManager.close()', () => {
    const start = orchestrator.indexOf('  async run(options: RunOptions): Promise<ReleaseReport> {');
    const body = orchestrator.indexOf('  private async runChecks(options: RunOptions)', start);
    expect(start).toBeGreaterThan(-1);
    expect(body).toBeGreaterThan(start);
    const wrapper = orchestrator.slice(start, body);
    expect(wrapper).toContain('try {');
    expect(wrapper).toContain('return await this.runChecks(options);');
    expect(wrapper).toMatch(/finally \{\s*await this\.browserManager\.close\(\)/);
  });

  it('builds the access signed-out fetcher with the pinned guarded fetch and no signed-out context', () => {
    expect(orchestrator).toContain('signedOut: guardedFetcher(');
    expect(orchestrator).toContain('makeOutboundFetch({ allowPrivate: !guard, timeoutMs: 15000, maxRedirects: 0 })');
    expect(orchestrator).not.toContain('signedOutContext');
  });
});
