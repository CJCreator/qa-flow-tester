import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AUDIT_COMMANDS } from '../src/components/CommandPalette';
import { CRUMB_LABELS, TopBar, crumbTrail, navItems } from '../src/components/TopBar';
import { PATHS, type Route } from '../src/lib/router';
import { AUDIT_ROUTE_NAMES, BetaAuditNotice, showsBetaAuditNotice } from '../src/screens/audit/BetaAuditNotice';

const ROUTES: Route[] = [
  { name: 'landing' },
  { name: 'new' },
  { name: 'scan' },
  { name: 'plan' },
  { name: 'testing' },
  { name: 'reports' },
  { name: 'report', runId: 'r' },
  { name: 'visibility', runId: 'r' },
  { name: 'baselines' },
  { name: 'benchmark' },
  { name: 'settings' },
  { name: 'audit-new' },
  { name: 'audits' },
  { name: 'audit', auditId: 'a1' },
  { name: 'audit-version', auditId: 'a1', version: 2 },
  { name: 'audit-review', auditId: 'a1', version: 2 },
  { name: 'audit-export', auditId: 'a1', version: 2 },
  { name: 'audit-share', auditId: 'a1' },
  { name: 'audit-helpers', auditId: 'a1' },
  { name: 'audit-settings' },
  { name: 'audit-shortlist' },
  { name: 'helper-sign-in' },
  { name: 'not-found', path: '/x' },
];

const topBar = (route: Route, beta = false) =>
  renderToStaticMarkup(createElement(TopBar, { route, checkupInProgress: false, beta }));

describe('breadcrumbs', () => {
  it('every route name has a non-empty crumb label', () => {
    for (const route of ROUTES) {
      const trail = crumbTrail(route);
      expect(trail.length, route.name).toBeGreaterThan(0);
      expect(trail.every((l) => l.length > 0)).toBe(true);
    }
    expect(Object.keys(CRUMB_LABELS).sort()).toEqual([...new Set(ROUTES.map((r) => r.name))].sort());
  });

  it('audit crumbs use the plain names, with the version number', () => {
    expect(crumbTrail({ name: 'audit-review', auditId: 'a1', version: 3 })).toEqual([
      'Website Audits',
      'Website Audit',
      'Version 3',
      'Review',
    ]);
    expect(crumbTrail({ name: 'audit-helpers', auditId: 'a1' }).at(-1)).toBe('Helpers');
    expect(crumbTrail({ name: 'audit-share', auditId: 'a1' }).at(-1)).toBe('Shared Links');
    expect(crumbTrail({ name: 'audit-export', auditId: 'a1', version: 1 }).at(-1)).toBe('Export');
  });

  it('renders the trail on an audit screen', () => {
    const html = topBar({ name: 'audit-version', auditId: 'a1', version: 2 });
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('Version 2');
    expect(html).toContain(`href="${PATHS.audits}"`);
  });
});

describe('top bar: Website Audit', () => {
  it('is active on every audit route and not on check-up routes', () => {
    for (const route of ROUTES) {
      const html = topBar(route);
      const item = html.match(/<a [^>]*href="\/audits"[^>]*>Website Audit<\/a>/)?.[0] ?? '';
      expect(item, route.name).not.toBe('');
      const active = item.includes('aria-current="page"');
      expect(active, route.name).toBe(AUDIT_ROUTE_NAMES.includes(route.name));
    }
  });

  it('has Shortlist and Website Audit settings in More and in the phone menu', () => {
    const { more } = navItems();
    expect(more.map((l) => l.label)).toEqual(expect.arrayContaining(['Shortlist', 'Website Audit settings']));
    expect(more.find((l) => l.label === 'Shortlist')?.to).toBe(PATHS.auditShortlist);
    expect(more.find((l) => l.label === 'Website Audit settings')?.to).toBe(PATHS.auditSettings);
  });

  it('on a beta copy hides the owner audit items everywhere', () => {
    const { primary, more } = navItems(true);
    const labels = [...primary, ...more].map((l) => l.label);
    for (const gone of ['Website Audit', 'Shortlist', 'Website Audit settings']) expect(labels).not.toContain(gone);
    expect(labels).toContain('New check-up');
    expect(topBar({ name: 'new' }, true)).not.toContain('>Website Audit<');
  });
});

describe('command palette', () => {
  it('lists the four Website Audit entries', () => {
    expect(AUDIT_COMMANDS.map((c) => [c.title, c.to])).toEqual([
      ['New Website Audit', PATHS.auditNew],
      ['Saved Website Audits', PATHS.audits],
      ['Shortlist', PATHS.auditShortlist],
      ['Website Audit settings', PATHS.auditSettings],
    ]);
  });
});

describe('beta Website Audit notice', () => {
  const owner = ['audit-new', 'audits', 'audit-settings', 'audit-shortlist', 'audit-share', 'audit-helpers'] as const;
  const shared = ['audit', 'audit-version', 'audit-review', 'audit-export'] as const;

  it('shows on every audit screen except Helper sign-in when the visitor is not a Helper', () => {
    for (const name of AUDIT_ROUTE_NAMES) {
      expect(showsBetaAuditNotice(name, true, false), name).toBe(name !== 'helper-sign-in');
    }
  });

  it('shows only on the owner-only screens for a Helper', () => {
    for (const name of owner) expect(showsBetaAuditNotice(name, true, true), name).toBe(true);
    for (const name of shared) expect(showsBetaAuditNotice(name, true, true), name).toBe(false);
    expect(showsBetaAuditNotice('helper-sign-in', true, true)).toBe(false);
  });

  it('never shows on an own copy or on other screens', () => {
    for (const name of AUDIT_ROUTE_NAMES) expect(showsBetaAuditNotice(name, false, false), name).toBe(false);
    expect(showsBetaAuditNotice('new', true, false)).toBe(false);
    expect(showsBetaAuditNotice('settings', true, false)).toBe(false);
  });

  it('says why and where to go', () => {
    const html = renderToStaticMarkup(createElement(BetaAuditNotice));
    expect(html).toContain('Website Audits run on your own copy of Release check-up');
    expect(html).toContain('Shared Links');
    expect(html).toContain('docs/DEPLOYMENT.md');
    expect(html).toMatch(/href="https:\/\/github\.com\/[^"]+\/blob\/main\/docs\/DEPLOYMENT\.md"/);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
