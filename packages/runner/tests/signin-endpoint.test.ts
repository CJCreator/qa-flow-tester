import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { KeyResolver, type SecretStore } from '@qa/core';
import { RunnerServer } from '../src/server.js';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';

class MemoryStore implements SecretStore {
  secrets = new Map<string, string>();
  async get(account: string) {
    return this.secrets.get(account) ?? null;
  }
  async set(account: string, secret: string) {
    this.secrets.set(account, secret);
  }
}

describe('sign-in test endpoint', () => {
  const FIXTURE_PORT = 3613;
  const RUNNER_PORT = 3614;
  const runnerBaseUrl = `http://localhost:${RUNNER_PORT}`;
  const host = `localhost:${FIXTURE_PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-signin-endpoint');
  const store = new MemoryStore();
  let runner: RunnerServer;

  const post = async (body: unknown) => {
    const res = await fetch(`${runnerBaseUrl}/api/sites/${encodeURIComponent(host)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, text: await res.text() };
  };

  beforeAll(async () => {
    await new Promise<void>((resolve) => fixtureServer.listen(FIXTURE_PORT, () => resolve()));
    runner = new RunnerServer({
      port: RUNNER_PORT,
      outputDir,
      dataDir: `${outputDir}-data`,
      keyResolver: new KeyResolver(`${outputDir}-data`, store),
    });
    await runner.start();
  });

  afterAll(async () => {
    await runner.stop();
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(`${outputDir}-data`, { recursive: true, force: true }).catch(() => {});
  });

  it('adding a wrong sign-in answers 422 with reason and saves nothing', async () => {
    const wrongPassword = 'definitely-wrong-pw-1';
    const { status, text } = await post({
      addSignIn: { role: 'member', username: 'manager@example.com', password: wrongPassword, loginPath: '/signin' },
    });
    expect(status).toBe(422);
    const body = JSON.parse(text);
    expect(body.verified).toBe(false);
    expect(body.reason).toBe('wrong-details');
    expect(typeof body.error).toBe('string');
    expect(text).not.toContain(wrongPassword);
    expect(text).not.toContain('manager@example.com');
    // never saves the password when sign-in fails
    expect(store.secrets.size).toBe(0);
    const memoryFiles = await fs.readdir(`${outputDir}-data`).catch(() => [] as string[]);
    for (const file of memoryFiles) {
      const content = await fs.readFile(path.join(`${outputDir}-data`, file), 'utf8').catch(() => '');
      expect(content).not.toContain(wrongPassword);
    }
  }, 60000);

  it('adding a sign-in on a page with no form answers 422 no-form', async () => {
    const { status, text } = await post({
      addSignIn: { role: 'member', username: 'a@example.com', password: 'pw-for-nothing', loginPath: '/login-nothing' },
    });
    expect(status).toBe(422);
    expect(JSON.parse(text).reason).toBe('no-form');
    expect(text).not.toContain('pw-for-nothing');
  }, 60000);

  it('success answers verified:true with no reason, then a saved wrong one tests as verified:false with a reason', async () => {
    const added = await post({
      addSignIn: {
        role: 'manager',
        username: 'manager@example.com',
        password: 'manager-password',
        loginPath: '/signin',
      },
    });
    expect(added.status).toBe(200);
    const ok = JSON.parse(added.text);
    expect(ok.verified).toBe(true);
    expect(ok.reason).toBeUndefined();
    expect(added.text).not.toContain('manager-password');

    // Make the saved password wrong, then test it.
    const account = [...store.secrets.keys()][0];
    expect(account).toBeTruthy();
    store.secrets.set(account!, 'changed-to-wrong');
    const tested = await post({ testSignIn: 'manager' });
    expect(tested.status).toBe(200);
    const body = JSON.parse(tested.text);
    expect(body.verified).toBe(false);
    expect(body.reason).toBe('wrong-details');
    expect(tested.text).not.toContain('changed-to-wrong');
  }, 60000);
});
