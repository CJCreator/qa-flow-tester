import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { figmaVariablesToTokens, syncFigma, type FigmaVariablesResponse } from '../src/figma-sync.js';

const response: FigmaVariablesResponse = {
  meta: {
    variableCollections: { c1: { id: 'c1', defaultModeId: 'light' } },
    variables: {
      v1: {
        id: 'v1',
        name: 'Color/Brand/Primary',
        resolvedType: 'COLOR',
        variableCollectionId: 'c1',
        valuesByMode: { light: { r: 37 / 255, g: 99 / 255, b: 235 / 255, a: 1 }, dark: { r: 1, g: 1, b: 1, a: 1 } },
      },
      v2: {
        id: 'v2',
        name: 'Color/Danger',
        resolvedType: 'COLOR',
        variableCollectionId: 'c1',
        valuesByMode: { light: { type: 'VARIABLE_ALIAS', id: 'v5' } },
      },
      v3: {
        id: 'v3',
        name: 'Radius/md',
        resolvedType: 'FLOAT',
        variableCollectionId: 'c1',
        valuesByMode: { light: 8 },
      },
      v4: {
        id: 'v4',
        name: 'Font Size/Base',
        resolvedType: 'FLOAT',
        variableCollectionId: 'c1',
        valuesByMode: { light: 16 },
      },
      v5: {
        id: 'v5',
        name: 'Palette/Red 500',
        resolvedType: 'COLOR',
        variableCollectionId: 'c1',
        valuesByMode: { light: { r: 239 / 255, g: 68 / 255, b: 68 / 255, a: 0.5 } },
      },
      v6: {
        id: 'v6',
        name: 'Spacing/4',
        resolvedType: 'FLOAT',
        variableCollectionId: 'c1',
        valuesByMode: { light: 16 },
      },
    },
  },
};

describe('figmaVariablesToTokens', () => {
  it('maps default-mode variables to design tokens, resolving aliases', () => {
    const tokens = figmaVariablesToTokens(response);
    expect(tokens.colors).toEqual({
      primary: '#2563eb',
      danger: 'rgba(239, 68, 68, 0.5)',
      'red-500': 'rgba(239, 68, 68, 0.5)',
    });
    expect(tokens.borderRadius).toEqual({ md: '8px' });
    expect(tokens.fontSize).toEqual({ base: '16px' });
  });
});

describe('syncFigma', () => {
  const outDir = path.join(process.cwd(), '.tmp-figma-sync');
  afterEach(() => fs.rm(outDir, { recursive: true, force: true }));

  it('writes tokens and downloads requested frames as baselines', async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string) => {
      calls.push(url);
      if (url.includes('/variables/local')) return new Response(JSON.stringify(response));
      if (url.includes('/images/'))
        return new Response(JSON.stringify({ images: { '1:2': 'https://cdn.test/frame.png' } }));
      return new Response(new Uint8Array([137, 80, 78, 71]));
    }) as typeof fetch;

    const result = await syncFigma({
      fileKey: 'FILE',
      token: 'secret',
      tokensOut: path.join(outDir, 'design-tokens.json'),
      frames: { '1:2': 'TC-001-1440px' },
      baselineDir: path.join(outDir, 'baselines'),
      fetchImpl: fakeFetch,
    });

    expect(result.tokenCounts).toEqual({ colors: 3, borderRadius: 1, fontSize: 1 });
    const written = JSON.parse(await fs.readFile(result.tokensPath, 'utf8'));
    expect(written.colors.primary).toBe('#2563eb');
    expect(await fs.readFile(path.join(outDir, 'baselines', 'TC-001-1440px.png'))).toHaveLength(4);
    expect(calls[1]).toContain('ids=1%3A2');
  });

  it('explains a 403 from the Variables API', async () => {
    const fakeFetch = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
    await expect(
      syncFigma({ fileKey: 'F', token: 't', tokensOut: path.join(outDir, 't.json'), fetchImpl: fakeFetch })
    ).rejects.toThrow(/Enterprise/);
  });
});
