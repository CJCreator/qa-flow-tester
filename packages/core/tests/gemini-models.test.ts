import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  listGeminiModels,
  rankGeminiModels,
  pickGeminiModel,
  workingGeminiModel,
  explainGeminiListError,
} from '../src/ai/gemini-models.js';
import { GeminiProvider } from '../src/ai/providers/gemini.js';

const STUDIO = 'https://generativelanguage.googleapis.com/v1beta';

interface Call {
  url: string;
  method: string;
  body?: string;
}

type Answer = { status: number; body: unknown } | Error;

/**
 * A fake fetch for AI Studio: `list` answers the model list (one answer per page, or one for every page),
 * `probe[model]` answers generateContent for that model (200 OK when not set).
 */
function fakeStudio(setup: { list: Answer | Answer[]; probe?: Record<string, Answer> }) {
  const calls: Call[] = [];
  let page = 0;
  const respond = (a: Answer) => {
    if (a instanceof Error) throw a;
    return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), { status: a.status });
  };
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
    if (url.startsWith(`${STUDIO}/models?`)) {
      const answers = Array.isArray(setup.list) ? setup.list : [setup.list];
      return respond(answers[Math.min(page++, answers.length - 1)]);
    }
    const m = /\/models\/([^:]+):generateContent/.exec(url);
    if (m) {
      const model = decodeURIComponent(m[1]);
      return respond(
        setup.probe?.[model] ?? {
          status: 200,
          body: { candidates: [{ content: { parts: [{ text: `ok:${model}` }] }, finishReason: 'STOP' }] },
        }
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return {
    fetchFn,
    calls,
    listCalls: () => calls.filter((c) => c.url.startsWith(`${STUDIO}/models?`)),
    probeCalls: () => calls.filter((c) => c.url.includes(':generateContent')),
  };
}

const model = (id: string, methods = ['generateContent', 'countTokens']) => ({
  name: `models/${id}`,
  supportedGenerationMethods: methods,
});
const listOf = (...ids: string[]) => ({ status: 200, body: { models: ids.map((id) => model(id)) } });

const KEY = 'AIzaFAKE-test-key-0123456789';
const KEY_INVALID_BODY = {
  error: {
    code: 400,
    message: `API key not valid. Please pass a valid API key. (${KEY})`,
    status: 'INVALID_ARGUMENT',
    details: [{ reason: 'API_KEY_INVALID' }],
  },
};
const NOT_FOUND_BODY = {
  error: { code: 404, message: 'models/x is not found for API version v1beta', status: 'NOT_FOUND' },
};
const PREPAID_BODY = {
  error: { code: 402, message: 'Your prepayment credits are depleted.', status: 'FAILED_PRECONDITION' },
};
const EXHAUSTED_BODY = {
  error: { code: 429, message: 'You exceeded your current quota.', status: 'RESOURCE_EXHAUSTED' },
};

describe('listGeminiModels', () => {
  it('follows nextPageToken, keeps generateContent models and drops the models/ prefix', async () => {
    const studio = fakeStudio({
      list: [
        {
          status: 200,
          body: {
            models: [model('gemini-2.5-flash'), model('text-embedding-004', ['embedContent'])],
            nextPageToken: 'page 2',
          },
        },
        { status: 200, body: { models: [model('gemini-2.0-flash'), model('gemini-2.5-flash')] } },
      ],
    });
    expect(await listGeminiModels(KEY, { fetchFn: studio.fetchFn })).toEqual(['gemini-2.5-flash', 'gemini-2.0-flash']);
    const [first, second] = studio.listCalls();
    expect(first.url).toBe(`${STUDIO}/models?key=${KEY}&pageSize=1000`);
    expect(second.url).toBe(`${STUDIO}/models?key=${KEY}&pageSize=1000&pageToken=page%202`);
    expect(studio.calls).toHaveLength(2);
  });

  it('throws an error with the HTTP status and without the key', async () => {
    const studio = fakeStudio({ list: { status: 400, body: KEY_INVALID_BODY } });
    const err = (await listGeminiModels(KEY, { fetchFn: studio.fetchFn }).catch((e) => e)) as Error;
    expect(err.message).toMatch(/^Gemini API error \(400\): API key not valid/);
    expect(err.message).not.toContain(KEY);
    expect(explainGeminiListError(err).reason).toBe('key-invalid');
  });

  it('keeps the key out of a failed fetch too', async () => {
    const studio = fakeStudio({ list: new Error(`connect ECONNREFUSED ${STUDIO}/models?key=${KEY}`) });
    const err = (await listGeminiModels(KEY, { fetchFn: studio.fetchFn }).catch((e) => e)) as Error;
    expect(err.message).toContain('ECONNREFUSED');
    expect(err.message).not.toContain(KEY);
    expect(explainGeminiListError(err).reason).toBe('network');
  });
});

describe('rankGeminiModels', () => {
  it('puts stable flash then flash-lite first, newest version first, then other stable Flash models', () => {
    const ids = [
      'gemini-2.0-flash-lite',
      'gemini-1.5-flash-8b',
      'gemini-2.0-flash-001',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
      'gemini-2.5-flash',
      'gemini-3-flash',
      'gemini-2.5-pro',
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
      'gemini-2.5-flash-preview-09-2025',
      'gemini-2.0-flash-exp',
      'gemini-2.0-flash-thinking-exp-01-21',
      'gemini-2.5-flash-image',
      'gemini-2.5-flash-preview-tts',
      'gemini-2.0-flash-live-001',
      'gemini-2.5-flash-native-audio-dialog',
      'gemini-embedding-001',
      'gemma-3-27b-it',
      'aqa',
      'learnlm-2.0-flash-experimental',
    ];
    expect(rankGeminiModels(ids)).toEqual([
      'gemini-3-flash',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-2.0-flash-001',
      'gemini-1.5-flash-8b',
    ]);
  });

  it('compares versions as numbers', () => {
    expect(rankGeminiModels(['gemini-2.5-flash', 'gemini-10-flash', 'gemini-2.10-flash'])).toEqual([
      'gemini-10-flash',
      'gemini-2.10-flash',
      'gemini-2.5-flash',
    ]);
  });

  it('uses preview and experimental Flash models only when no stable one is listed', () => {
    expect(
      rankGeminiModels([
        'gemini-2.5-flash-preview-09-2025',
        'gemini-flash-latest',
        'gemini-3-flash-preview',
        'gemini-2.0-flash-thinking-exp',
        'gemini-2.5-pro',
      ])
    ).toEqual(['gemini-3-flash-preview', 'gemini-2.5-flash-preview-09-2025']);
    expect(rankGeminiModels(['gemini-flash-latest', 'gemini-embedding-001'])).toEqual([]);
    expect(rankGeminiModels([])).toEqual([]);
  });
});

describe('pickGeminiModel', () => {
  it('lists, ranks and probes until a model answers: the second after a 404', async () => {
    const studio = fakeStudio({
      list: listOf('gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-flash-latest'),
      probe: { 'gemini-2.5-flash': { status: 404, body: NOT_FOUND_BODY } },
    });
    const pick = await pickGeminiModel(KEY, { fetchFn: studio.fetchFn });
    expect(pick).toEqual({
      ok: true,
      model: 'gemini-2.0-flash',
      tried: [
        { model: 'gemini-2.5-flash', status: 404 },
        { model: 'gemini-2.0-flash', status: 200 },
      ],
    });
    const probe = studio.probeCalls()[0];
    expect(probe.method).toBe('POST');
    expect(probe.url).toBe(`${STUDIO}/models/gemini-2.5-flash:generateContent?key=${KEY}`);
    expect(JSON.parse(probe.body!)).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }],
      generationConfig: { maxOutputTokens: 8 },
    });
  });

  it('probes at most maxProbes candidates (4 by default)', async () => {
    const ids = ['gemini-3-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    const missing = Object.fromEntries(ids.map((id) => [id, { status: 404, body: NOT_FOUND_BODY }]));
    const studio = fakeStudio({ list: listOf(...ids), probe: missing });
    const pick = await pickGeminiModel(KEY, { fetchFn: studio.fetchFn });
    expect(pick.ok).toBe(false);
    expect(pick.ok === false && pick.reason).toBe('no-model');
    expect(pick.tried).toHaveLength(4);
    const two = fakeStudio({ list: listOf(...ids), probe: missing });
    expect((await pickGeminiModel(KEY, { fetchFn: two.fetchFn, maxProbes: 2 })).tried).toHaveLength(2);
  });

  it('is no-credit when every probe answers 402 (prepaid credit used up)', async () => {
    const studio = fakeStudio({
      list: listOf('gemini-2.5-flash', 'gemini-2.0-flash'),
      probe: {
        'gemini-2.5-flash': { status: 402, body: PREPAID_BODY },
        'gemini-2.0-flash': { status: 402, body: PREPAID_BODY },
      },
    });
    const pick = await pickGeminiModel(KEY, { fetchFn: studio.fetchFn });
    expect(pick).toMatchObject({
      ok: false,
      reason: 'no-credit',
      tried: [
        { model: 'gemini-2.5-flash', status: 402 },
        { model: 'gemini-2.0-flash', status: 402 },
      ],
    });
    expect(pick.ok === false && pick.detail).toMatch(/no prepaid credit left/);
  });

  it('is no-credit when the probes answer 429 RESOURCE_EXHAUSTED', async () => {
    const studio = fakeStudio({
      list: listOf('gemini-2.5-flash'),
      probe: { 'gemini-2.5-flash': { status: 429, body: EXHAUSTED_BODY } },
    });
    const pick = await pickGeminiModel(KEY, { fetchFn: studio.fetchFn });
    expect(pick).toMatchObject({ ok: false, reason: 'no-credit', tried: [{ model: 'gemini-2.5-flash', status: 429 }] });
    expect(pick.ok === false && pick.detail).toMatch(/free Gemini requests are used up/);
  });

  it.each([
    [400, KEY_INVALID_BODY],
    [401, { error: { code: 401, message: 'Unauthorized', status: 'UNAUTHENTICATED' } }],
    [403, { error: { code: 403, message: 'Permission denied', status: 'PERMISSION_DENIED' } }],
  ])('is key-invalid when the model list answers %i, and probes nothing', async (status, body) => {
    const studio = fakeStudio({ list: { status, body } });
    const pick = await pickGeminiModel(KEY, { fetchFn: studio.fetchFn });
    expect(pick).toMatchObject({ ok: false, reason: 'key-invalid', tried: [] });
    expect(studio.probeCalls()).toHaveLength(0);
    expect(JSON.stringify(pick)).not.toContain(KEY);
  });

  it('is key-invalid when a probe says the key is not valid', async () => {
    const studio = fakeStudio({
      list: listOf('gemini-2.5-flash', 'gemini-2.0-flash'),
      probe: { 'gemini-2.5-flash': { status: 400, body: KEY_INVALID_BODY } },
    });
    const pick = await pickGeminiModel(KEY, { fetchFn: studio.fetchFn });
    expect(pick).toMatchObject({ ok: false, reason: 'key-invalid' });
    expect(studio.probeCalls()).toHaveLength(1);
  });

  it('is network when AI Studio cannot be reached, for the list or a probe', async () => {
    const down = fakeStudio({ list: new Error('fetch failed') });
    expect(await pickGeminiModel(KEY, { fetchFn: down.fetchFn })).toMatchObject({
      ok: false,
      reason: 'network',
      tried: [],
    });
    const flaky = fakeStudio({ list: listOf('gemini-2.5-flash'), probe: { 'gemini-2.5-flash': new Error('reset') } });
    expect(await pickGeminiModel(KEY, { fetchFn: flaky.fetchFn })).toMatchObject({
      ok: false,
      reason: 'network',
      tried: [{ model: 'gemini-2.5-flash', status: 0 }],
    });
  });

  it('is no-model when the key lists no usable model', async () => {
    const studio = fakeStudio({
      list: {
        status: 200,
        body: { models: [model('gemini-embedding-001', ['embedContent']), model('gemini-flash-latest')] },
      },
    });
    const pick = await pickGeminiModel(KEY, { fetchFn: studio.fetchFn });
    expect(pick).toMatchObject({ ok: false, reason: 'no-model', tried: [] });
    expect(studio.probeCalls()).toHaveLength(0);
  });

  it('gives a plain sentence without the key or JSON', async () => {
    const studio = fakeStudio({
      list: listOf('gemini-2.5-flash'),
      probe: { 'gemini-2.5-flash': { status: 402, body: PREPAID_BODY } },
    });
    const pick = await pickGeminiModel(KEY, { fetchFn: studio.fetchFn });
    const detail = pick.ok === false ? pick.detail : '';
    expect(detail).not.toContain(KEY);
    expect(detail).not.toMatch(/[{}]/);
  });
});

