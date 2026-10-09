/**
 * AC1: Source items and the confirmed roles on them survive a runner restart with the waiting Plan.
 * A scripted AI plans one documented item per page; the person confirms its roles; the plan is read back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import type { AIMessage, AIProviderType, ReviewPlan } from '@qa/types';
import { RunnerServer } from '../src/server.js';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';

const FIXTURE_PORT = 3730;
const RUNNER_PORT = 3731;
const runnerUrl = `http://localhost:${RUNNER_PORT}`;
const outputDir = path.join(process.cwd(), '.tmp-sources-reload');
const dataDir = `${outputDir}-data`;
const target = `http://localhost:${FIXTURE_PORT}/`;

/** Finds the first control the page prompt lists, so the scripted item always uses a real selector. */
function firstControl(node: unknown, page?: string): { urlPath: string; selector: string } | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = firstControl(n, page);
      if (hit) return hit;
    }
    return null;
  }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    const here = typeof o.urlPath === 'string' ? o.urlPath : page;
    if (here && typeof o.selector === 'string' && !('expect' in o)) return { urlPath: here, selector: o.selector };
    for (const [k, v] of Object.entries(o)) {
      if (k === 'links') continue;
      const hit = firstControl(v, here);
      if (hit) return hit;
    }
  }
  return null;
}

class ScriptedAI {
  readonly providerType: AIProviderType = 'mock';
  async generateText(messages: AIMessage[]): Promise<string> {
    const prompt = messages.map((m) => m.content).join('\n');
    const at = prompt.indexOf('Pages:\n');
    if (at < 0) return '{}';
    const end = prompt.indexOf('\n\nAnswer with ONLY', at);
    let facts: unknown;
    try {
      facts = JSON.parse(prompt.slice(at + 'Pages:\n'.length, end));
    } catch {
      return '{}';
    }
    const hit = firstControl(facts);
    if (!hit) return '{}';
    return JSON.stringify({
      pages: [
        {
          urlPath: hit.urlPath,
          tests: [
            {
              name: 'Pressing the first control does what the guide says',
              steps: [{ action: 'click', selector: hit.selector, name: 'Press it' }],
              expect: {},
              requirementId: 'REQ-1',
            },
          ],
        },
      ],
    });
  }
}

const post = (route: string, body: unknown = {}, method = 'POST') =>
  fetch(`${runnerUrl}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function waitForPhase(wanted: string[], seconds = 200): Promise<void> {
  for (let i = 0; i < seconds * 2; i++) {
    const s = (await (await fetch(`${runnerUrl}/api/runner/status`)).json()) as { phase: string; lastRunError: string };
    if (wanted.includes(s.phase)) return;
    if (s.phase === 'failed') throw new Error(`run failed: ${s.lastRunError}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('timed out');
}

const documented = (plan: ReviewPlan) =>
  (plan.planPages ?? []).flatMap((pg) => pg.tests).filter((t) => t.docSource);

describe('Source items survive a Waiting Plan reload', () => {
  let runner: RunnerServer;
  const start = async () => {
    runner = new RunnerServer({ port: RUNNER_PORT, outputDir, dataDir, createAIProvider: () => new ScriptedAI() });
    await runner.start();
  };

  beforeAll(async () => {
    await new Promise<void>((resolve) => fixtureServer.listen(FIXTURE_PORT, () => resolve()));
    await start();
  });
  afterAll(async () => {
    await runner.stop();
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });

  it('keeps the Source, the confirmed roles and the stale mark after a restart', async () => {
    const res = await post('/api/runner/run', {
      targetUrl: target,
      owner: true,
      useAI: true,
      aiProvider: 'mock',
      skipReview: false,
      breakpoints: ['1440px'],
      contextDocuments: [{ name: 'guide.md', text: '# Guide\n## 1 Pages\n### 1.1 First control\nPressing the first control works.' }],
    });
    expect(res.status).toBe(202);
    await waitForPhase(['awaiting-review']);
    const before = (await (await fetch(`${runnerUrl}/api/runner/plan`)).json()) as ReviewPlan;
    const item = documented(before)[0];
    expect(item, 'a documented item was planned').toBeDefined();
    expect(item.docSource?.document).toBe('guide.md');

    const patched = await post(
      '/api/runner/plan',
      { sourceEdits: [{ itemId: item.id, roles: ['Admin'], stale: true }] },
      'PATCH'
    );
    expect(patched.status).toBe(200);

    await runner.stop();
    await start();
    const after = (await (await fetch(`${runnerUrl}/api/runner/plan`)).json()) as ReviewPlan;
    const same = documented(after).find((t) => t.id === item.id);
    expect(same?.docSource).toEqual(item.docSource);
    expect(same?.proposedRoles).toEqual(['Admin']);
    expect(same?.rolesConfirmed).toBe(true);
    expect(same?.docStale).toBe(true);
  }, 240000);
});
