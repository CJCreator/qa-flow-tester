/**
 * T-431: the 1440 px screenshot of a Sample Page is taken on the page that is already open. A fake page records
 * what is asked of it, so no browser starts: the viewport is resized and put back, and the page is never
 * loaded again.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Page } from 'playwright';
import { desktopScreenshotFile, recordDesktopShot } from '../src/audit/pipeline/desktop-shot.js';

function fakePage(opts: { fail?: boolean } = {}) {
  const calls: string[] = [];
  let viewport = { width: 1280, height: 720 };
  const page = {
    viewportSize: () => viewport,
    setViewportSize: async (v: { width: number; height: number }) => {
      calls.push(`viewport ${v.width}x${v.height}`);
      viewport = v;
    },
    evaluate: async () => undefined,
    goto: async () => {
      calls.push('goto');
    },
    reload: async () => {
      calls.push('reload');
    },
    screenshot: async (o: { path: string; clip: { width: number } }) => {
      if (opts.fail) throw new Error('no screenshot');
      calls.push(`screenshot ${o.clip.width}`);
      await fs.writeFile(o.path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    },
  };
  return { page: page as unknown as Page, calls, viewport: () => viewport };
}

describe('recordDesktopShot (T-431)', () => {
  it('saves a 1440 px screenshot under desktop/, restores the viewport and loads nothing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-shot-'));
    try {
      const fake = fakePage();
      const rel = await recordDesktopShot(fake.page, dir, '/services');
      expect(rel).toBe(desktopScreenshotFile('/services'));
      expect(rel).toMatch(/^desktop\/.+\.png$/);
      expect((await fs.readFile(path.join(dir, ...rel!.split('/')))).byteLength).toBeGreaterThan(0);
      expect(fake.calls).toEqual(['viewport 1440x900', 'screenshot 1440', 'viewport 1280x720']);
      expect(fake.calls).not.toContain('goto');
      expect(fake.calls).not.toContain('reload');
      expect(fake.viewport()).toEqual({ width: 1280, height: 720 });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('gives null, never throws, and still restores the viewport when the screenshot fails', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-shot-'));
    try {
      const fake = fakePage({ fail: true });
      expect(await recordDesktopShot(fake.page, dir, '/')).toBeNull();
      expect(fake.viewport()).toEqual({ width: 1280, height: 720 });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
