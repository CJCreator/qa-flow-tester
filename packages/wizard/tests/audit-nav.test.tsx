import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AUDIT_LINKS, AreaNav, CHECKUP_LINKS, areaOf, menuGroups } from '../src/components/AreaNav';
import { AUDIT_COMMANDS } from '../src/components/CommandPalette';
import { MobileMenu, TopBar } from '../src/components/TopBar';
import { PATHS, type Route } from '../src/lib/router';
import { NotFoundScreen } from '../src/screens/NotFoundScreen';
import { AUDIT_ROUTE_NAMES, BetaAuditNotice, showsBetaAuditNotice } from '../src/screens/audit/BetaAuditNotice';
import { AuditTabs, type AuditTab } from '../src/screens/audit/AuditTabs';
import { loadHelperStatus, resetKnownHelperSignIn, type Fetch } from '../src/screens/audit/saved/helper-api';

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

const topBar = (route: Route, beta = false, checkupInProgress = false, auditOwner = false) =>
  renderToStaticMarkup(createElement(TopBar, { route, checkupInProgress, beta, auditOwner }));
const areaNav = (route: Route, beta = false, auditOwner = false) =>
  renderToStaticMarkup(createElement(AreaNav, { route, beta, auditOwner }));
const CHECKUP_NAMES: Route['name'][] = [
  'new',
  'scan',
  'plan',
  'testing',
  'reports',
  'report',
  'visibility',
  'baselines',
  'benchmark',
];
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** The <a> in some markup whose href is `to` and whose text starts with `label`, or ''. */
const anchor = (html: string, to: string, label: string) =>
  html.match(new RegExp(`<a [^>]*href="${to}"[^>]*>${label}(?:<(?!/a>)[^]*?)?</a>`))?.[0] ?? '';

describe('no breadcrumb row (ADR 0041)', () => {
  it('no screen renders a breadcrumb or a Home link to the marketing page', () => {
    for (const route of ROUTES) {
      const html = topBar(route) + areaNav(route);
      expect(html, route.name).not.toContain('aria-label="Breadcrumb"');
      expect(html, route.name).not.toContain('href="/"');
    }
  });

  it('the brand leads to New check-up', () => {
    expect(topBar({ name: 'settings' })).toMatch(/<a [^>]*href="\/check"[^>]*><svg[^]*?Release check-up<\/a>/);
  });
});

describe('top bar: two areas and Settings', () => {
  it('Check-ups is current on every check-up route and nowhere else', () => {
    for (const route of ROUTES) {
      const item = anchor(topBar(route), PATHS.new, 'Check-ups');
      expect(item, route.name).not.toBe('');
      expect(item.includes('aria-current'), route.name).toBe(CHECKUP_NAMES.includes(route.name));
    }
  });

  it('Website Audits is current on every audit route and not on check-up routes', () => {
    for (const route of ROUTES) {
      const item = anchor(topBar(route), PATHS.audits, 'Website Audits');
      expect(item, route.name).not.toBe('');
      expect(item.includes('aria-current'), route.name).toBe(AUDIT_ROUTE_NAMES.includes(route.name));
    }
  });

  it('Settings is current only on Settings', () => {
    for (const route of ROUTES) {
      const item = anchor(topBar(route), PATHS.settings, 'Settings');
      expect(item, route.name).not.toBe('');
      expect(item.includes('aria-current="page"'), route.name).toBe(route.name === 'settings');
    }
  });

  it('has no More menu', () => {
    for (const route of ROUTES) expect(topBar(route), route.name).not.toMatch(/>More</);
  });

  it('keeps the in-progress dot with its spoken label, off the check-up screens', () => {
    expect(topBar({ name: 'settings' }, false, true)).toContain('aria-label="A check-up is in progress" role="status"');
    expect(topBar({ name: 'audits' }, false, true)).toContain('aria-label="A check-up is in progress" role="status"');
    for (const name of ['new', 'scan', 'plan', 'testing'] as const) {
      expect(topBar({ name }, false, true), name).not.toContain('a check-up is in progress');
    }
  });

  it('the phone Menu button starts closed and says Menu', () => {
    expect(topBar({ name: 'new' })).toMatch(/<button [^>]*aria-expanded="false"[^>]*>Menu<\/button>/);
  });

  it('on a beta copy hides Website Audits', () => {
    const html = topBar({ name: 'new' }, true);
    expect(html).not.toContain('>Website Audits<');
    expect(html).not.toContain(`href="${PATHS.audits}"`);
    expect(html).toContain('>Check-ups<');
  });

  it('on a beta copy shows Website Audits to an audit owner', () => {
    const html = topBar({ name: 'new' }, true, false, true);
    expect(html).toContain('>Website Audits<');
    expect(html).toContain(`href="${PATHS.audits}"`);
  });
});

