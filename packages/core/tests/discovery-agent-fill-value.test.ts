import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DiscoveryAgent } from '../src/discovery/discovery-agent.js';
import { server } from '../../../fixtures/test-app/server.js';
import type { AIProvider } from '../src/ai/ai-provider.js';
import type { AIMessage, AICompletionOptions, AIProviderType } from '@qa/types';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Regression coverage for the "AI omits `value` on a fill step" bug: some models
 * (esp. smaller/free ones) return a flow with a fill step that has no `value`,
 * which previously executed as a silent no-op (e.g. a login submitted with a
 * blank password that still "succeeds"). DiscoveryAgent should retry once with
 * a repair prompt, and if the repair still comes back empty, backfill an
 * obviously-fake placeholder rather than leaving the field blank.
 */
class ScriptedAIProvider implements AIProvider {
  readonly providerType: AIProviderType = 'mock';
  private callCount = 0;

  constructor(private responses: string[]) {}

  async generateText(_messages: AIMessage[], _options?: AICompletionOptions): Promise<string> {
    const response = this.responses[Math.min(this.callCount, this.responses.length - 1)];
    this.callCount++;
    return response;
  }

  get calls(): number {
    return this.callCount;
  }
}

const flowMissingValue = JSON.stringify({
  flows: [
    {
      id: 'FLOW-LOGIN',
      name: 'Login',
      role: 'member',
      description: 'Log in with credentials',
      startPage: '/login',
      steps: [
        { action: 'fill', selector: '[data-testid="email-input"]', name: 'Fill Email' },
        { action: 'click', selector: '[data-testid="submit-btn"]', name: 'Submit' },
      ],
    },
  ],
});

const flowWithValue = JSON.stringify({
  flows: [
    {
      id: 'FLOW-LOGIN',
      name: 'Login',
      role: 'member',
      description: 'Log in with credentials',
      startPage: '/login',
      steps: [
        {
          action: 'fill',
          selector: '[data-testid="email-input"]',
          value: 'repaired@example.com',
          name: 'Fill Email',
        },
        { action: 'click', selector: '[data-testid="submit-btn"]', name: 'Submit' },
      ],
    },
  ],
});

describe('DiscoveryAgent fill-step value handling', () => {
  const PORT = 3096;
  const baseUrl = `http://localhost:${PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-discovery-fill-value');

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(PORT, () => resolve());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it('retries with a repair prompt and uses the repaired value when the AI supplies one on retry', async () => {
    const aiProvider = new ScriptedAIProvider([flowMissingValue, flowWithValue]);
    const agent = new DiscoveryAgent();

    const draft = await agent.discover({
      targetUrl: baseUrl,
      productId: 'fixture-product',
      outputDir: path.join(outputDir, 'repaired'),
      aiProvider,
    });

    expect(aiProvider.calls).toBe(2);
    const flow = draft.flows.find((f) => f.id === 'FLOW-LOGIN');
    const fillStep = flow?.steps.find((s) => s.action === 'fill');
    expect(fillStep?.value).toBe('repaired@example.com');
  }, 90000);

  it('backfills a heuristic placeholder rather than leaving a fill step blank when the repair also omits value', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const aiProvider = new ScriptedAIProvider([flowMissingValue, flowMissingValue]);
    const agent = new DiscoveryAgent();

    const draft = await agent.discover({
      targetUrl: baseUrl,
      productId: 'fixture-product',
      outputDir: path.join(outputDir, 'backfilled'),
      aiProvider,
    });

    expect(aiProvider.calls).toBe(2);
    const flow = draft.flows.find((f) => f.id === 'FLOW-LOGIN');
    const fillStep = flow?.steps.find((s) => s.action === 'fill');
    // Never silently blank -- and the heuristic should recognize the "email" hint in the selector.
    expect(fillStep?.value).toBeTruthy();
    expect(fillStep?.value).toBe('test.user@example.com');
    expect(
      warnSpy.mock.calls.some((call) => String(call[0]).includes('backfilling with a placeholder'))
    ).toBe(true);

    warnSpy.mockRestore();
  }, 90000);
});
