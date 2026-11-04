import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, buildRunBody, scrub, loadCheckupDocuments, redactIngest, zeroYield } from '../src/checkup.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** All .ts, .tsx and .css text under a folder, joined. */
async function sourceText(dir: string): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const parts = await Promise.all(
    entries.map((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return sourceText(p);
      return /\.(tsx?|css)$/.test(e.name) ? fs.readFile(p, 'utf8') : '';
    })
  );
  return parts.join('\n');
}

/** Curly and straight quotes are the same character for this check. */
const plainQuotes = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

const base = { QA_TARGET_URL: 'https://x.test' } as NodeJS.ProcessEnv;
const roles = JSON.stringify([
  { role: 'admin', username: 'admin@x.test', password: 'Adm1n-pw-77', loginPath: '/admin/login' },
  { role: 'guest', username: 'guest@x.test', password: 'Gu3st-pw-55' },
]);

describe('wizard labels', () => {
  it('the palette jump label matches its section name', async () => {
    const palette = await fs.readFile(
      path.join(root, 'packages', 'wizard', 'src', 'components', 'CommandPalette.tsx'),
      'utf8'
    );
    expect(palette).toContain("'Jump to Product context and design notes'");
  });
});

describe('checkup --docs and several roles', () => {
  it('--docs takes paths until the next flag and keeps them out of URL detection', () => {
    const a = parseArgs(['--docs', 'a.md', 'b.docx', '--staging', 'https://app.test'], {} as NodeJS.ProcessEnv);
    expect(a.docs).toEqual(['a.md', 'b.docx']);
    expect(a.url).toBe('https://app.test');
    expect(a.staging).toBe(true);
  });

  it('QA_DOCS splits on semicolons', () => {
    expect(parseArgs([], { ...base, QA_DOCS: 'a.md; b.txt;' }).docs).toEqual(['a.md', 'b.txt']);
    expect(parseArgs([], base).docs).toEqual([]);
  });

  it('QA_ROLES adds roles after the member role; signIn stays the first', () => {
    const a = parseArgs([], { ...base, QA_USERNAME: 'm@x.test', QA_PASSWORD: 'M-pw-1', QA_ROLES: roles });
    expect(a.signIns.map((r) => r.role)).toEqual(['member', 'admin', 'guest']);
    expect(a.signIn?.username).toBe('m@x.test');
    expect(a.signIns[1].loginPath).toBe('/admin/login');
  });

  it('rejects bad QA_ROLES; no flag reads roles', () => {
    expect(() => parseArgs([], { ...base, QA_ROLES: 'nope' })).toThrow(/QA_ROLES/);
    expect(() => parseArgs([], { ...base, QA_ROLES: '[{"role":"a"}]' })).toThrow(/username and a password/);
    expect(parseArgs(['--roles', roles], base).signIns).toEqual([]);
  });

  it('body has owner, consent, all roles and documents', () => {
    const args = parseArgs([], { ...base, QA_ROLES: roles });
    const body = buildRunBody(args, [{ name: 'a.md', text: '# A' }]);
    expect(body).toMatchObject({ owner: true, signInConsent: true, contextDocuments: [{ name: 'a.md' }] });
    expect((body.roles as unknown[]).length).toBe(2);
    const none = buildRunBody(parseArgs([], base));
    expect(none).not.toHaveProperty('contextDocuments');
    expect(none).not.toHaveProperty('signInConsent');
  });

  it('scrub hides every username and password', () => {
    const args = parseArgs([], { ...base, QA_USERNAME: 'm@x.test', QA_PASSWORD: 'M-pw-1', QA_ROLES: roles });
    const out = scrub('m@x.test M-pw-1 admin@x.test Adm1n-pw-77 guest@x.test Gu3st-pw-55', args);
    expect(out).not.toMatch(/@x\.test|-pw-/);
    expect(scrub('Adm1n-pw-77', args.signIns)).toBe('[hidden]');
  });

  describe('documents', () => {
    const dir = path.join(os.tmpdir(), `qa-checkup-docs-${process.pid}`);
    afterAll(() => fs.rm(dir, { recursive: true, force: true }));

    it('reads .md, hides password text, rejects other types and missing files', async () => {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'a.md'), '# Login\n- Sign in\npassword: hunter2\n');
      await fs.writeFile(path.join(dir, 'b.pdf'), 'x');
      const docs = await loadCheckupDocuments([path.join(dir, 'a.md')]);
      expect(docs[0].name).toBe('a.md');
      expect(docs[0].text).not.toContain('hunter2');
      expect(docs[0].text).toContain('[hidden]');
      await expect(loadCheckupDocuments([path.join(dir, 'b.pdf')])).rejects.toThrow(/b\.pdf/);
      await expect(loadCheckupDocuments([path.join(dir, 'missing.md')])).rejects.toThrow(/Could not read/);
    });

    it('redactIngest and zeroYield', () => {
      expect(redactIngest('Password = abc and PASSWORD:xyz')).toBe('[hidden] and [hidden]');
      expect(zeroYield('')).toBe(true);
      expect(zeroYield('# Heading\n- a requirement\n')).toBe(false);
    });
  });
});