describe('workingGeminiModel', () => {
  it('remembers the model per key, and shares one pick between callers at the same time', async () => {
    const studio = fakeStudio({ list: listOf('gemini-2.5-flash') });
    const key = 'working-key-memo';
    const [a, b] = await Promise.all([
      workingGeminiModel(key, { fetchFn: studio.fetchFn }),
      workingGeminiModel(key, { fetchFn: studio.fetchFn }),
    ]);
    expect([a, b]).toEqual(['gemini-2.5-flash', 'gemini-2.5-flash']);
    expect(await workingGeminiModel(key, { fetchFn: studio.fetchFn })).toBe('gemini-2.5-flash');
    expect(studio.listCalls()).toHaveLength(1);
    expect(studio.probeCalls()).toHaveLength(1);

    const other = fakeStudio({ list: listOf('gemini-2.0-flash') });
    expect(await workingGeminiModel('working-key-other', { fetchFn: other.fetchFn })).toBe('gemini-2.0-flash');
  });

  it('picks again after 30 minutes', async () => {
    const studio = fakeStudio({ list: listOf('gemini-2.5-flash') });
    const key = 'working-key-ttl';
    const start = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      await workingGeminiModel(key, { fetchFn: studio.fetchFn });
      now.mockReturnValue(start + 29 * 60 * 1000);
      await workingGeminiModel(key, { fetchFn: studio.fetchFn });
      expect(studio.listCalls()).toHaveLength(1);
      now.mockReturnValue(start + 31 * 60 * 1000);
      await workingGeminiModel(key, { fetchFn: studio.fetchFn });
      expect(studio.listCalls()).toHaveLength(2);
    } finally {
      now.mockRestore();
    }
  });

  it('is null when no model works for the key', async () => {
    const studio = fakeStudio({ list: { status: 400, body: KEY_INVALID_BODY } });
    expect(await workingGeminiModel('working-key-bad', { fetchFn: studio.fetchFn })).toBeNull();
  });
});

