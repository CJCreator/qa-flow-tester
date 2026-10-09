import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { buildIssuesModel } from '../src/issues-document.js';
import { renderIssuesHtml } from '../src/issues-html.js';
import { ReportGenerator } from '../src/reporter.js';
import { finding, report } from './helpers/issues-fixtures.js';

const dir = path.resolve(__dirname, './temp-issues-html-test');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

beforeEach(async () => {
  await fs.mkdir(path.join(dir, 'evidence'), { recursive: true });
  await fs.writeFile(path.join(dir, 'evidence', 'a.png'), PNG);
  await fs.writeFile(path.join(dir, 'secret.png'), PNG);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

const withShot = (p: string, title = 'Crash') =>
  buildIssuesModel(report([finding({ title, evidence: { screenshotPath: p } })]));

describe('issues.html is self-contained', () => {
  it('embeds screenshots as data: URIs and has no outside references', async () => {
    const html = await renderIssuesHtml(withShot('evidence/a.png'), dir);
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//i);
    expect(html).not.toMatch(/url\(\s*["']?(?:https?:)?\/\//i);
    expect(html).not.toMatch(/@import|@font-face/i);
    expect(html).toContain('@media print');
  });

  it('falls back to a text note when over the image budget', async () => {
    const html = await renderIssuesHtml(withShot('evidence/a.png'), dir, 10);
    expect(html).not.toContain('data:image');
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('Screenshot not embedded');
  });

  it('does not read a path outside the report folder', async () => {
    const html = await renderIssuesHtml(withShot('../temp-issues-html-test/../../package.json'), dir);
    expect(html).not.toContain('data:');
    const abs = await renderIssuesHtml(withShot(path.join(dir, '..', 'x.png')), dir);
    expect(abs).not.toContain('data:');
    expect(abs).toContain('Screenshot not embedded');
  });

  it('escapes a script in a finding title', async () => {
    const html = await renderIssuesHtml(withShot('evidence/a.png', '<script>alert(1)</script>'), dir);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('ReportGenerator writes issues.md and issues.html, embedding only files inside the report folder', async () => {
    const out = await new ReportGenerator(dir).generate(
      report([finding({ evidence: { screenshotPath: path.join(dir, 'evidence', 'a.png') } })])
    );
    const html = await fs.readFile(out.issuesHtmlPath, 'utf8');
    expect(html).toContain('data:image/png;base64,');
    expect(await fs.readFile(out.issuesMdPath, 'utf8')).toContain('## Roles not tested and why');
    const outside = await new ReportGenerator(dir).generate(
      report([finding({ evidence: { screenshotPath: path.resolve(dir, '..', '..', 'package.json') } })])
    );
    expect(await fs.readFile(outside.issuesHtmlPath, 'utf8')).not.toContain('data:');
  });
});
