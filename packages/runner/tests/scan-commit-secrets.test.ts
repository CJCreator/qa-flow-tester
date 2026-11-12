import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isTemplatePlaceholder,
  listCommitFiles,
  parseArgs,
  parseGitleaksAllowlistPaths,
  // @ts-expect-error plain .mjs script without type declarations
} from '../../../scripts/scan-commit-secrets.mjs';

const ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(ROOT, 'scripts/scan-commit-secrets.mjs');

// Fake values are put together at run time, so this file holds no key-shaped text.
const KEY = ['sk', 'ant', 'api03', 'Q7wK2mZp9R'.repeat(6)].join('-');
const PASSWORD = ['Zq8vLm2', 'Np4Rt6Wx'].join('');
const GITLEAKS = "[allowlist]\npaths = ['''^fixtures/''', '''^packages/[^/]+/tests/''']\n";

// A stand-in for `aieos scan secrets --json --root <dir>` with the same output shape (an Anthropic key rule and a
// password assignment rule, previews as "abcd…(N chars)"). It records which files it read, next to itself.
const STUB = `
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[process.argv.indexOf('--root') + 1];
const rules = [
  ['anthropic-key', 'high', /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ['generic-secret-assignment', 'medium', /password\\s*[:=]\\s*["']([^"'\\s]{12,})["']/gi],
];
const findings = [];
const read = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    const rel = path.relative(root, full).split(path.sep).join('/');
    read.push(rel);
    fs.readFileSync(full, 'utf8').split(/\\r?\\n/).forEach((line, i) => {
      for (const [rule, severity, re] of rules) {
        for (const m of line.matchAll(re)) {
          const v = m[1] || m[0];
          findings.push({ file: rel, rule, severity, line: i + 1, preview: v.slice(0, 4) + '…(' + v.length + ' chars)' });
        }
      }
    });
  }
};
walk(root);
fs.writeFileSync(new URL('./read.json', import.meta.url), JSON.stringify({ root, read }));
process.stdout.write(JSON.stringify({ scanned: read.length, findings }));
`;

const temps: string[] = [];
const tempDir = (prefix: string) => {
  const d = mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(d);
  return d;
};
const put = (root: string, rel: string, content: string) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
};
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
};

/** A repository with clean tracked files, a .gitignore and the project's gitleaks allowlist. */
function makeRepo() {
  const repo = tempDir('qa-commit-scan-repo-');
  git(repo, 'init', '-q');
  put(repo, '.gitignore', '.env*\n!.env.example\n.claude/\nqa-report/\n');
  put(repo, '.gitleaks.toml', GITLEAKS);
  put(repo, 'src/app.ts', 'export const answer = 42;\n');
  put(repo, '.env.example', 'ANTHROPIC_API_KEY=\n');
  git(repo, 'add', '-A');
  return repo;
}

const stubDir = tempDir('qa-commit-scan-stub-');
const STUB_PATH = path.join(stubDir, 'aieos.mjs');
writeFileSync(STUB_PATH, STUB);
const stubRead = () =>
  JSON.parse(readFileSync(path.join(stubDir, 'read.json'), 'utf8')) as { root: string; read: string[] };

/** The real AI-EOS CLI when installed (AIEOS_CLI, or the Claude Code plugin cache); CI has only the stand-in. */
function findAieos(): string | null {
  if (process.env.AIEOS_CLI) return existsSync(process.env.AIEOS_CLI) ? process.env.AIEOS_CLI : null;
  const base = path.join(os.homedir(), '.claude/plugins/cache/ai-eos-marketplace/ai-eos');
  if (!existsSync(base)) return null;
  const found = readdirSync(base)
    .map((v) => path.join(base, v, 'scripts/aieos.mjs'))
    .filter((p) => existsSync(p));
  return found.length ? found[found.length - 1] : null;
}
const AIEOS = findAieos();

const run = (repo: string, aieos: string) => {
  const r = spawnSync(process.execPath, [SCRIPT, '--aieos', aieos, '--root', repo], { encoding: 'utf8' });
  return { code: r.status, output: `${r.stdout}${r.stderr}` };
};

