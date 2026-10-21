import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type http from 'http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { keepSessionFoldersIn, sessionFor, sessionFolderName, sweepSessionFolders } from '../src/beta.js';

const HOUR = 3_600_000;

function fakeRequest(address: string): http.IncomingMessage {
  return { headers: {}, socket: { remoteAddress: address } } as unknown as http.IncomingMessage;
}

function fakeResponse(): http.ServerResponse {
  return { getHeader: () => undefined, setHeader: () => undefined } as unknown as http.ServerResponse;
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(
    () => true,
    () => false
  );
}

describe('T-50 beta visitor folders are removed when their session expires', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-beta-'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('the folder name is the session id with anything outside word characters and dashes replaced', () => {
    expect(sessionFolderName('abc_DEF-123')).toBe('abc_DEF-123');
    expect(sessionFolderName('a/b.c')).toBe('a_b_c');
  });

  it('a visitor folder is removed once its session has been idle for 24 hours', async () => {
    keepSessionFoldersIn(dataDir);
    vi.useFakeTimers({ toFake: ['Date'] });
    const id = sessionFor(fakeRequest('10.0.0.1'), fakeResponse(), false);
    const folder = path.join(dataDir, 'sessions', sessionFolderName(id));
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, 'sites.json'), '{}');

    vi.setSystemTime(Date.now() + 25 * HOUR);
    sessionFor(fakeRequest('10.0.0.2'), fakeResponse(), false);

    for (let i = 0; i < 50 && (await exists(folder)); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(await exists(folder)).toBe(false);
  });

  it('a folder whose session is still in memory is kept by the start-up sweep', async () => {
    keepSessionFoldersIn(dataDir);
    const id = sessionFor(fakeRequest('10.0.1.1'), fakeResponse(), false);
    const folder = path.join(dataDir, 'sessions', sessionFolderName(id));
    await fs.mkdir(folder, { recursive: true });
    const old = new Date(Date.now() - 25 * HOUR);
    await fs.utimes(folder, old, old);

    await sweepSessionFolders();

    expect(await exists(folder)).toBe(true);
  });

  it('the start-up sweep removes folders untouched for 24 hours with no session in memory, and keeps recent ones', async () => {
    keepSessionFoldersIn(dataDir);
    const oldFolder = path.join(dataDir, 'sessions', 'orphan-old');
    const newFolder = path.join(dataDir, 'sessions', 'orphan-new');
    await fs.mkdir(oldFolder, { recursive: true });
    await fs.mkdir(newFolder, { recursive: true });
    const old = new Date(Date.now() - 25 * HOUR);
    await fs.utimes(oldFolder, old, old);

    await sweepSessionFolders();

    expect(await exists(oldFolder)).toBe(false);
    expect(await exists(newFolder)).toBe(true);
  });
});
