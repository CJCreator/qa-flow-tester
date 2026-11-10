import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANDING_TITLE, isPublicTitle } from '../src/lib/title';

describe('which screens may be indexed', () => {
  it.each([
    'New check-up',
    'Past check-ups',
    'Visual Baselines',
    'Compare with another site',
    'Get started',
    'Settings',
  ])('%s is private', (title) => {
    expect(isPublicTitle(title)).toBe(false);
  });
  it('only the landing page is public', () => {
    expect(isPublicTitle(LANDING_TITLE)).toBe(true);
  });
  it('the manifest uses the page background colour of index.html', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, '../public/manifest.webmanifest'), 'utf8').replace(/^﻿/, '')
    ) as { background_color: string; theme_color: string };
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
    expect(html).toContain(`content="${manifest.theme_color}"`);
    expect(manifest.background_color).toBe('#F4F6F4');
    expect(manifest.theme_color).toBe('#F4F6F4');
  });
});
