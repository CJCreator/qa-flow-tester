import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WIZARD = join(__dirname, '..');

describe('share image', () => {
  it('og:image and twitter:image point at og-image.png', () => {
    const html = readFileSync(join(WIZARD, 'index.html'), 'utf8');
    expect(html).toMatch(/property="og:image" content="%ORIGIN%\/og-image\.png"/);
    expect(html).toMatch(/name="twitter:image" content="%ORIGIN%\/og-image\.png"/);
    expect(html).toMatch(/og:image:width" content="1200"/);
    expect(html).toMatch(/og:image:height" content="630"/);
  });

  it('no og-image.svg reference remains in packages/wizard', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (['node_modules', 'dist', 'tests'].includes(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(html|tsx?|mjs|json|css)$/.test(name) && readFileSync(p, 'utf8').includes('og-image.svg'))
          hits.push(p);
      }
    };
    walk(WIZARD);
    expect(hits).toEqual([]);
  });

  it('og-image.png is a 1200x630 PNG', () => {
    const file = join(WIZARD, 'public', 'og-image.png');
    expect(existsSync(file)).toBe(true);
    const b = readFileSync(file);
    expect([...b.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(b.readUInt32BE(16)).toBe(1200);
    expect(b.readUInt32BE(20)).toBe(630);
    expect(b.length).toBeLessThan(500 * 1024);
  });
});
