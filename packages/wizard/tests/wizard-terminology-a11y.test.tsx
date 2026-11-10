import { createElement } from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  vi.stubGlobal('window', {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { origin: 'http://localhost:3001', pathname: '/', search: '' },
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'audit' ? [] : walk(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('status indicators (W7)', () => {
  it('a Spinner is a labelled status message', async () => {
    const { Spinner } = await import('../src/components/text');
    const html = renderToStaticMarkup(createElement(Spinner, { label: 'Starting…' }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Starting…"');
  });

  it('the in-progress dot in the top bar is a labelled status', () => {
    const src = readFileSync(join(SRC, 'components/TopBar.tsx'), 'utf8');
    expect(src).toContain('aria-label="A check-up is in progress" role="status"');
  });
});

describe('aria-label matches visible text (W9)', () => {
  it('the New check-up button on Past check-ups keeps its visible words in the name', () => {
    const src = readFileSync(join(SRC, 'screens/PastCheckupsScreen.tsx'), 'utf8');
    expect(src).toContain('aria-label={`New check-up of this site, ${run.host}`}');
    expect(src).not.toContain('aria-label={`New check-up of ${run.host}`}');
  });
});

describe('mobile gutter (W5)', () => {
  it('the area navigation list uses a 16px inner gutter and no negative margin at phone width', () => {
    const src = readFileSync(join(SRC, 'components/AreaNav.tsx'), 'utf8');
    expect(src).toContain('-mx-4 flex items-center gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0');
    expect(src).not.toContain('-mx-3');
  });
});

describe('terminology (W4)', () => {
  it('uses no banned UI terms in wizard source outside the audit screens', () => {
    const banned = /Stop scanning|Keep scanning|Scanning[ …`]|while scanning|is scanning the|Run ID|run ID|Copy run/;
    const hits = walk(SRC).filter((file) => banned.test(readFileSync(file, 'utf8')));
    expect(hits).toEqual([]);
  });
});

describe('Settings row buttons name their row', () => {
  const settings = readFileSync(new URL('../src/screens/SettingsScreen.tsx', import.meta.url), 'utf8');
  it.each([
    "aria-label={`${s.enabled ? 'Pause' : 'Resume'} the scheduled check-up of ${s.targetUrl}`}",
    'aria-label={`Delete the scheduled check-up of ${s.targetUrl}`}',
    'aria-label={`Test it: the ${s.role} sign-in for ${site.host}`}',
    'aria-label={`Forget the ${s.role} sign-in for ${site.host}`}',
  ])('has %s', (label) => {
    expect(settings).toContain(label);
  });
});
