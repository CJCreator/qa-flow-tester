import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AI_KEY_PATTERNS,
  findKeyPatterns,
  scanDir,
  // @ts-expect-error plain .mjs script without type declarations
} from '../../../scripts/scan-build-secrets.mjs';

const SCRIPT = path.resolve(__dirname, '../../../scripts/scan-build-secrets.mjs');

// Fake keys are put together at run time, so this file (which ships in the runner image) holds no key-shaped text.
const body = (n: number) => 'Q7wK2mZp9R'.repeat(10).slice(0, n);
const FAKE = {
  'anthropic-api-key': ['sk', 'ant', 'api03', body(60)].join('-'),
  'openrouter-api-key': ['sk', 'or', 'v1', body(64)].join('-'),
  'openai-api-key': ['sk', 'proj', `${body(30)}${'T3Blbk'}FJ${body(30)}`].join('-'),
  'google-ai-api-key': `${'AI'}za${body(35)}`,
} as const;

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'qa-build-scan-test-'));
  dirs.push(d);
  return d;
};
const put = (root: string, rel: string, content: string | Buffer) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
};
const cli = (...args: string[]) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: r.status, output: `${r.stdout}${r.stderr}` };
};

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('build secret scan: patterns', () => {
  it('covers Anthropic, OpenAI, Google AI and OpenRouter keys', () => {
    expect(AI_KEY_PATTERNS.map((p: { name: string }) => p.name).sort()).toEqual(Object.keys(FAKE).sort());
    for (const [name, key] of Object.entries(FAKE)) {
      expect(findKeyPatterns(`const k="${key}";`), name).toEqual([name]);
    }
  });

  it('finds a key in minified code, a query string and a JSON value', () => {
    expect(findKeyPatterns(`fetch("/v1?key=${FAKE['google-ai-api-key']}")`)).toEqual(['google-ai-api-key']);
    expect(findKeyPatterns(`{"apiKey":"${FAKE['openrouter-api-key']}"}`)).toEqual(['openrouter-api-key']);
    expect(findKeyPatterns(`a=1;b=\`Bearer ${FAKE['anthropic-api-key']}\``)).toEqual(['anthropic-api-key']);
  });

  it('ignores key prefixes without a key: placeholders, short test values, longer tokens', () => {
    for (const text of [
      'placeholder="sk-or-…"',
      "const GOOD_KEY = 'sk-or-v1-good-key-123'",
      "'sk-ant-test-1234'",
      `task-ant-${body(40)}`,
      `x${FAKE['google-ai-api-key']}`,
    ]) {
      expect(findKeyPatterns(text), text).toEqual([]);
    }
  });
});

describe('build secret scan: folders', () => {
  it('reports the file and the pattern of a key in a nested and in a binary file', () => {
    const dir = tempDir();
    put(dir, 'index.html', '<script src="/assets/app.js"></script>');
    put(dir, 'assets/app-1a2b.js', `var c={k:"${FAKE['anthropic-api-key']}"};`);
    put(
      dir,
      'assets/logo.png',
      Buffer.concat([Buffer.from([0x89, 0x50, 0, 0, 0xff]), Buffer.from(FAKE['google-ai-api-key'])])
    );
    const r = scanDir(dir);
    expect(r.scanned).toBe(3);
    expect(r.unreadable).toEqual([]);
    expect(r.findings).toEqual(
      expect.arrayContaining([
        { file: 'assets/app-1a2b.js', pattern: 'anthropic-api-key' },
        { file: 'assets/logo.png', pattern: 'google-ai-api-key' },
      ])
    );
    expect(r.findings).toHaveLength(2);
  });

  it('does not follow a link out of the folder', () => {
    const outside = tempDir();
    put(outside, 'secret.txt', FAKE['openrouter-api-key']);
    const dir = tempDir();
    put(dir, 'app.js', 'console.log(1)');
    symlinkSync(outside, path.join(dir, 'linked'), 'junction');
    expect(scanDir(dir)).toEqual({ scanned: 1, findings: [], unreadable: [] });
  });
});

describe('build secret scan: command line', () => {
  it('exits 1 on a planted key and prints the file and pattern name, never the value', () => {
    const dir = tempDir();
    put(dir, 'assets/index.js', `const keys=["${FAKE['openai-api-key']}","${FAKE['openrouter-api-key']}"];`);
    const { code, output } = cli(dir);
    expect(code).toBe(1);
    expect(output).toContain('assets/index.js: openai-api-key');
    expect(output).toContain('assets/index.js: openrouter-api-key');
    for (const key of Object.values(FAKE)) {
      expect(output).not.toContain(key);
      expect(output).not.toContain(key.slice(-20));
    }
    expect(output).not.toContain(body(10));
  });

  it('exits 0 on a folder without a key', () => {
    const dir = tempDir();
    put(dir, 'index.html', '<input placeholder="sk-or-…">');
    const { code, output } = cli(dir);
    expect(code).toBe(0);
    expect(output).toContain('no AI provider key in 1 file(s)');
  });

  it('scans every folder given and fails when any has a key', () => {
    const clean = tempDir();
    put(clean, 'a.js', '1');
    const dirty = tempDir();
    put(dirty, 'b.js', FAKE['google-ai-api-key']);
    expect(cli(clean, dirty).code).toBe(1);
    expect(cli(clean, clean).code).toBe(0);
  });

  it('exits 2 without a folder, on a missing folder and on an empty one, so a wrong path never passes', () => {
    expect(cli().code).toBe(2);
    expect(cli('--json').code).toBe(2);
    expect(cli(path.join(tempDir(), 'missing')).code).toBe(2);
    const { code, output } = cli(tempDir());
    expect(code).toBe(2);
    expect(output).toContain('no file to scan');
  });
});
