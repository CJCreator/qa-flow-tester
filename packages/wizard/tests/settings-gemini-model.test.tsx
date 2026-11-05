import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGeminiModels, saveAiSettings } from '../src/api';
import { GeminiModelSelect } from '../src/components/GeminiModelSelect';

const LIST = {
  models: [
    { id: 'gemini-2.5-flash', recommended: true },
    { id: 'gemini-2.5-flash-lite', recommended: false },
  ],
  current: 'gemini-2.5-flash',
  chosenBy: 'auto' as const,
};

function reply(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

afterEach(() => vi.unstubAllGlobals());

function render(props: Partial<Parameters<typeof GeminiModelSelect>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(GeminiModelSelect, {
      list: LIST,
      value: '',
      onChange: () => undefined,
      savedModel: 'gemini-2.5-flash',
      ...props,
    })
  );
}

describe('Settings: Gemini model', () => {
  it('renders automatic first, then the models, marking the recommended one', () => {
    const html = render();
    const auto = html.indexOf('Choose automatically (recommended)');
    expect(auto).toBeGreaterThan(-1);
    expect(auto).toBeLessThan(html.indexOf('gemini-2.5-flash'));
    expect(html).toContain('gemini-2.5-flash (recommended)');
    expect(html).toContain('>gemini-2.5-flash-lite<');
    expect(html).toContain('adc');
  });

  it('warns about a -latest name and suggests automatic', () => {
    const html = render({ savedModel: 'gemini-flash-latest', value: 'gemini-flash-latest' });
    expect(html).toContain('only works on Google AI Studio');
    expect(html).toContain('Choose automatically');
    expect(render()).not.toContain('Google AI Studio');
  });

  it('shows the model note as a warning', () => {
    expect(render({ note: 'This key has no prepaid credit.' })).toContain('This key has no prepaid credit.');
  });

  it('getGeminiModels reads the list and reports a 400 error', async () => {
    vi.stubGlobal('fetch', reply(200, LIST));
    expect((await getGeminiModels()).models).toHaveLength(2);
    vi.stubGlobal('fetch', reply(400, { error: 'No Gemini key is saved.' }));
    await expect(getGeminiModels()).rejects.toThrow('No Gemini key is saved.');
  });

  it('choosing automatically sends model: null and returns modelNote', async () => {
    const fetchMock = reply(200, {
      saved: true,
      provider: 'gemini',
      configured: true,
      model: null,
      modelNote: 'No credit.',
    });
    vi.stubGlobal('fetch', fetchMock);
    const saved = await saveAiSettings({ provider: 'gemini', model: null });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/ai/settings');
    expect(JSON.parse(init.body)).toEqual({ provider: 'gemini', model: null });
    expect(saved.modelNote).toBe('No credit.');
  });

  it('OpenRouter keeps its own model selects', () => {
    const src = readFileSync(new URL('../src/screens/SettingsScreen.tsx', import.meta.url), 'utf8');
    expect(src).toContain('listFreeModels');
    expect(src).toContain('Writes the plan');
    expect(src).toContain('{openRouter ? (');
  });
});
