/**
 * M3 (ADR 0039): the cleanup's two parts. Folders under dataDir/sessions idle for 24 hours are deleted (not the
 * ones in memory, not the fresh ones); visitor sessions in memory idle for 24 hours are forgotten.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { purgeVisitorFolders, VISITOR_FOLDER_IDLE_MS } from '../src/session/visitor-cleanup.js';
import { purgeStaleSessions, sessionFor, liveVisitorFolders } from '../src/beta.js';

const scratch = path.join(process.cwd(), '.tmp-visitor-cleanup');
const HOUR = 3_600_000;

async function folderAged(root: string, name: string, ageMs: number): Promise<string> {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'state.json');
  await fs.writeFile(file, '{}', 'utf8');
  const when = new Date(Date.now() - ageMs);
  await fs.utimes(file, when, when);
  await fs.utimes(dir, when, when);
  return dir;
}

describe('purgeVisitorFolders (M3)', () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(scratch, 'sessions');
    await fs.mkdir(root, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it('deletes only folders idle for over 24 hours', async () => {
    const old = await folderAged(root, 'old', VISITOR_FOLDER_IDLE_MS + HOUR);
    const young = await folderAged(root, 'young', HOUR);
    const purged = await purgeVisitorFolders(root, Date.now(), new Set());
    expect(purged).toBe(1);
    await expect(fs.stat(old)).rejects.toThrow();
    await expect(fs.stat(young)).resolves.toBeTruthy();
  });

  it('a folder with a recent file inside is kept even when its own time is old', async () => {
    const dir = await folderAged(root, 'mixed', VISITOR_FOLDER_IDLE_MS + HOUR);
    const recent = path.join(dir, 'recent.json');
    await fs.writeFile(recent, '{}', 'utf8');
    expect(await purgeVisitorFolders(root, Date.now(), new Set())).toBe(0);
    await expect(fs.stat(dir)).resolves.toBeTruthy();
  });

  it('keeps the folders named in keep (sessions still in memory)', async () => {
    const kept = await folderAged(root, 'in-memory', VISITOR_FOLDER_IDLE_MS + HOUR);
    expect(await purgeVisitorFolders(root, Date.now(), new Set(['in-memory']))).toBe(0);
    await expect(fs.stat(kept)).resolves.toBeTruthy();
  });

  it('leaves plain files in the sessions folder alone, and a missing folder is zero', async () => {
    await fs.writeFile(path.join(root, 'loose.json'), '{}', 'utf8');
    expect(await purgeVisitorFolders(root, Date.now() + 2 * VISITOR_FOLDER_IDLE_MS, new Set())).toBe(0);
    await expect(fs.stat(path.join(root, 'loose.json'))).resolves.toBeTruthy();
    expect(await purgeVisitorFolders(path.join(scratch, 'none'), Date.now(), new Set())).toBe(0);
  });
});

/** Minimal request and response for sessionFor: one fresh visitor, no cookie. */
function visitor(): { req: http.IncomingMessage; res: http.ServerResponse } {
  const headers: Record<string, string> = {};
  const req = { headers, socket: { remoteAddress: '203.0.113.9' } } as unknown as http.IncomingMessage;
  const cookies: string[] = [];
  const res = {
    getHeader: () => (cookies.length ? cookies : undefined),
    setHeader: (_name: string, value: string | string[]) => {
      cookies.splice(0, cookies.length, ...(Array.isArray(value) ? value : [value]));
    },
  } as unknown as http.ServerResponse;
  return { req, res };
}

describe('purgeStaleSessions (M3, in-memory visitor sessions)', () => {
  it('forgets visitors idle for over 24 hours, and keeps a visitor seen just now', () => {
    const first = visitor();
    const firstId = sessionFor(first.req, first.res, false);
    const second = visitor();
    const secondId = sessionFor(second.req, second.res, false);
    expect(liveVisitorFolders().has(firstId)).toBe(true);
    expect(liveVisitorFolders().has(secondId)).toBe(true);

    // Checked 25 hours on, both are idle past the cutoff: both go, and their folder names go with them.
    expect(purgeStaleSessions(Date.now() + 25 * HOUR)).toBeGreaterThanOrEqual(2);
    expect(liveVisitorFolders().has(firstId)).toBe(false);
    expect(liveVisitorFolders().has(secondId)).toBe(false);

    // A visitor seen now is kept by a check at the present time.
    const third = visitor();
    const thirdId = sessionFor(third.req, third.res, false);
    expect(purgeStaleSessions(Date.now())).toBe(0);
    expect(liveVisitorFolders().has(thirdId)).toBe(true);
  });
});
