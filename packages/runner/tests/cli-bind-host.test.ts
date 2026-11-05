/**
 * The runner refuses to start on an address other computers can reach unless RUNNER_ACCESS_TOKEN is set.
 * A runner bound to an IPv6 address encloses the host in brackets when constructing URLs and parsing requests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { isLoopbackBindHost } from '../src/bind-host.js';
import { bracketHost, RunnerServer } from '../src/server.js';

describe('isLoopbackBindHost', () => {
  it.each(['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]'])('%s is this computer only', (host) => {
    expect(isLoopbackBindHost(host)).toBe(true);
  });

  it.each(['0.0.0.0', '::', '192.168.1.5', 'example.com', ''])('%s is reachable from elsewhere', (host) => {
    expect(isLoopbackBindHost(host)).toBe(false);
  });
});

describe('bracketHost', () => {
  it.each([
    ['::1', '[::1]'],
    ['[::1]', '[::1]'],
    ['::', '[::]'],
    ['[::]', '[::]'],
    ['2001:db8::1', '[2001:db8::1]'],
    ['[2001:db8::1]', '[2001:db8::1]'],
    ['localhost', 'localhost'],
    ['127.0.0.1', '127.0.0.1'],
    ['0.0.0.0', '0.0.0.0'],
  ])('formats host %s as %s for URLs', (input, expected) => {
    expect(bracketHost(input)).toBe(expected);
  });
});

describe('RunnerServer on IPv6 (::1)', () => {
  const scratch = path.join(__dirname, '..', '..', 'tmp', 'cli-bind-host-test-' + Date.now());
  const PORT_RAW = 3921;
  const PORT_BRACKETED = 3922;
  let serverRaw: RunnerServer;
  let serverBracketed: RunnerServer;

  beforeAll(async () => {
    await fs.mkdir(scratch, { recursive: true });
    serverRaw = new RunnerServer({
      host: '::1',
      port: PORT_RAW,
      outputDir: path.join(scratch, 'out-raw'),
      dataDir: path.join(scratch, 'data-raw'),
    });
    serverBracketed = new RunnerServer({
      host: '[::1]',
      port: PORT_BRACKETED,
      outputDir: path.join(scratch, 'out-bracketed'),
      dataDir: path.join(scratch, 'data-bracketed'),
    });
  });

  afterAll(async () => {
    await serverRaw?.stop();
    await serverBracketed?.stop();
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  });

  it('starts on ::1 and produces a bracketed listen URL', async () => {
    const url = await serverRaw.start();
    expect(url).toBe(`http://[::1]:${PORT_RAW}`);
  });

  it('parses requests on ::1 without 500 Invalid URL error', async () => {
    const res = await fetch(`http://[::1]:${PORT_RAW}/healthz`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe('ok');
  });

  it('starts on [::1] and handles requests', async () => {
    const url = await serverBracketed.start();
    expect(url).toBe(`http://[::1]:${PORT_BRACKETED}`);
    const res = await fetch(`http://[::1]:${PORT_BRACKETED}/healthz`);
    expect(res.status).toBe(200);
  });
});

describe('cli start', () => {
  it('exits with a message on 0.0.0.0 without RUNNER_ACCESS_TOKEN', () => {
    const cli = path.join(__dirname, '..', 'src', 'cli.ts');
    const env: NodeJS.ProcessEnv = { ...process.env, RUNNER_HOST: '0.0.0.0', RUNNER_PORT: '0' };
    delete env.RUNNER_ACCESS_TOKEN;
    const run = spawnSync(process.execPath, ['--import', 'tsx', cli], { env, encoding: 'utf8', timeout: 30000 });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('Refusing to start');
    expect(run.stderr).toContain('RUNNER_ACCESS_TOKEN');
  }, 40000);

  it('prints bracketed IPv6 URL when bound to ::1', async () => {
    const cli = path.join(__dirname, '..', 'src', 'cli.ts');
    const port = '3923';
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      RUNNER_HOST: '::1',
      RUNNER_PORT: port,
    };
    const child = spawn(process.execPath, ['--import', 'tsx', cli], { env });

    try {
      const line = await new Promise<string>((resolve, reject) => {
        let text = '';
        const timeout = setTimeout(() => {
          reject(new Error(`Timed out waiting for CLI output. Got: ${text}`));
        }, 20000);

        child.stdout?.on('data', (chunk) => {
          text += chunk.toString();
          if (text.includes('[Release check-up] Open http://[::1]:')) {
            clearTimeout(timeout);
            resolve(text);
          }
        });
        child.stderr?.on('data', (chunk) => {
          text += chunk.toString();
        });
        child.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
        child.on('exit', (code) => {
          clearTimeout(timeout);
          if (!text.includes('Open http://[::1]:')) {
            reject(new Error(`CLI exited with code ${code}. Output: ${text}`));
          }
        });
      });

      expect(line).toContain(`[Release check-up] Open http://[::1]:${port}/ in your browser`);
    } finally {
      child.kill();
    }
  }, 30000);
});
