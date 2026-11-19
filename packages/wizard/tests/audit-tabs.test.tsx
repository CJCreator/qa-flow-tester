import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AuditVersion } from '@qa/types/src/browser.js';
import { PATHS, matchRoute } from '../src/lib/router';
import { AuditTabs, type AuditTab } from '../src/screens/audit/AuditTabs';
import { AUDIT_ROUTE_NAMES } from '../src/screens/audit/BetaAuditNotice';
import {
  ImprovedVersionScreen,
  ImprovedVersionView,
  NO_AI_KEY_REASON,
  type ImprovedVersionViewProps,
} from '../src/screens/audit/improved/ImprovedVersionScreen';
import { PreviewShareView, type PreviewShareViewProps } from '../src/screens/audit/saved/PreviewShareScreen';
import { resetKnownHelperSignIn } from '../src/screens/audit/saved/helper-api';

const AUDIT_ID = 'a1';
const versions = [
  { auditId: AUDIT_ID, version: 1, status: 'done', startedAt: '2026-10-01T08:00:00Z' },
  { auditId: AUDIT_ID, version: 2, status: 'done', startedAt: '2026-11-03T08:00:00Z' },
] as unknown as AuditVersion[];

const textOf = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');

const tabs = (current: AuditTab, hide: AuditTab[] = [], version: number | undefined = 2) =>
  renderToStaticMarkup(createElement(AuditTabs, { auditId: AUDIT_ID, version, current, hide }));

/** The tab labels in the order shown. */
const labels = (html: string) => [...html.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);

function view(over: Partial<ImprovedVersionViewProps> = {}): string {
  const props: ImprovedVersionViewProps = {
    auditId: AUDIT_ID,
    versions,
    version: 2,
    language: 'en',
    preview: { status: 'idle' },
    aiReady: true,
    onVersion: () => undefined,
    onLanguage: () => undefined,
    onMake: () => undefined,
    improve: { status: 'loading' },
    chosen: [],
    variantCount: 3,
    making: false,
    message: null,
    onTogglePage: () => undefined,
    onVariantCount: () => undefined,
    onMakeVariants: () => undefined,
    ...over,
  };
  return renderToStaticMarkup(createElement(ImprovedVersionView, props));
}

