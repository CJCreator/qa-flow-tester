/**
 * T-438 (ADR 0050): a public site without Verified Domain proof is checked in safe mode: read-only, no forms,
 * no Sensitive Actions, no Security Probes, and the plan says so and how to unlock them.
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import type { NetDeps, RawResponse } from '@qa/core';
import { SAFE_MODE_REASON, readOnlyReason, resolveAuthorization } from '../src/session/checkup-run.js';

const PROOF = 'https://shop.example.com/.well-known/qa-verify.txt';
const net = (files: Record<string, RawResponse> = {}, address = '93.184.216.34'): NetDeps => ({
  lookup: async () => [address],
  connect: async (req) => {
    const r = files[req.url.toString()];
    if (!r) throw new Error('refused');
    return r;
  },
});

const base = { targetUrl: 'https://shop.example.com/', owner: true, ownerExplicit: true, beta: true };

describe('safe mode on the shared copy', () => {
  it('a public site nobody proved is read-only and the reason names what is skipped and the way out', async () => {
    const auth = await resolveAuthorization({ ...base, hostChecks: net() });
    expect(auth.readOnly).toBe(true);
    expect(auth.testCopy).toBe(false);
    expect(auth.signInConsent).toBe(false);
    expect(auth.readOnlyReason).toBe(SAFE_MODE_REASON);
    expect(SAFE_MODE_REASON).toMatch(/Forms are not filled in or sent/);
    expect(SAFE_MODE_REASON).toMatch(/Sensitive Actions/);
    expect(SAFE_MODE_REASON).toMatch(/Security Probes/);
    expect(SAFE_MODE_REASON).toMatch(/Verified Domain/);
  });

  it('is the same without the owner box ticked', async () => {
    const auth = await resolveAuthorization({ ...base, owner: false, ownerExplicit: false, hostChecks: net() });
    expect(auth.readOnly).toBe(true);
    expect(auth.readOnlyReason).toBe(SAFE_MODE_REASON);
  });

  it('test sign-in details never unlock it here', async () => {
    const auth = await resolveAuthorization({
      ...base,
      signInConsent: true,
      roles: [{ role: 'admin', username: 'u', password: 'p' }] as never,
      hostChecks: net(),
    });
    expect(auth.readOnly).toBe(true);
    expect(auth.signInConsent).toBe(false);
  });

  it('marked as a test copy without the proof stays read-only and keeps the proof wording', async () => {
    const auth = await resolveAuthorization({ ...base, testCopyMarked: true, hostChecks: net() });
    expect(auth.readOnly).toBe(true);
    expect(auth.readOnlyReason).toMatch(/Verified Domain line/);
  });

  it('a private address is never a test copy on the shared copy', async () => {
    const auth = await resolveAuthorization({
      ...base,
      testCopyMarked: true,
      hostChecks: net({ [PROOF]: { status: 200, headers: {}, body: 'qa-verify=tok' } }, '10.0.0.5'),
      token: () => 'tok',
    });
    expect(auth.readOnly).toBe(true);
  });

  it('proof unlocks full testing: live proof, or the account’s saved proof', async () => {
    const live = await resolveAuthorization({
      ...base,
      testCopyMarked: true,
      hostChecks: net({ [PROOF]: { status: 200, headers: {}, body: 'qa-verify=tok' } }),
      token: () => 'tok',
    });
    expect(live.readOnly).toBe(false);
    expect(live.readOnlyReason).toBe('');
    const saved = await resolveAuthorization({
      ...base,
      testCopyMarked: true,
      hostChecks: net(),
      saved: { valid: async () => true, save: async () => {} },
    });
    expect(saved.readOnly).toBe(false);
  });

  it('keeps the local wording off the shared copy and the shared wording off local runs', () => {
    expect(readOnlyReason(true, false, false, true)).toBe(SAFE_MODE_REASON);
    expect(readOnlyReason(true, false, false, false)).toMatch(/looks like a live site/);
    expect(readOnlyReason(true, true, false, true)).toBe('');
  });
});

describe('the checkers only read (T-438 audit)', () => {
  async function sources(dir: string): Promise<Array<{ file: string; text: string }>> {
    const out: Array<{ file: string; text: string }> = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...(await sources(full)));
      else if (e.name.endsWith('.ts')) out.push({ file: full, text: await fs.readFile(full, 'utf8') });
    }
    return out;
  }

  it('no checker sends a write method', async () => {
    const dir = path.join(process.cwd(), 'packages', 'checkers', 'src');
    for (const { file, text } of await sources(dir)) {
      expect(text, file).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/);
    }
  });

  it('the API spec checks send writes only when allowed, and the runner never allows them', async () => {
    const spec = await fs.readFile(path.join(process.cwd(), 'packages', 'core', 'src', 'api-spec-checks.ts'), 'utf8');
    expect(spec).toMatch(/c\.sends && !options\.allowWrites/);
    const server = await fs.readFile(path.join(process.cwd(), 'packages', 'runner', 'src', 'server.ts'), 'utf8');
    expect(server).not.toMatch(/allowWrites/);
  });
});
