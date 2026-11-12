import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  fillOrigin,
  siteOrigin,
  TEMPLATED,
  // @ts-expect-error plain .mjs script without type declarations
} from '../../../scripts/site-output.mjs';

const exitCodeAtImport = process.exitCode;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

describe('site-output', () => {
  it('does nothing on import', () => {
    expect(process.exitCode).toBe(exitCodeAtImport);
  });

  it('siteOrigin accepts an http(s) origin and trims the slash', () => {
    expect(siteOrigin('https://site.example/')).toBe('https://site.example');
    expect(siteOrigin('https://site.example')).toBe('https://site.example');
    expect(siteOrigin('http://site.example:3000/')).toBe('http://site.example:3000');
    expect(siteOrigin(undefined)).toBeNull();
    expect(siteOrigin('')).toBeNull();
    expect(siteOrigin('site.example')).toBeNull();
    expect(siteOrigin('https://site.example/path')).toBeNull();
    expect(siteOrigin('javascript:x')).toBeNull();
  });

  it('fillOrigin replaces the placeholder in templated files only', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'qa-site-output-'));
    try {
      const assetsDir = path.join(dir, 'assets');
      await mkdir(assetsDir, { recursive: true });

      const htmlPath = path.join(dir, 'index.html');
      const robotsPath = path.join(dir, 'robots.txt');
      const sitemapPath = path.join(dir, 'sitemap.xml');
      const jsPath = path.join(assetsDir, 'app.js');
      const pngPath = path.join(dir, 'og-image.png');

      const htmlContent = '<link rel="canonical" href="%ORIGIN%/">';
      const robotsContent = 'Sitemap: %ORIGIN%/sitemap.xml';
      const sitemapContent = '<loc>%ORIGIN%/</loc>';
      const jsContent = 'const x = "%ORIGIN%";';
      const pngBytes = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x25, 0x4f, 0x52, 0x49, 0x47, 0x49, 0x4e, 0x25,
      ]);

      await writeFile(htmlPath, htmlContent, 'utf8');
      await writeFile(robotsPath, robotsContent, 'utf8');
      await writeFile(sitemapPath, sitemapContent, 'utf8');
      await writeFile(jsPath, jsContent, 'utf8');
      await writeFile(pngPath, pngBytes);

      const changed = fillOrigin(dir, 'https://site.example');
      expect(changed).toBe(3);

      expect(await readFile(htmlPath, 'utf8')).toBe('<link rel="canonical" href="https://site.example/">');
      expect(await readFile(robotsPath, 'utf8')).toBe('Sitemap: https://site.example/sitemap.xml');
      expect(await readFile(sitemapPath, 'utf8')).toBe('<loc>https://site.example/</loc>');

      expect(await readFile(htmlPath, 'utf8')).not.toContain('%ORIGIN%');
      expect(await readFile(robotsPath, 'utf8')).not.toContain('%ORIGIN%');
      expect(await readFile(sitemapPath, 'utf8')).not.toContain('%ORIGIN%');

      expect(await readFile(jsPath, 'utf8')).toBe(jsContent);
      expect(await readFile(pngPath)).toEqual(pngBytes);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('the wizard has no placeholder outside templated files', async () => {
    const wizardRoot = path.join(root, 'packages', 'wizard');
    const publicDir = path.join(wizardRoot, 'public');
    const indexHtml = path.join(wizardRoot, 'index.html');

    const files: string[] = [indexHtml];
    function walk(dir: string) {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          files.push(full);
        }
      }
    }
    walk(publicDir);

    const outside: string[] = [];
    for (const file of files) {
      const content = await readFile(file);
      if (content.includes('%ORIGIN%')) {
        const ext = path.extname(file);
        if (!TEMPLATED.has(ext)) {
          outside.push(file);
        }
      }
    }
    expect(outside).toEqual([]);
  });

  it('the sample report preview image is absolute', async () => {
    const sampleReportPath = path.join(root, 'packages', 'wizard', 'public', 'sample-report.html');
    const html = await readFile(sampleReportPath, 'utf8');
    expect(html).toContain('content="%ORIGIN%/og-image.png"');
    expect(html).not.toContain('content="/favicon.svg"');
  });
});
