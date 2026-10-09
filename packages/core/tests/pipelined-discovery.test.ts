/** Discovery plans pages while the Spider crawls (ADR 0020). Needs Chromium. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { AIMessage, AICompletionOptions, AIProviderType } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { MockAIProvider } from '../src/ai/providers/mock.js';
import { DiscoveryAgent, type DiscoveryProgress } from '../src/discovery/discovery-agent.js';

class EmptyPlanAI implements AIProvider {
  readonly providerType: AIProviderType = 'mock';
  private planner = new MockAIProvider();
  async generateText(messages: AIMessage[], options?: AICompletionOptions): Promise<string> {
    const prompt = messages.map((m) => m.content).join('\n');
    if (!prompt.includes('synthesizing application flows')) return this.planner.generateText(messages, options);
    return JSON.stringify({ flows: [] });
  }
}

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

const SLOW_PAGES = [1, 2, 3, 4, 5, 6];

let server: http.Server;
let baseUrl = '';
let outputDir = '';

beforeAll(async () => {
  outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pipelined-discovery-'));
  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const send = (html: string) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    };
    const slow = url.pathname.match(/^\/slow\/(\d+)$/);
    if (slow) {
      // Each page takes a while to arrive, so the crawl is still running when earlier pages are planned.
      setTimeout(() => send(page(`Slow ${slow[1]}`, '<button type="button">Toggle details</button>')), 250);
      return;
    }
    send(
      page(
        'Home',
        `<button type="button">Open menu</button>${SLOW_PAGES.map((n) => `<a href="/slow/${n}">Slow ${n}</a>`).join(' ')}`
      )
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(outputDir, { recursive: true, force: true });
});

describe('Pipelined discovery', { timeout: 60_000 }, () => {
  it('plans pages while the crawl runs: plannedWhileCrawling is set and pages were planned before the last page arrived', async () => {
    const events: DiscoveryProgress[] = [];
    const draft = await new DiscoveryAgent().discover({
      targetUrl: baseUrl,
      productId: 'slow',
      outputDir: path.join(outputDir, 'pipelined'),
      aiProvider: new EmptyPlanAI(),
      onProgress: (p) => events.push(p),
    });
    expect(draft.plan?.plannedWhileCrawling).toBe(true);
    const crawling = events.filter((e) => e.stage === 'crawling');
    expect(crawling.length).toBeGreaterThanOrEqual(7);
    const last = crawling[crawling.length - 1] as Extract<DiscoveryProgress, { stage: 'crawling' }>;
    expect(last.plannedSoFar).toBeGreaterThan(0);
    // Every tested page has tests or was said to have none; no page is left without a plan.
    for (const p of draft.plan!.pages.filter((x) => x.coverage !== 'covered')) {
      expect(p.source).toBeDefined();
    }
    expect(draft.plan!.pages.some((p) => p.origin === 'while-crawling')).toBe(true);
  });

  it('the sequential rollback plans after the crawl and marks nothing as planned while crawling', async () => {
    const draft = await new DiscoveryAgent().discover({
      targetUrl: baseUrl,
      productId: 'slow',
      outputDir: path.join(outputDir, 'sequential'),
      aiProvider: new EmptyPlanAI(),
      sequentialPlanning: true,
    });
    expect(draft.plan?.plannedWhileCrawling).toBeUndefined();
    expect(draft.plan!.pages.some((p) => p.origin)).toBe(false);
  });
});
