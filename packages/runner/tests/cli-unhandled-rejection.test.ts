/**
 * One unhandled rejection is logged and the runner keeps answering; five within a minute stop it cleanly.
 * The CLI runs as a child process. A preload module rejects a promise each time a trigger file appears.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';
import fs from 'fs';

const cli = path.join(__dirname, '..', 'src', 'cli.ts');
let dir: string;
let preload: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-rejection-'));
  preload = path.join(dir, 'preload.mjs');
  fs.writeFileSync(
    preload,
    `import fs from 'fs';
const trigger = ${JSON.stringify(path.join(dir, 'reject'))};
setInterval(() => {
  if (!fs.existsSync(trigger)) return;
  const n = Number(fs.readFileSync(trigger, 'utf8')) || 1;
  fs.unlinkSync(trigger);
  for (let i = 0; i < n; i++) Promise.reject(new Error('test rejection ' + i));
}, 50);
`
  );
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function start(port: number) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    RUNNER_HOST: 'localhost',
    RUNNER_PORT: String(port),
    RUNNER_OUTPUT_DIR: path.join(dir, 'out'),
    RUNNER_DATA_DIR: path.join(dir, 'data'),
  };
  delete env.RUNNER_ACCESS_TOKEN;
  const child = spawn(process.execPath, ['--import', 'tsx', '--import', pathToFileURL(preload).href, cli], { env });
  let text = '';
  child.stdout?.on('data', (c) => (text += c));
  child.stderr?.on('data', (c) => (text += c));
  const output = () => text;
  const waitFor = async (needle: string, ms = 25000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (text.includes(needle)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timed out waiting for "${needle}". Got: ${text}`);
  };
  return { child, output, waitFor };
}

function exited(child: ChildProcess, ms: number): Promise<number | null | 'running'> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    const t = setTimeout(() => resolve('running'), ms);
    child.once('exit', (code) => {
      clearTimeout(t);
      resolve(code);
    });
  });
}

describe('runner and unhandled rejections', () => {
  it('keeps answering /api/runner/status after one rejected promise', async () => {
    const { child, waitFor } = start(3931);
    try {
      await waitFor('Open http://');
      fs.writeFileSync(path.join(dir, 'reject'), '1');
      await waitFor('Unhandled promise rejection (1 in the last minute)');
      expect(await exited(child, 1000)).toBe('running');
      const res = await fetch('http://localhost:3931/api/runner/status');
      expect(res.status).toBe(200);
    } finally {
      child.kill();
    }
  }, 40000);

  it('shuts down after five quick rejections', async () => {
    const { child, waitFor, output } = start(3932);
    try {
      await waitFor('Open http://');
      fs.writeFileSync(path.join(dir, 'reject'), '5');
      expect(await exited(child, 15000)).toBe(1);
      expect(output()).toContain('Too many unhandled promise rejections');
    } finally {
      child.kill();
    }
  }, 40000);
});