describe('area row', () => {
  it('Check-ups row: four places in order', () => {
    expect(CHECKUP_LINKS.map((l) => [l.label, l.to])).toEqual([
      ['New check-up', PATHS.new],
      ['Past check-ups', PATHS.reports],
      ['Visual baselines', PATHS.baselines],
      ['Compare sites', PATHS.benchmark],
    ]);
    const html = areaNav({ name: 'baselines' });
    expect(html).toContain('aria-label="Check-ups"');
    expect(anchor(html, PATHS.baselines, 'Visual baselines')).toContain('aria-current="page"');
    expect(anchor(html, PATHS.new, 'New check-up')).not.toContain('aria-current');
  });

  it('Website Audits row: Audits is current on the list, the start form and every per-audit screen', () => {
    expect(AUDIT_LINKS.map((l) => [l.label, l.to])).toEqual([
      ['Audits', PATHS.audits],
      ['Shortlist', PATHS.auditShortlist],
      ['Audit settings', PATHS.auditSettings],
    ]);
    for (const route of ROUTES.filter((r) => r.name.startsWith('audit'))) {
      const html = areaNav(route);
      expect(html, route.name).toContain('aria-label="Website Audits"');
      const current = !['audit-shortlist', 'audit-settings'].includes(route.name);
      expect(anchor(html, PATHS.audits, 'Audits').includes('aria-current="page"'), route.name).toBe(current);
    }
    expect(anchor(areaNav({ name: 'audit-shortlist' }), PATHS.auditShortlist, 'Shortlist')).toContain(
      'aria-current="page"'
    );
  });

  it('no row on the landing page, Settings, Helper sign-in and Page not found', () => {
    const none: Route[] = [
      { name: 'landing' },
      { name: 'settings' },
      { name: 'helper-sign-in' },
      { name: 'not-found', path: '/x' },
    ];
    for (const route of none) expect(areaNav(route), route.name).toBe('');
  });

  it('every route belongs to the area its top-bar link marks', () => {
    for (const route of ROUTES) {
      const area = areaOf(route);
      if (CHECKUP_NAMES.includes(route.name)) expect(area, route.name).toBe('checkups');
      else if (AUDIT_ROUTE_NAMES.includes(route.name)) expect(area, route.name).toBe('audits');
      else expect(area, route.name).toBeNull();
    }
  });

  it('on a beta copy there is no Website Audits row', () => {
    expect(areaNav({ name: 'audit', auditId: 'a1' }, true)).toBe('');
    expect(areaNav({ name: 'reports' }, true)).toContain('aria-label="Check-ups"');
  });

  it('on a beta copy shows Website Audits row to an audit owner', () => {
    expect(areaNav({ name: 'audit', auditId: 'a1' }, true, true)).toContain('aria-label="Website Audits"');
  });
});

describe('phone menu', () => {
  it('groups the places under Check-ups, Website Audits and Settings', () => {
    expect(menuGroups().map((g) => [g.title, g.links.length])).toEqual([
      ['Check-ups', 4],
      ['Website Audits', 3],
      ['Settings', 1],
    ]);
    const html = renderToStaticMarkup(
      createElement(MobileMenu, {
        id: 'm',
        route: { name: 'audit-shortlist' },
        checkupInProgress: false,
        onNavigate: () => {},
      })
    );
    for (const heading of ['Check-ups', 'Website Audits', 'Settings']) expect(html).toContain(`>${heading}</p>`);
    expect(anchor(html, PATHS.auditShortlist, 'Shortlist')).toContain('aria-current="page"');
  });

  it('on a beta copy leaves out the Website Audits group', () => {
    expect(menuGroups(true).map((g) => g.title)).toEqual(['Check-ups', 'Settings']);
  });

  it('the Menu button reads Close when open, and Esc returns focus to it', () => {
    const topbar = read('../src/components/TopBar.tsx');
    expect(topbar).toContain("{menuOpen ? 'Close' : 'Menu'}");
    expect(topbar).toContain('menuButtonRef.current?.focus()');
    expect(topbar).toContain('onNavigate={() => setMenuOpen(false)}');
  });
});

