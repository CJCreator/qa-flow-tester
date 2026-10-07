/**
 * Re-runs (ADR 0009): the site's memory keeps the approved Plan, and the next run only asks the AI
 * about what changed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import type { AIMessage, AICompletionOptions, AIProviderType } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { MockAIProvider } from '../src/ai/providers/mock.js';
import { DiscoveryAgent } from '../src/discovery/discovery-agent.js';
import { rememberRun } from '../src/site-memory.js';

const PORT = 3533;
const base = `http://localhost:${PORT}`;
const outputDir = path.join(process.cwd(), '.tmp-plan-reuse');

/** Answers the planner like the mock does, plans no journeys, and counts what it was asked. */
class CountingAI implements AIProvider {
  readonly providerType: AIProviderType = 'mock';
  readonly asked: string[] = [];
  private mock = new MockAIProvider();
  async generateText(messages: AIMessage[], options?: AICompletionOptions): Promise<string> {
    const prompt = messages.map((m) => m.content).join('\n');
    if (prompt.includes('synthesizing application flows')) {
      this.asked.push('journeys');
      return JSON.stringify({ siteType: 'content', flows: [] });
    }
    this.asked.push(prompt.includes('Pages:\n') ? 'pages' : 'menus');
    return this.mock.generateText(messages, options);
  }
}

let pricingHasYearly = false;
const layout = (
  title: string,
  main: string
) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body>
  <header><nav><a href="/">Home</a> <a href="/about">About</a> <a href="/pricing">Pricing</a></nav></header>
  <main><h1>${title}</h1>${main}</main></body></html>`;

describe('Re-runs reuse the approved Plan', () => {
  let server: http.Server;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const pages: Record<string, string> = {
        '/': layout('Home', '<button type="button">Show offers</button>'),
        '/about': layout('About', '<p>We make things.</p>'),
        '/pricing': layout(
          'Pricing',
          `<button type="button">Monthly</button>${pricingHasYearly ? '<button type="button">Yearly</button>' : ''}`
        ),
      };
      const page = pages[new URL(req.url || '/', base).pathname];
      res.writeHead(page ? 200 : 404, { 'Content-Type': 'text/html' });
      res.end(page || 'Not found');
    });
    await new Promise<void>((resolve) => server.listen(PORT, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it('asks the AI only about what changed since the last approved Plan', async () => {
    const discover = (ai: AIProvider, remembered?: Parameters<DiscoveryAgent['discover']>[0]['remembered']) =>
      new DiscoveryAgent().discover({
        targetUrl: `${base}/`,
        productId: 'reuse',
        outputDir,
        aiProvider: ai,
        remembered,
      });

    // First run: every page and the journeys. The shared menu's links all go to pages the crawl saw,
    // so their checks need nothing from the AI.
    const first = new CountingAI();
    const firstDraft = await discover(first);
    expect(first.asked).toEqual(['pages', 'journeys']);
    const pricingTests = firstDraft.plan!.pages.find((p) => p.urlPath === '/pricing')!.tests;
    expect(pricingTests.map((t) => t.name)).toEqual(['Pressing “Monthly” keeps the page working']);
    firstDraft.plan!.pages.find((p) => p.urlPath === '/about')!.skipped = true;
    const memory = rememberRun(null, `localhost:${PORT}`, firstDraft, { reviewed: true, answeredByOwner: {} });

    // Nothing changed: nothing is asked, and the approved Plan comes back as it was.
    const second = new CountingAI();
    const secondDraft = await discover(second, memory.plan);
    expect(second.asked).toEqual([]);
    expect(secondDraft.plan!.pages.find((p) => p.urlPath === '/pricing')!.tests).toEqual(pricingTests);
    expect(secondDraft.plan!.budget).toMatchObject({ needed: 0, used: 0 });
    expect(secondDraft.plan!.navigation.map((n) => n.name).sort()).toEqual(
      firstDraft.plan!.navigation.map((n) => n.name).sort()
    );

    // The pricing page gained a button: only it, and the journeys, are asked about again.
    pricingHasYearly = true;
    const third = new CountingAI();
    const thirdDraft = await discover(third, memory.plan);
    expect(third.asked).toEqual(['pages', 'journeys']);
    expect(third.asked.length).toBe(thirdDraft.plan!.budget!.needed);
  }, 120000);
});
