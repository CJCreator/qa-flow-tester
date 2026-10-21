import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createCheckupSession, type CheckupSession } from '../src/session/checkup-session.js';
import type { StoredPlanRecord } from '../src/session/plan-store.js';

const COOKIE_VALUE = 'cookie-secret-value-123456';

/** Every file under a folder, as text. Missing folder gives an empty list. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(full)));
    else out.push(full);
  }
  return out;
}

async function containsCookie(dir: string): Promise<boolean> {
  for (const file of await filesUnder(dir)) {
    const text = await fs.readFile(file, 'utf8').catch(() => '');
    if (text.includes(COOKIE_VALUE)) return true;
  }
  return false;
}

/** Writes a storage state with a cookie value, the way a signed-in run leaves it on disk. */
async function writeSignIn(authDir: string, runId: string): Promise<void> {
  const dir = path.join(authDir, runId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'member.json'),
    JSON.stringify({ cookies: [{ name: 'session', value: COOKIE_VALUE }], origins: [] }),
    'utf8'
  );
}

function recordFor(runId: string, status: StoredPlanRecord['status']): StoredPlanRecord {
  return {
    status,
    plan: { runId, targetUrl: 'http://127.0.0.1:9/' } as unknown as StoredPlanRecord['plan'],
    context: {
      targetUrl: 'http://127.0.0.1:9/',
      productId: 'p',
      runId,
      draft: undefined as unknown as StoredPlanRecord['context']['draft'],
    },
  };
}

describe('T-46 sign-in sessions off disk', () => {
  let root: string;
  let outputDir: string;
  let dataDir: string;
  let authDir: string;
  let session: CheckupSession;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 't46-'));
    outputDir = path.join(root, 'out');
    dataDir = path.join(root, 'data');
    authDir = path.join(outputDir, 'auth');
    await fs.mkdir(dataDir, { recursive: true });
    session = createCheckupSession({ outputDir, dataDir, authDir });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  });

  describe('plan store', () => {
    it('removes the sign-in folder and the in-memory session when a plan is saved as done', async () => {
      await writeSignIn(authDir, 'run-done');
      session.secrets.savedSessions.set('run-done', { member: { cookies: [], origins: [] } } as never);

      await session.plan.save(recordFor('run-done', 'done'));

      expect(await fs.stat(path.join(authDir, 'run-done')).catch(() => null)).toBeNull();
      expect(session.secrets.savedSessions.get('run-done')).toBeUndefined();
      expect(await containsCookie(outputDir)).toBe(false);
    });

    it('keeps the sign-in folder while the plan is awaiting review', async () => {
      await writeSignIn(authDir, 'run-wait');

      await session.plan.save(recordFor('run-wait', 'awaiting-review'));

      expect(await fs.stat(path.join(authDir, 'run-wait')).then(() => true, () => false)).toBe(true);
    });

    it('keeps the sign-in folder while an approved plan is being tested', async () => {
      await writeSignIn(authDir, 'run-approved');

      await session.plan.save(recordFor('run-approved', 'approved'));

      expect(await fs.stat(path.join(authDir, 'run-approved')).then(() => true, () => false)).toBe(true);
    });
  });

  describe('run secrets', () => {
    it('clean(runId) removes that run folder and no cookie value stays under the output folder', async () => {
      await writeSignIn(authDir, 'run-x');

      await session.secrets.clean('run-x');

      expect(await containsCookie(outputDir)).toBe(false);
    });

    it('sweepLeftovers removes every leftover auth folder', async () => {
      await writeSignIn(authDir, 'run-old-1');
      await writeSignIn(authDir, 'run-old-2');

      await session.secrets.sweepLeftovers();

      expect(await filesUnder(authDir)).toEqual([]);
    });

    it('sweepLeftovers is a no-op when the auth folder does not exist', async () => {
      await expect(session.secrets.sweepLeftovers()).resolves.toBeUndefined();
    });
  });

  describe('startup sweep', () => {
    it('createCheckupSession removes leftovers from an earlier process without a call from the caller', async () => {
      await writeSignIn(authDir, 'run-left-behind');

      createCheckupSession({ outputDir, dataDir, authDir });

      // The sweep runs in the background; poll briefly for it to finish.
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && (await containsCookie(outputDir))) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(await containsCookie(outputDir)).toBe(false);
    });
  });
});
