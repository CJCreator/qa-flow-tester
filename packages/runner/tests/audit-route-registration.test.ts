import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIT_API, AUDIT_AI_API, matchAuditPath } from '@qa/types';
import { allRoutes, buildAuditRoutes } from '../src/routes/index.js';
import { createAuditStore, selectAuditStoreBackend } from '@qa/core';
import { createHelperAccess } from '../src/helpers/helper-access.js';
import type { RunnerServer } from '../src/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = Object.entries({ ...AUDIT_API, ...AUDIT_AI_API });

function pathsOf(route: { path: string | string[] }): string[] {
  return Array.isArray(route.path) ? route.path : [route.path];
}

describe('audit route registration (REQ-048)', () => {
  it('AC-2: every contract entry has exactly one registered route with its method, path and access', () => {
    for (const [name, entry] of contract) {
      const rows = allRoutes.filter((r) => r.method === entry.method && !r.prefix && pathsOf(r).includes(entry.path));
      expect(rows, `${name}: ${entry.method} ${entry.path}`).toHaveLength(1);
      expect(rows[0].access, name).toBe(entry.access);
    }
  });

  it('registers no audit row the contract does not declare', () => {
    const declared = new Set(contract.map(([, e]) => `${e.method} ${e.path}`));
    for (const route of allRoutes) {
      for (const p of pathsOf(route)) {
        if (/^\/(api\/audit|api\/shortlist|api\/helper|s\/)/.test(p)) {
          expect(declared.has(`${route.method} ${p}`), `${route.method} ${p}`).toBe(true);
        }
      }
    }
  });

  it('every audit row declares a beta policy; only public rows are allowed on a beta copy (D-004)', () => {
    for (const [name, entry] of contract) {
      const row = allRoutes.find((r) => r.method === entry.method && pathsOf(r).includes(entry.path));
      expect(row?.beta, name).toBeDefined();
      expect(row?.beta, name).toBe(entry.access === 'public' ? 'allow' : 'closed');
    }
  });

  it('parameter rows resolve their path parameters', () => {
    expect(matchAuditPath(AUDIT_API.get.path, '/api/audits/abc')).toBeDefined();
  });

  it('AC-6: server.ts handles no Website Audit path inline', () => {
    const source = fs.readFileSync(path.join(here, '../src/server.ts'), 'utf8');
    for (const fragment of ['/api/audits', '/api/audit-settings', '/api/shortlist', '/api/helper', '/s/']) {
      expect(source.includes(fragment), fragment).toBe(false);
    }
  });

  it('builds a real handler for every registered row from the runner internals', () => {
    const dataDir = fs.mkdtempSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp-audit-reg-'));
    try {
      const store = createAuditStore(selectAuditStoreBackend({ dataDir, env: {} }));
      const server = {
        auditWiring: {
          dataDir,
          store,
          keys: {},
          helperAccess: createHelperAccess({ store }),
          readAiModels: async () => ({}),
          isOwnerRequest: () => false,
        },
      } as unknown as RunnerServer;
      const built = buildAuditRoutes(server);
      const builtKeys = new Set(built.flatMap((r) => pathsOf(r).map((p) => `${r.method} ${p}`)));
      for (const [name, entry] of contract) {
        const registered = allRoutes.some((r) => r.method === entry.method && pathsOf(r).includes(entry.path));
        if (registered) expect(builtKeys.has(`${entry.method} ${entry.path}`), name).toBe(true);
      }
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