afterEach(() => {
  for (const d of temps.splice(1)) rmSync(d, { recursive: true, force: true });
});
afterAll(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('commit secret scan: helpers', () => {
  it("reads the project's .gitleaks.toml allowlist: named test files only", () => {
    const res: RegExp[] = parseGitleaksAllowlistPaths(readFileSync(path.join(ROOT, '.gitleaks.toml'), 'utf8'));
    const allowed = (p: string) => res.some((re) => re.test(p));
    expect(allowed('packages/core/tests/ai-provider.test.ts')).toBe(true);
    expect(allowed('packages/core/tests/brand-new.test.ts')).toBe(false);
    expect(allowed('packages/runner/tests/helpers/anything.ts')).toBe(false);
    expect(allowed('packages/core/src/ai/openrouter.ts')).toBe(false);
    expect(allowed('fixtures/test-app/server.js')).toBe(false);
    expect(allowed('scripts/fixtures/x.js')).toBe(false);
    expect(allowed('packages/core/src/tests/x.ts')).toBe(false);
  });

  it('parses multi-line path arrays and skips per-rule allowlists', () => {
    const toml = [
      '[[rules]]',
      "id = 'x'",
      '[rules.allowlist]',
      "paths = ['''^docs/''']",
      '[[allowlists]]',
      'paths = [',
      "  '''^packages/[^/]+/tests/''',",
      '  "^fixtures/",',
      ']',
    ].join('\n');
    const res: RegExp[] = parseGitleaksAllowlistPaths(toml);
    expect(res).toHaveLength(2);
    const allowed = (p: string) => res.some((re) => re.test(p));
    expect(allowed('packages/wizard/tests/a.test.ts')).toBe(true);
    expect(allowed('fixtures/a.js')).toBe(true);
    expect(allowed('docs/a.md')).toBe(false);
  });

  it('requires --aieos', () => {
    expect(parseArgs([])).toBeNull();
    expect(parseArgs(['--root', '.'])).toBeNull();
    expect(parseArgs(['--aieos'])).toBeNull();
    expect(parseArgs(['--aieos', 'a.mjs', '--other', 'x'])).toBeNull();
    expect(parseArgs(['--aieos', 'a.mjs', '--root', 'r'])).toEqual({ aieos: 'a.mjs', root: 'r' });
  });

  it('lists tracked and new files, never git-ignored ones', () => {
    const repo = makeRepo();
    put(repo, 'src/new.ts', 'export {};\n');
    put(repo, '.env', `ANTHROPIC_API_KEY=${KEY}\n`);
    put(repo, '.env.local', `ANTHROPIC_API_KEY=${KEY}\n`);
    put(repo, '.claude/settings.json', '{}');
    put(repo, 'qa-report/report.html', `<p>${KEY}</p>`);
    expect(listCommitFiles(repo).sort()).toEqual([
      '.env.example',
      '.gitignore',
      '.gitleaks.toml',
      'src/app.ts',
      'src/new.ts',
    ]);
  });

  it('treats only a whole {{...}} value as a placeholder', () => {
    const dir = tempDir('qa-commit-scan-ph-');
    put(dir, 'a.yml', 'user: x\npassword: "{{SIGNIN_PASSWORD}}"\npassword: "{{a}}-real-secret-1"\n');
    const finding = (line: number, value: string) => ({
      file: 'a.yml',
      line,
      preview: `${value.slice(0, 4)}…(${value.length} chars)`,
    });
    expect(isTemplatePlaceholder(finding(2, '{{SIGNIN_PASSWORD}}'), dir)).toBe(true);
    expect(isTemplatePlaceholder(finding(3, '{{a}}-real-secret-1'), dir)).toBe(false);
    expect(isTemplatePlaceholder(finding(2, PASSWORD), dir)).toBe(false);
    expect(isTemplatePlaceholder({ file: 'a.yml', line: 2, preview: '****' }, dir)).toBe(false);
    expect(isTemplatePlaceholder(finding(2, '{{SIGNIN_PASSWORD}}'), tempDir('qa-commit-scan-empty-'))).toBe(false);
  });
});

describe('commit secret scan: command line', () => {
  it('exits 2 without --aieos, with a missing scanner, and when the scanner fails', () => {
    const repo = makeRepo();
    expect(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' }).status).toBe(2);
    expect(run(repo, path.join(stubDir, 'missing.mjs')).code).toBe(2);
    const broken = path.join(stubDir, 'broken.mjs');
    writeFileSync(broken, "process.stdout.write('not json'); process.exitCode = 0;\n");
    const r = run(repo, broken);
    expect(r.code).toBe(2);
    expect(r.output).toContain('AI-EOS scanner did not run');
  });

  it('copies only the commit set to the scanner, without allowlisted paths, and removes the copy', () => {
    const repo = makeRepo();
    put(repo, 'fixtures/app/keys.js', `const k = "${KEY}";\n`);
    put(repo, 'packages/core/tests/a.test.ts', `const k = "${KEY}";\n`);
    put(repo, '.env', `ANTHROPIC_API_KEY=${KEY}\n`);
    put(repo, '.claude/notes.md', KEY);
    put(repo, 'qa-report/report.html', KEY);
    put(repo, 'docs/new.md', '# notes\n');
    expect(run(repo, STUB_PATH).code).toBe(0);
    const { root, read } = stubRead();
    expect(read.sort()).toEqual(['.env.example', '.gitignore', '.gitleaks.toml', 'docs/new.md', 'src/app.ts']);
    expect(path.resolve(root).startsWith(path.resolve(repo))).toBe(false);
    expect(existsSync(root)).toBe(false);
  });

  it('fails on fixtures when the repository has no gitleaks allowlist', () => {
    const repo = makeRepo();
    rmSync(path.join(repo, '.gitleaks.toml'));
    git(repo, 'add', '-A');
    put(repo, 'fixtures/app/keys.js', `const k = "${KEY}";\n`);
    const { code, output } = run(repo, STUB_PATH);
    expect(code).toBe(1);
    expect(output).toContain('fixtures/app/keys.js:1');
  });

  const scanners: [string, string][] = [['stand-in scanner', STUB_PATH]];
  if (AIEOS) scanners.push(['AI-EOS scanner', AIEOS]);

  describe.each(scanners)('with the %s', (_name, scanner) => {
    it('passes a clean repository', () => {
      const { code, output } = run(makeRepo(), scanner);
      expect(code, output).toBe(0);
      expect(output).toContain('0 finding(s)');
    });

    it('fails on a planted key in a tracked file and prints rule, file and line, never the value', () => {
      const repo = makeRepo();
      put(repo, 'src/config.ts', `export const config = {\n  key: "${KEY}",\n};\n`);
      git(repo, 'add', 'src/config.ts');
      const { code, output } = run(repo, scanner);
      expect(code).toBe(1);
      expect(output).toContain('anthropic-key src/config.ts:2');
      expect(output).not.toContain(KEY);
      expect(output).not.toContain('Q7wK');
    });

    it('fails on a planted key in a new file git does not ignore', () => {
      const repo = makeRepo();
      put(repo, 'docs/setup.md', `Use ${KEY} to start.\n`);
      const { code, output } = run(repo, scanner);
      expect(code).toBe(1);
      expect(output).toContain('docs/setup.md:1');
      expect(output).not.toContain(KEY);
    });

    it('never reads git-ignored files and leaves out allowlisted paths', () => {
      const repo = makeRepo();
      put(repo, '.env', `ANTHROPIC_API_KEY=${KEY}\n`);
      put(repo, '.env.local', `password = "${PASSWORD}"\n`);
      put(repo, '.claude/settings.local.json', `{"key":"${KEY}"}`);
      put(repo, 'qa-report/report.html', `<p>${KEY}</p>`);
      put(repo, 'fixtures/test-app/keys.js', `const k = "${KEY}";\n`);
      put(repo, 'packages/runner/tests/k.test.ts', `const k = "${KEY}";\n`);
      git(repo, 'add', 'fixtures', 'packages');
      const { code, output } = run(repo, scanner);
      expect(code, output).toBe(0);
      expect(output).toContain('2 left out by the .gitleaks.toml allowlist');
    });

    it('ignores {{...}} placeholders but not a real value for the same rule', () => {
      const repo = makeRepo();
      put(repo, 'templates/plan.yml', 'steps:\n  - password: "{{SIGNIN_PASSWORD}}"\n');
      const clean = run(repo, scanner);
      expect(clean.code, clean.output).toBe(0);
      expect(clean.output).toContain('1 {{...}} placeholder(s) ignored');
      put(repo, 'templates/real.yml', `password: "${PASSWORD}"\n`);
      const dirty = run(repo, scanner);
      expect(dirty.code).toBe(1);
      expect(dirty.output).toContain('generic-secret-assignment templates/real.yml:1');
      expect(dirty.output).not.toContain(PASSWORD);
    });

    it('fails on an env file that would be committed', () => {
      const repo = makeRepo();
      put(repo, 'deploy/.env.production', 'MODE=prod\n');
      git(repo, 'add', '-f', 'deploy/.env.production');
      const { code, output } = run(repo, scanner);
      expect(code).toBe(1);
      expect(output).toContain('committed-env-file deploy/.env.production');
    });
  });
});
