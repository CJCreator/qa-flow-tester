import { describe, it, expect, vi } from 'vitest';
import type { AIMessage, AIProviderType } from '@qa/types';
import { DEFAULT_REWRITE_OVERLAP_WORDS } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { auditAiRequestBudget, resolveAuditAi, type AuditAiRequestBudget } from '../src/audit/ai/stage-ai.js';
import { findOverlaps, overlapThreshold, overlapWords, writeRewrite } from '../src/audit/ai/rewrite.js';

const TEST_KEY = 'test-key-not-real';

const ORIGINAL =
  'Fresh bread baked every morning in our family kitchen. Call us to order cakes for birthdays and weddings.';

/** A provider answering from a script, one entry per request; records every request. */
function scripted(script: Array<string | Error>) {
  const requests: AIMessage[][] = [];
  const stages: Array<string | undefined> = [];
  const provider: AIProvider = {
    providerType: 'mock',
    async generateText(messages, options) {
      requests.push(messages);
      stages.push(options?.stage);
      const next = script.shift();
      if (next === undefined) throw new Error('script ran out');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { provider, requests, stages };
}

async function aiWith(provider: AIProvider, budget?: AuditAiRequestBudget) {
  const createProvider = vi.fn((_type: AIProviderType, _key: string) => provider);
  const resolution = await resolveAuditAi({
    setup: { provider: 'mock' },
    keys: { resolveKey: async () => ({ provider: 'mock', apiKey: TEST_KEY, source: 'env' }) },
    createProvider,
    budget,
  });
  if (!resolution.ok) throw new Error('expected an AI');
  return resolution.ai;
}

describe('findOverlaps', () => {
  it('uses 6 words by default', () => {
    expect(DEFAULT_REWRITE_OVERLAP_WORDS).toBe(6);
    expect(overlapThreshold(undefined)).toBe(6);
    expect(overlapThreshold(0)).toBe(6);
    expect(overlapThreshold(Number.NaN)).toBe(6);
    expect(overlapThreshold(4.7)).toBe(4);
  });

  it('flags a run of exactly the threshold and not one word shorter', () => {
    const original = 'one two three four five six seven eight';
    expect(findOverlaps(original, 'alpha one two three four five six omega', 6)).toEqual([
      { words: 'one two three four five six', wordCount: 6 },
    ]);
    expect(findOverlaps(original, 'alpha one two three four five omega', 6)).toEqual([]);
  });

  it('merges overlapping windows into one maximal run', () => {
    const flags = findOverlaps(ORIGINAL, 'We say: fresh bread baked every morning in our family kitchen, always.', 6);
    expect(flags).toEqual([{ words: 'fresh bread baked every morning in our family kitchen', wordCount: 9 }]);
  });

  it('ignores letter case and punctuation', () => {
    const flags = findOverlaps(ORIGINAL, 'FRESH, bread -- baked; every "morning" in our... Family!', 6);
    expect(flags).toEqual([{ words: 'fresh bread baked every morning in our family', wordCount: 8 }]);
  });

  it('finds separate runs in proposal order, each once', () => {
    const proposal =
      'call us to order cakes for birthdays today. Also fresh bread baked every morning in our shop. ' +
      'Call us to order cakes for birthdays!';
    expect(findOverlaps(ORIGINAL, proposal, 6)).toEqual([
      { words: 'call us to order cakes for birthdays', wordCount: 7 },
      { words: 'fresh bread baked every morning in our', wordCount: 7 },
    ]);
  });

  it('works on Tamil text: vowel signs and virama stay in the word', () => {
    const tamil = 'எங்கள் கடையில் தினமும் காலை புதிய ரொட்டி சுடப்படுகிறது. கேக் ஆர்டர் செய்ய அழைக்கவும்.';
    expect(overlapWords('சுடப்படுகிறது.')).toEqual(['சுடப்படுகிறது']);
    const copied = 'இங்கே எங்கள் கடையில் தினமும் காலை புதிய ரொட்டி கிடைக்கும்.';
    expect(findOverlaps(tamil, copied, 6)).toEqual([
      { words: 'எங்கள் கடையில் தினமும் காலை புதிய ரொட்டி', wordCount: 6 },
    ]);
    // A different vowel sign makes a different word: no run of 6.
    const changed = 'எங்கள் கடையில் தினமும் காலை புதிய ரொட்டீ கிடைக்கும்.';
    expect(findOverlaps(tamil, changed, 6)).toEqual([]);
  });

  it('compares composed and decomposed forms alike', () => {
    const original = 'Café open from nine to five every day';
    const proposal = 'Café open from nine to five every week';
    expect(findOverlaps(original, proposal, 6)).toHaveLength(1);
  });

  it('returns nothing for empty or short texts', () => {
    expect(findOverlaps('', 'anything at all here now', 3)).toEqual([]);
    expect(findOverlaps(ORIGINAL, '', 3)).toEqual([]);
    expect(findOverlaps('a b', 'a b', 3)).toEqual([]);
  });
});

describe('writeRewrite', () => {
  const FRESH = 'Every day our home kitchen bakes new loaves. Ring us for celebration cakes.';

  it('sends one rewrite-stage request with the Section text, the language and the rules', async () => {
    const { provider, requests, stages } = scripted([FRESH]);
    const result = await writeRewrite(await aiWith(provider), { sectionText: ORIGINAL, language: 'ta' });
    expect(result).toEqual({ ok: true, text: FRESH, overlaps: [] });
    expect(requests).toHaveLength(1);
    expect(stages).toEqual(['rewrite']);
    const all = requests[0].map((m) => m.content).join('\n');
    expect(all).toContain(JSON.stringify(ORIGINAL));
    expect(all).toContain('Tamil (ta)');
    expect(all).toMatch(/do not reuse the original wording/i);
    expect(all).toMatch(/never invent facts such as prices, phone numbers/i);
  });

  it('retries once naming the flagged phrases, and keeps the retry', async () => {
    const copied = 'Fresh bread baked every morning in our family kitchen. Ring us for cakes.';
    const { provider, requests } = scripted([copied, FRESH]);
    const result = await writeRewrite(await aiWith(provider), { sectionText: ORIGINAL, language: 'en' });
    expect(result).toEqual({ ok: true, text: FRESH, overlaps: [] });
    expect(requests).toHaveLength(2);
    const retry = requests[1][requests[1].length - 1].content;
    expect(retry).toContain('"fresh bread baked every morning in our family kitchen"');
  });

  it('returns the overlaps when the retry still copies (no third request)', async () => {
    const copied = 'Fresh bread baked every morning in our family kitchen. Ring us for cakes.';
    const { provider, requests } = scripted([copied, copied]);
    const result = await writeRewrite(await aiWith(provider), { sectionText: ORIGINAL, language: 'en' });
    expect(requests).toHaveLength(2);
    expect(result.ok && result.overlaps.length).toBe(1);
  });

  it('uses the configured threshold', async () => {
    const answer = 'Our bread baked every morning, delivered.';
    const { provider, requests } = scripted([answer]);
    const result = await writeRewrite(await aiWith(provider), {
      sectionText: ORIGINAL,
      language: 'en',
      overlapWords: 10,
    });
    expect(requests).toHaveLength(1);
    expect(result).toEqual({ ok: true, text: answer, overlaps: [] });
  });

  it('never keeps copy with a claim word', async () => {
    const { provider } = scripted(['Our certified bakery bakes loaves daily.', 'A secure way to buy loaves daily.']);
    const result = await writeRewrite(await aiWith(provider), { sectionText: ORIGINAL, language: 'en' });
    expect(result).toEqual({ ok: false, problem: 'claim-words' });
  });

  it('reports a provider failure without its text, and a spent budget without a request', async () => {
    const failing = scripted([new Error('upstream said secret-thing')]);
    expect(await writeRewrite(await aiWith(failing.provider), { sectionText: ORIGINAL, language: 'en' })).toEqual({
      ok: false,
      problem: 'failed',
    });

    const spent = scripted([FRESH]);
    const result = await writeRewrite(await aiWith(spent.provider, auditAiRequestBudget(0)), {
      sectionText: ORIGINAL,
      language: 'en',
    });
    expect(result).toEqual({ ok: false, problem: 'budget-spent' });
    expect(spent.requests).toHaveLength(0);
  });

  it('passes a caller stop on', async () => {
    const { provider, requests } = scripted([FRESH]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      writeRewrite(await aiWith(provider), { sectionText: ORIGINAL, language: 'en', signal: controller.signal })
    ).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
});
