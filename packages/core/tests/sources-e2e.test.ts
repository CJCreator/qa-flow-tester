// End to end on the built-in fixture app (Chromium): an admin-only page checked as Admin and Viewer, a role that
// cannot sign in, a saved session, a documented item the app does not have, and the issues document files.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import type { TestCase, StorageStateData } from '@qa/types';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import { server } from '../../../fixtures/test-app/server.js';

const PORT = 3586;
const baseUrl = `http://localhost:${PORT}`;
const outputDir = path.join(process.cwd(), '.tmp-sources-e2e');

const pageTest = (id: string, role: string, name: string, contains: string): TestCase => ({
  id,
  requirementId: `REQ-${id}`,
  flowId: `flow-${id}`,
  name,
  role,
  startPage: '/account/users/new',
  steps: [{ action: 'wait', name: 'Look at the page' }],
  expectations: { text: { contains } },
  docSource: { document: 'admin-guide.md', section: '1 Users > 1.1 Create user' },
});

describe('Sources end to end on the fixture app', () => {
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(PORT, () => resolve()));
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it('Admin sees Create user, Viewer (saved session) is denied, a role that cannot sign in is not tested, Not found is reported', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const viewerState = (await (await fetch(`${baseUrl}/saved-session/mint?role=viewer`)).json()) as StorageStateData;
      const report = await new FlowTestOrchestrator().run({
        targetUrl: baseUrl,
        productId: 'fixture-sources',
        specTestCases: [
          pageTest('TC-ADMIN', 'admin', 'Admin opens Create user', 'Create user'),
          { ...pageTest('TC-VIEWER', 'viewer', 'Viewer is denied Create user', 'don’t have access') },
          pageTest('TC-MANAGER', 'manager', 'Manager is denied Create user', 'don’t have access'),
        ],
        profile: {
          name: 'Fixture',
          productId: 'fixture-sources',
          roles: [
            { role: 'admin', username: 'admin@example.com', password: 'admin-password', loginPath: '/signin' },
            { role: 'viewer', username: 'viewer@example.com', password: 'not-used', loginPath: '/signin' },
            { role: 'manager', username: 'manager@example.com', password: 'wrong-password', loginPath: '/signin' },
          ],
        },
        suppliedSessions: { viewer: viewerState },
        documentedNotFound: [
          {
            docSource: { document: 'admin-guide.md', section: '2 Billing > 2.1 Export invoices to PDF' },
            reason: 'No Export all to PDF button was found on any page that was scanned.',
          },
        ],
        headless: true,
        outputDir,
        breakpoints: ['1440px'],
        repoRoot: process.cwd(),
        enableA11y: false,
        recordVideo: false,
      });

      // AC2: Admin reaches the page; Viewer is denied and that is the expected result.
      const admin = report.results.find((r) => r.testCaseId === 'TC-ADMIN')!;
      expect(admin.status).not.toBe('Skipped');
      expect(admin.stepEvidence.length).toBeGreaterThan(0);
      const viewer = report.results.find((r) => r.testCaseId === 'TC-VIEWER')!;
      expect(viewer.status).not.toBe('Skipped');
      expect(viewer.stepEvidence.length).toBeGreaterThan(0);

      // AC8: the role that cannot sign in is skipped with a plain reason; the others ran.
      const manager = report.results.find((r) => r.testCaseId === 'TC-MANAGER')!;
      expect(manager.status).toBe('Skipped');
      expect(manager.skipReason).toMatch(/^Not tested: /);
      expect(report.rolesNotTested?.map((r) => r.role)).toEqual(['manager']);

      // AC3: documented item with no feature is "Not found in app", not a failure.
      expect(report.documentedItems?.notFound).toHaveLength(1);
      expect(report.documentedItems?.notFound[0].docSource.section).toContain('2.1');
      expect(report.findings.some((f) => /Export all to PDF/.test(f.title) && f.severity === 'Blocker')).toBe(false);

      // AC7: both issues files are written; the HTML loads nothing from outside; Roles not tested comes first.
      const md = await fs.readFile(path.join(outputDir, 'issues.md'), 'utf8');
      const html = await fs.readFile(path.join(outputDir, 'issues.html'), 'utf8');
      expect(md).toMatch(/Roles not tested/i);
      expect(md).toMatch(/manager/i);
      expect(html).not.toMatch(/(?:src|href)=["']https?:\/\//i);
      expect(html).not.toMatch(/<script[^>]+src=/i);

      // AC9: the saved session value never lands in the report or the files written for it.
      const sentinel = JSON.stringify(viewerState.cookies);
      for (const text of [JSON.stringify(report), md, html]) expect(text).not.toContain(sentinel);
      expect(await fs.readFile(path.join(outputDir, 'findings.json'), 'utf8')).not.toContain(sentinel);
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  }, 240000);
});