describe('GeminiProvider with an AI Studio key: a missing model', () => {
  const realFetch = globalThis.fetch;
  let studio: ReturnType<typeof fakeStudio>;

  const okBody = (text: string) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });

  beforeEach(() => {
    // No Google sign-in on this computer: an unusable key is not sent to Vertex AI.
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/nonexistent/adc.json');
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
  });

  const use = (s: ReturnType<typeof fakeStudio>) => {
    studio = s;
    globalThis.fetch = s.fetchFn;
  };
  const ask = (key: string, m: string) => new GeminiProvider(key, m).complete([{ role: 'user', content: 'hi' }]);

  it('retries a 404 once with a model the key can use, and reports that model', async () => {
    use(
      fakeStudio({
        list: listOf('gemini-2.5-flash', 'gemini-flash-latest'),
        probe: {
          'gemini-flash-latest': { status: 404, body: NOT_FOUND_BODY },
          'gemini-2.5-flash': { status: 200, body: okBody('answer') },
        },
      })
    );
    const completion = await ask('provider-key-404', 'gemini-flash-latest');
    expect(completion.text).toBe('answer');
    expect(completion.model).toBe('gemini-2.5-flash');
    const generate = studio.probeCalls().map((c) => /models\/([^:]+):/.exec(c.url)![1]);
    // the request, the pick's probe, the retry
    expect(generate).toEqual(['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash']);
  });

  it('also retries a 400 that says the model is not supported', async () => {
    use(
      fakeStudio({
        list: listOf('gemini-2.0-flash'),
        probe: {
          'gemini-old': {
            status: 400,
            body: { error: { message: 'Model gemini-old is not supported for generateContent.' } },
          },
        },
      })
    );
    expect((await ask('provider-key-400', 'gemini-old')).model).toBe('gemini-2.0-flash');
  });

  it('throws the first answer when the working model is the one asked for, or none works', async () => {
    use(
      fakeStudio({
        list: listOf('gemini-2.5-flash'),
        probe: { 'gemini-2.5-flash': { status: 404, body: NOT_FOUND_BODY } },
      })
    );
    await expect(ask('provider-key-none', 'gemini-2.5-flash')).rejects.toThrow(/Gemini API error \(404\)/);
    // the request and the pick's one probe: no retry
    expect(studio.probeCalls()).toHaveLength(2);
  });

  it('does not retry a plain 400', async () => {
    use(
      fakeStudio({
        list: listOf('gemini-2.5-flash'),
        probe: { 'gemini-x': { status: 400, body: { error: { message: 'contents is empty' } } } },
      })
    );
    await expect(ask('provider-key-plain', 'gemini-x')).rejects.toThrow(/Gemini API error \(400\)/);
    expect(studio.listCalls()).toHaveLength(0);
  });
});