describe('the Improved version tab (ADR 0049)', () => {
  it('has its own address, read back as its route', () => {
    expect(PATHS.auditImproved('a b')).toBe('/audits/a%20b/improved');
    expect(matchRoute('/audits/a1/improved')).toEqual({ name: 'audit-improved', auditId: 'a1' });
    expect(matchRoute('/audits/a1/improved/x')).toEqual({ name: 'not-found', path: '/audits/a1/improved/x' });
    expect(AUDIT_ROUTE_NAMES).toContain('audit-improved');
  });

  it('sits between Documents and Download', () => {
    resetKnownHelperSignIn();
    const shown = labels(tabs('results'));
    expect(shown.slice(0, 4)).toEqual(['Results', 'Documents', 'Improved version', 'Download']);
    expect(shown.indexOf('Share')).toBeGreaterThan(shown.indexOf('Download'));
  });

  it('appears on every audit screen, the Documents and Download screens included', () => {
    resetKnownHelperSignIn();
    const href = `href="${PATHS.auditImproved(AUDIT_ID)}"`;
    const screens: Array<[AuditTab, AuditTab[], number | undefined]> = [
      ['results', [], 2],
      ['documents', ['share', 'helpers'], 2],
      ['download', ['share', 'helpers'], 2],
      ['history', [], 2],
      ['history', ['share', 'helpers'], undefined],
      ['share', [], 2],
      ['helpers', [], undefined],
      ['improved', ['share', 'helpers'], 2],
    ];
    for (const [current, hide, version] of screens) expect(tabs(current, hide, version), current).toContain(href);
    expect(tabs('improved')).toMatch(/<a [^>]*aria-current="page"[^>]*>Improved version<\/a>/);
  });

  it('every screen that shows the audit tabs keeps the Improved version tab', () => {
    for (const file of [
      'documents/ReviewDocumentsScreen.tsx',
      'documents/ExportDocumentsScreen.tsx',
      'results/AnalysisScreen.tsx',
      'saved/AuditHistoryScreen.tsx',
    ]) {
      const source = readFileSync(new URL(`../src/screens/audit/${file}`, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/hide=\{\[[^\]]*'improved'/);
    }
  });
});

describe('the Improved version screen', () => {
  it('makes the improved homepage there, with the version and language', () => {
    const html = view();
    expect(html).toMatch(/<button [^>]*>Make the Improved version<\/button>/);
    expect(html).toContain(`href="/api/audits/${AUDIT_ID}/preview?version=2"`);
    expect(html).toMatch(/<label[^>]*for="improved-version"/);
    expect(html).toMatch(/<label[^>]*for="improved-language"/);
    expect(textOf(html)).toMatch(/nothing on the live site changes/);
  });

  it('without a working AI key, the button is disabled and carries a reason line (W20)', () => {
    const html = view({ aiReady: false });
    const button = html.match(/<button [^>]*>Make the Improved version<\/button>/)?.[0] ?? '';
    expect(button).toContain('disabled=""');
    expect(button).toContain('aria-describedby="improved-make-reason"');
    expect(html).toMatch(/<p id="improved-make-reason"[^>]*>/);
    expect(textOf(html)).toContain(NO_AI_KEY_REASON);
    expect(html).toMatch(/<a [^>]*href="\/settings"/);
  });

  it('with a key, or while unknown, the button is on and has no reason line', () => {
    for (const aiReady of [true, null]) {
      const button = view({ aiReady }).match(/<button [^>]*>Make the Improved version<\/button>/)?.[0] ?? '';
      expect(button, String(aiReady)).not.toContain('disabled');
      expect(view({ aiReady }), String(aiReady)).not.toContain('improved-make-reason');
    }
  });

  it('says when it is ready, being made, or refused', () => {
    expect(textOf(view({ preview: { status: 'made', createdAt: '2026-11-03T10:00:00Z' } }))).toMatch(
      /The Improved version is ready/
    );
    expect(textOf(view({ preview: { status: 'making' } }))).toMatch(/Making the Improved version/);
    const refused = view({ preview: { status: 'failed', message: 'No key.', noAiKey: true } });
    expect(refused).toMatch(/<a [^>]*href="\/settings"[^>]*>Add an AI key in Settings<\/a>/);
    expect(textOf(view({ preview: { status: 'failed', message: 'Could not be made.', noAiKey: false } }))).toContain(
      'Could not be made.'
    );
  });

  it('says when no version has finished, and shows a spinner while loading', () => {
    expect(textOf(view({ versions: [] }))).toMatch(/no finished version yet/);
    const html = renderToStaticMarkup(
      createElement(ImprovedVersionScreen, { auditId: AUDIT_ID, aiSetup: async () => ({ configured: true }) })
    );
    expect(textOf(html)).toMatch(/Improved version/);
    expect(textOf(html)).toMatch(/Loading the Website Audit/);
  });

  it('avoids the words the glossary rules out', () => {
    const source = readFileSync(
      new URL('../src/screens/audit/improved/ImprovedVersionScreen.tsx', import.meta.url),
      'utf8'
    );
    expect(source).not.toMatch(/redesign|makeover|mockup/i);
  });
});

describe('Share keeps only Shared Links', () => {
  it('no longer shows the preview', () => {
    const props: PreviewShareViewProps = {
      auditId: AUDIT_ID,
      versions,
      version: 2,
      kind: 'pitch',
      shareLanguage: 'en',
      created: null,
      copied: 'idle',
      links: { status: 'loaded', links: [] },
      busy: false,
      message: null,
      origin: 'https://qa.example.com',
      onVersion: () => undefined,
      onKind: () => undefined,
      onShareLanguage: () => undefined,
      onCreateLink: () => undefined,
      onCopy: () => undefined,
      onRevoke: () => undefined,
    };
    const html = renderToStaticMarkup(createElement(PreviewShareView, props));
    expect(html).not.toMatch(/Make preview|Open preview|Improved homepage preview<\/h2>/);
    expect(html).toContain('Make a Shared Link');
  });
});
