import { describe, it, expect } from 'vitest';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { interpretRule } from '../src/discovery/interpret.js';

const answering = (text: string): AIProvider =>
  ({ providerType: 'mock', generateText: async () => text }) as unknown as AIProvider;

const ask = (text: string) =>
  interpretRule({
    sentence: 'Nothing should break',
    flow: { name: 'Journey', startPage: '/', steps: [] } as never,
    draft: { pages: [] },
    ai: answering(text),
  });

describe('interpretRule reads the AI answer like the planner does', () => {
  it('finds the object inside chatter and forgives a trailing comma', async () => {
    const out = await ask(
      'Sure! Here it is:\n{"checkable": true, "expected": {"kind": "nothing-breaks"},}\nHope that helps.'
    );
    expect(out).toMatchObject({ ok: true, rule: { checkable: true } });
  });
  it('still reads a fenced answer', async () => {
    const out = await ask('```json\n{"checkable": true, "expected": {"kind": "nothing-breaks"}}\n```');
    expect(out).toMatchObject({ ok: true, rule: { checkable: true } });
  });
  it('keeps the rule as a note for a person when the answer is not JSON', async () => {
    const out = await ask('I cannot help with that.');
    expect(out).toMatchObject({ ok: true, rule: { checkable: false } });
  });
});
