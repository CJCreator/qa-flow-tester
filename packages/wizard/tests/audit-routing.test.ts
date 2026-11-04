import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCheckRoute, matchRoute, PATHS, readsAddressParam } from '../src/lib/router';
import { AUDIT_PATHS } from '../src/screens/audit/saved/saved-api';

const SRC = join(__dirname, '..', 'src');
const AUDIT_DIR = join(SRC, 'screens', 'audit');

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]
  );
}

describe('Website Audit addresses', () => {
  it('match AUDIT_PATHS, which the screens link to', () => {
    expect(PATHS.auditNew).toBe(AUDIT_PATHS.start);
    expect(PATHS.audits).toBe(AUDIT_PATHS.list);
    expect(PATHS.auditShortlist).toBe(AUDIT_PATHS.shortlist);
    expect(PATHS.audit('a b/1')).toBe(AUDIT_PATHS.history('a b/1'));
    expect(PATHS.auditVersion('a-1', 3)).toBe(AUDIT_PATHS.version('a-1', 3));
    expect(PATHS.auditReview('a-1', 3)).toBe(AUDIT_PATHS.review('a-1', 3));
    expect(PATHS.auditExport('a-1', 3)).toBe(AUDIT_PATHS.export('a-1', 3));
    expect(PATHS.auditShare('a-1')).toBe(AUDIT_PATHS.previewShare('a-1'));
    expect(PATHS.auditHelpers('a-1')).toBe(AUDIT_PATHS.helpers('a-1'));
  });

  it('read back as the same route', () => {
    expect(matchRoute(PATHS.auditNew)).toEqual({ name: 'audit-new' });
    expect(matchRoute(PATHS.audits)).toEqual({ name: 'audits' });
    expect(matchRoute(PATHS.auditSettings)).toEqual({ name: 'audit-settings' });
    expect(matchRoute(PATHS.auditShortlist)).toEqual({ name: 'audit-shortlist' });
    expect(matchRoute(PATHS.helperSignIn)).toEqual({ name: 'helper-sign-in' });
    expect(matchRoute(PATHS.audit('a b/1'))).toEqual({ name: 'audit', auditId: 'a b/1' });
    expect(matchRoute(PATHS.auditVersion('a b/1', 2))).toEqual({ name: 'audit-version', auditId: 'a b/1', version: 2 });
    expect(matchRoute(PATHS.auditReview('a-1', 12))).toEqual({ name: 'audit-review', auditId: 'a-1', version: 12 });
    expect(matchRoute(PATHS.auditExport('a-1', 1))).toEqual({ name: 'audit-export', auditId: 'a-1', version: 1 });
    expect(matchRoute(PATHS.auditShare('a-1'))).toEqual({ name: 'audit-share', auditId: 'a-1' });
    expect(matchRoute(PATHS.auditHelpers('a-1'))).toEqual({ name: 'audit-helpers', auditId: 'a-1' });
    expect(matchRoute('/audits/a-1/')).toEqual({ name: 'audit', auditId: 'a-1' });
  });

  it.each([
    '/audits/%E0%A4%A',
    '/audits/%E0%A4%A/share',
    '/audits/%E0%A4%A/helpers',
    '/audits/%E0%A4%A/versions/1',
    '/audits/a-1/versions/0',
    '/audits/a-1/versions/-1',
    '/audits/a-1/versions/1.5',
    '/audits/a-1/versions/x',
    '/audits/a-1/versions/01',
    '/audits/a-1/versions/1/other',
    '/audits/a-1/other',
    '/audits/a-1/share/extra',
    '/audits/a/b/c/d/e',
  ])('%s is not found', (path) => {
    expect(matchRoute(path)).toEqual({ name: 'not-found', path });
  });

  it('are never Check-up routes', () => {
    const paths = [
      PATHS.auditNew,
      PATHS.audits,
      PATHS.auditSettings,
      PATHS.auditShortlist,
      PATHS.helperSignIn,
      PATHS.audit('a-1'),
      PATHS.auditVersion('a-1', 1),
      PATHS.auditReview('a-1', 1),
      PATHS.auditExport('a-1', 1),
      PATHS.auditShare('a-1'),
      PATHS.auditHelpers('a-1'),
    ];
    for (const path of paths) {
      const route = matchRoute(path);
      expect(route.name, path).not.toBe('not-found');
      expect(isCheckRoute(route), path).toBe(false);
      expect(readsAddressParam(route), path).toBe(false);
    }
  });
});

describe('App.tsx shows every Website Audit screen', () => {
  const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
  const screens = filesUnder(AUDIT_DIR).filter((file) => /(Screen|AuditAiModelsPanel)\.tsx$/.test(file));

  it('finds the screens', () => {
    expect(screens.length).toBeGreaterThanOrEqual(12);
  });

  it.each(screens.map((file) => [file.slice(AUDIT_DIR.length + 1).replace(/\\/g, '/'), file]))(
    '%s is imported and rendered',
    (_name, file) => {
      const source = readFileSync(file, 'utf8');
      const exported = [...source.matchAll(/export function (\w+Screen|AuditAiModelsPanel)\b/g)].map((m) => m[1]);
      // A file may also export its stateless view; only the stateful screen or panel is mounted.
      expect(exported.length).toBeGreaterThan(0);
      for (const name of exported) {
        expect(app, `${name} imported`).toMatch(
          new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '\\./screens/audit/`)
        );
        expect(app, `${name} rendered`).toMatch(new RegExp(`<${name}[\\s/>]`));
      }
    }
  );
});

describe('browser-safe imports', () => {
  it('no Website Audit file imports the @qa/types barrel for values', () => {
    for (const file of filesUnder(AUDIT_DIR).filter((f) => /\.tsx?$/.test(f))) {
      const source = readFileSync(file, 'utf8');
      for (const line of source.split('\n')) {
        if (/^import\s/.test(line) && /from '@qa\/types'/.test(line)) {
          expect(line, file).toMatch(/^import type /);
        }
      }
    }
  });
});
