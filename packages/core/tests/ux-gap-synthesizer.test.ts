import { describe, it, expect } from 'vitest';
import type { FrictionScorecard, ReferenceFlow } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { UXGapSynthesizer } from '../src/competitive/ux-gap-synthesizer.js';

const flow = (name: string) => ({ id: name, name, steps: [] }) as unknown as ReferenceFlow;
const score = (requiredFieldsCount: number) =>
  ({ totalSteps: 3, totalFields: 5, requiredFieldsCount, frictionIndex: 10 }) as unknown as FrictionScorecard;

const answer = JSON.stringify([
  {
    category: 'UX Polish',
    title: 'From the AI',
    effort: 'Low',
    impact: 'High',
    rationale: 'why',
    suggestedAction: 'do it',
  },
]);

/** A provider whose class name is "MockAIProvider" but which is a real one. */
class MockAIProvider {
  constructor(public readonly providerType: AIProvider['providerType']) {}
  calls = 0;
  async generateText(): Promise<string> {
    this.calls++;
    return answer;
  }
}

const run = (ai: MockAIProvider) =>
  new UXGapSynthesizer().synthesize(flow('ours'), flow('theirs'), score(2), score(2), ai as unknown as AIProvider);

describe('UXGapSynthesizer AI step', () => {
  it('does not ask a provider whose providerType is mock', async () => {
    const ai = new MockAIProvider('mock');
    await run(ai);
    expect(ai.calls).toBe(0);
  });
  it('asks a real provider even when its class is named MockAIProvider', async () => {
    const ai = new MockAIProvider('openai');
    const recs = await run(ai);
    expect(ai.calls).toBe(1);
    expect(recs.some((r) => r.title === 'From the AI')).toBe(true);
  });
});