describe('command palette', () => {
  it('lists the four Website Audit entries', () => {
    expect(AUDIT_COMMANDS.map((c) => [c.title, c.to])).toEqual([
      ['Start a Website Audit', PATHS.auditNew],
      ['Go to Website Audits', PATHS.audits],
      ['Go to Shortlist', PATHS.auditShortlist],
      ['Go to Audit settings', PATHS.auditSettings],
    ]);
  });

  it('lists only the g-chords PlanDocument handles, and scrolls with scrollBehavior()', () => {
    const palette = read('../src/components/CommandPalette.tsx');
    for (const gone of ["'g h'", "'g r'", "'g b'", "'g ,'", 'g then h', 'g then r', 'g then b', 'g then ,']) {
      expect(palette, gone).not.toContain(gone);
    }
    expect(palette).not.toContain("behavior: 'smooth'");
    expect(palette).toContain('scrollBehavior()');
    const plan = read('../src/components/plan/PlanDocument.tsx');
    const handled = new Set([...plan.matchAll(/^\s+([a-z]): 'plan-[a-z-]+',$/gm)].map((m) => m[1]));
    expect(handled.size).toBeGreaterThan(0);
    for (const m of palette.matchAll(/'g (?:then )?([a-z])'/g)) {
      if (m[1] !== 'g') expect(handled.has(m[1]), m[0]).toBe(true);
    }
  });

  it('is a labelled modal dialog with a combobox and a listbox', () => {
    const palette = read('../src/components/CommandPalette.tsx');
    expect(palette).toContain('showModal()');
    expect(palette).toContain('role="combobox"');
    expect(palette).toContain('role="listbox"');
    expect(palette).toContain('aria-activedescendant=');
    expect(palette).toContain('htmlFor={ids.input}');
    expect(palette).toContain('opener.focus()');
    expect(palette).not.toMatch(/bg-black|🔍/);
  });
});

describe('Page not found', () => {
  it('leads to New check-up and Past check-ups, and to Website Audits only off beta', () => {
    const own = renderToStaticMarkup(createElement(NotFoundScreen));
    expect(own).toContain('Page not found');
    expect(anchor(own, PATHS.new, 'New check-up')).toContain('btn-primary');
    expect(anchor(own, PATHS.reports, 'Past check-ups')).not.toBe('');
    expect(anchor(own, PATHS.audits, 'Website Audits')).not.toBe('');
    const beta = renderToStaticMarkup(createElement(NotFoundScreen, { beta: true }));
    expect(beta).not.toContain(`href="${PATHS.audits}"`);
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

  it('never shows to an audit owner on a beta copy (T-86)', () => {
    for (const name of AUDIT_ROUTE_NAMES) {
      expect(showsBetaAuditNotice(name, true, false, true), name).toBe(false);
      expect(showsBetaAuditNotice(name, true, true, true), name).toBe(false);
    }
  });

  it('offers a Sign in with Google action leading to Helper sign-in (T-86)', () => {
    const html = renderToStaticMarkup(createElement(BetaAuditNotice));
    expect(html).toContain('Sign in with Google');
    expect(html).toContain(`href="${PATHS.helperSignIn}"`);
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

describe('audit tabs: Helpers hidden once Helper sign-in is known to be off', () => {
  const replyWith =
    (body: unknown, status = 200): Fetch =>
    async () =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const tabs = (current: AuditTab, hide: AuditTab[] = []) =>
    renderToStaticMarkup(createElement(AuditTabs, { auditId: 'a1', version: 2, current, hide }));
  const helpersHref = PATHS.auditHelpers('a1');

  it('shows the Helpers tab when the status is unknown', () => {
    resetKnownHelperSignIn();
    expect(tabs('results')).toContain(`href="${helpersHref}"`);
  });

  it('leaves the Helpers tab out when the status is off and the current tab is not Helpers', async () => {
    resetKnownHelperSignIn();
    await loadHelperStatus(replyWith({ enabled: false }));
    const html = tabs('results');
    expect(html).not.toContain(`href="${helpersHref}"`);
    expect(html).toContain('>Results</a>');
    expect(html).toContain('>Share</a>');
    resetKnownHelperSignIn();
  });

  it('keeps the Helpers tab on the Helpers screen even when the status is off', async () => {
    resetKnownHelperSignIn();
    await loadHelperStatus(replyWith({ enabled: false }));
    expect(tabs('helpers')).toContain(`href="${helpersHref}"`);
    resetKnownHelperSignIn();
  });

  it('shows the Helpers tab when the status is on', async () => {
    resetKnownHelperSignIn();
    await loadHelperStatus(replyWith({ enabled: true, firebase: null }));
    expect(tabs('results')).toContain(`href="${helpersHref}"`);
    resetKnownHelperSignIn();
  });

  it('still honours the hide prop', () => {
    resetKnownHelperSignIn();
    const html = tabs('results', ['share']);
    expect(html).not.toContain('>Share</a>');
    expect(html).toContain(`href="${helpersHref}"`);
  });
});
