import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AuditSummary, AuditVersion } from '@qa/types/src/browser.js';
import {
  AUDIT_PATHS,
  RUN_IN_PROGRESS_TEXT,
  deleteAudit,
  followRunningVersion,
  latestFinishedVersion,
  latestVersion,
  runningVersion,
  listAudits,
  loadVersion,
  rerunAndReload,
  versionCounts,
  versionsOldestFirst,
} from '../src/screens/audit/saved/saved-api';
import {
  SavedAuditsActions,
  SavedAuditsView,
  type SavedAuditsLoad,
} from '../src/screens/audit/saved/SavedAuditsScreen';
import {
  AuditHistoryView,
  DELETE_WARNING,
  deleteConfirmOptions,
  type AuditHistoryViewProps,
} from '../src/screens/audit/saved/AuditHistoryScreen';

// ---------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------

const AUDIT_ID = 'abcd1234';

function version(n: number, over: Partial<AuditVersion> = {}): AuditVersion {
  return {
    auditId: AUDIT_ID,
    version: n,
    url: 'https://shop.example.org/',
    limits: { maxPages: 50, maxDepth: 3, includePaths: [], excludePaths: [] },
    language: 'en',
    status: 'done',
    startedAt: `2026-11-0${n}T10:00:00Z`,
    pagesRecorded: 10 + n,
    pagesSkipped: 1,
    findings: 5,
    ...over,
  } as AuditVersion;
}

// Versions out of order on purpose: the screen sorts them oldest first.
const summary: AuditSummary = {
  auditId: AUDIT_ID,
  url: 'https://shop.example.org/',
  host: 'shop.example.org',
  createdAt: '2026-11-01T10:00:00Z',
  versions: [
    version(3, { status: 'failed', error: 'The site stopped answering.' }),
    version(1),
    version(2, { status: 'running', pagesRecorded: undefined, findings: undefined, pagesSkipped: undefined }),
  ],
  shortlist: {
    auditId: AUDIT_ID,
    mark: 'pitch',
    notes: '',
    outcome: null,
    outcomeNote: '',
    updatedAt: '2026-11-02T00:00:00Z',
  },
};

const other: AuditSummary = {
  auditId: 'zzzz9999',
  url: 'https://bakery.example.com/menu',
  host: 'bakery.example.com',
  createdAt: '2026-10-01T10:00:00Z',
  versions: [version(1, { auditId: 'zzzz9999', status: 'stopped' })],
};

function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function textOf(html: string): string {
  return decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
}

/** A fetch that records each call and answers with the next queued reply. */
function fakeFetch(...replies: Array<{ status: number; body: unknown } | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const next = replies.shift();
    if (!next) throw new Error('no reply queued');
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { impl, calls };
}

const noop = () => {};

function listView(load: SavedAuditsLoad): string {
  return renderToStaticMarkup(createElement(SavedAuditsView, { load, onRetry: noop }));
}

function historyView(props: Partial<AuditHistoryViewProps> = {}): string {
  return renderToStaticMarkup(
    createElement(AuditHistoryView, {
      summary,
      opened: null,
      rerunning: false,
      deleting: false,
      message: null,
      onOpen: noop,
      onRerun: noop,
      onAskDelete: noop,
      ...props,
    })
  );
}

function getReply(n: number) {
  const v = summary.versions.find((x) => x.version === n)!;
  return {
    summary,
    version: v,
    result: null,
    edits: { findings: [], sections: [], removedPages: [], recommendations: [], proposal: {}, updatedAt: null },
  };
}

// ---------------------------------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------------------------------

describe('saved Website Audits list', () => {
  it('shows host, address, number of versions, latest status and Shortlist mark of each', () => {
    const html = listView({ status: 'loaded', audits: [summary, other] });
    const shop = textOf(html.slice(html.indexOf(`data-audit="${AUDIT_ID}"`), html.indexOf('data-audit="zzzz9999"')));
    expect(shop).toContain('shop.example.org');
    expect(shop).toContain('https://shop.example.org/');
    expect(shop).toContain('3 versions');
    // The latest version is 3 (failed), not the first in the array.
    expect(shop).toContain('Latest: Failed');
    expect(shop).toContain('Shortlist: Pitch');

    const bakery = textOf(html.slice(html.indexOf('data-audit="zzzz9999"')));
    expect(bakery).toContain('https://bakery.example.com/menu');
    expect(bakery).toContain('1 version ');
    expect(bakery).toContain('Latest: Stopped');
    expect(bakery).not.toContain('Shortlist');

    expect(html).toContain(`href="${AUDIT_PATHS.history(AUDIT_ID)}"`);
    expect(html).toContain('aria-label="Open the Website Audit of shop.example.org"');
  });

  it('shows a short how-to-start line and a start link when nothing is saved', () => {
    const html = listView({ status: 'loaded', audits: [] });
    const text = textOf(html);
    expect(text).toContain('No Website Audits yet.');
    expect(text).toContain('To start one, enter the address of a public website');
    expect(html).toContain(`href="${AUDIT_PATHS.start}"`);
  });

  it('shows loading and a failure with a retry', () => {
    expect(listView({ status: 'loading' })).toContain('role="status"');
    const failed = listView({ status: 'failed', message: 'The tool is not answering.' });
    expect(failed).toContain('role="alert"');
    expect(textOf(failed)).toContain('Try again');
    expect(textOf(failed)).toContain('The tool is not answering.');
  });

  it('makes the whole row the link to the audit, with no primary button per row', () => {
    const html = listView({ status: 'loaded', audits: [summary, other] });
    expect(html).not.toContain('btn-primary');
    expect(html).toMatch(/<a [^>]*class="[^"]*after:inset-0[^"]*"/);
  });

  it('escapes text from the runner', () => {
    const html = listView({ status: 'loaded', audits: [{ ...other, host: '<img src=x onerror=alert(1)>' }] });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('lists through GET /api/audits and refuses a malformed reply', async () => {
    const ok = fakeFetch({ status: 200, body: { audits: [summary] } });
    const outcome = await listAudits(ok.impl);
    expect(ok.calls[0].url).toBe('/api/audits');
    expect(ok.calls[0].init?.method).toBe('GET');
    expect(outcome).toEqual({ ok: true, value: [summary] });

    const bad = fakeFetch({ status: 200, body: { audits: 'nope' } });
    expect(await listAudits(bad.impl)).toMatchObject({ ok: false });
    const down = fakeFetch(new Error('offline'));
    expect(await listAudits(down.impl)).toMatchObject({ ok: false, message: expect.stringContaining('not answering') });
  });
});

// ---------------------------------------------------------------------------------------------------
// REQ-028 AC-1/AC-2: history
// ---------------------------------------------------------------------------------------------------

describe('history of one Website Audit (REQ-028)', () => {
  it('sorts versions oldest first in the helper and finds the latest', () => {
    expect(versionsOldestFirst(summary).map((v) => v.version)).toEqual([1, 2, 3]);
    expect(latestVersion(summary)?.version).toBe(3);
    expect(latestVersion({ ...summary, versions: [] })).toBeNull();
  });

  it('lists every version newest first with start time, status in words and counts', () => {
    const html = historyView();
    const order = [1, 2, 3].map((n) => html.indexOf(`data-version="${n}"`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => b - a));

    const first = textOf(html.slice(order[0]));
    expect(first).toContain('Version 1');
    expect(first).toMatch(/Started \d{1,2} Nov 2026/);
    expect(first).toContain('Status: Finished');
    expect(first).toContain('11 pages recorded · 1 page skipped · 5 findings');

    const second = textOf(html.slice(order[1], order[0]));
    expect(second).toContain('Status: Running');
    expect(second).toContain('No counts yet');

    const third = textOf(html.slice(order[2], order[1]));
    expect(third).toContain('Status: Failed');
    expect(third).toContain('This version stopped before it finished.');
    // The raw error sits under Details for developers, not in the row's sentence.
    const thirdHtml = html.slice(order[2], order[1]);
    expect(thirdHtml.indexOf('Details for developers')).toBeGreaterThan(-1);
    expect(thirdHtml.indexOf('The site stopped answering.')).toBeGreaterThan(
      thirdHtml.indexOf('Details for developers')
    );

    for (const n of [1, 2, 3]) expect(html).toContain(`aria-label="Open version ${n}"`);
  });

  it('counts in words for one of each', () => {
    expect(versionCounts(version(1, { pagesRecorded: 1, pagesSkipped: 0, findings: 1 }))).toBe(
      '1 page recorded · 0 pages skipped · 1 finding'
    );
  });

  it('opens a version through GET /api/audits/:id?version=n', async () => {
    const { impl, calls } = fakeFetch({ status: 200, body: getReply(2) });
    const outcome = await loadVersion(AUDIT_ID, 2, impl);
    expect(calls[0].url).toBe(`/api/audits/${AUDIT_ID}?version=2`);
    expect(calls[0].init?.method).toBe('GET');
    expect(outcome.ok && outcome.value.version.version).toBe(2);

    const missing = fakeFetch({ status: 404, body: { error: 'x', code: 'ERR_AUDIT_NOT_FOUND' } });
    expect(await loadVersion(AUDIT_ID, 9, missing.impl)).toMatchObject({
      ok: false,
      code: 'ERR_AUDIT_NOT_FOUND',
      message: 'This Website Audit was not found. It may have been deleted.',
    });
  });

  it('shows the opened version in place, under its row, with links to its screens as plain route paths', () => {
    const html = historyView({ opened: { status: 'loaded', version: 1, reply: getReply(1) as never } });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Close version 1"');
    // In place: the details sit inside version 1's row (the last row, newest first).
    expect(html.slice(html.indexOf('data-version="1"'))).toContain(`href="${AUDIT_PATHS.review(AUDIT_ID, 1)}"`);
    expect(html).toContain(`href="${AUDIT_PATHS.version(AUDIT_ID, 1)}"`);
    expect(html).toContain(`href="${AUDIT_PATHS.review(AUDIT_ID, 1)}"`);
    expect(html).toContain(`href="${AUDIT_PATHS.export(AUDIT_ID, 1)}"`);
    expect(AUDIT_PATHS.version(AUDIT_ID, 1)).toBe('/audits/abcd1234/versions/1');

    const failed = historyView({ opened: { status: 'failed', version: 3, message: 'Could not open.' } });
    expect(failed).toContain('role="alert"');
    // A failed version has no results to open.
    const notDone = historyView({ opened: { status: 'loaded', version: 3, reply: getReply(3) as never } });
    expect(textOf(notDone)).toContain('This version has no results to open.');
  });

  it('links to the Share and Helpers screens by path through the audit tabs', () => {
    const html = historyView();
    expect(html).toContain('aria-label="This Website Audit"');
    expect(html).toContain(`href="/audits/${AUDIT_ID}/share"`);
    expect(html).toContain(`href="/audits/${AUDIT_ID}/helpers"`);
    expect(html).toMatch(/aria-current="page"[^>]*>Versions</);
  });

  it('shows the Shortlist mark above the versions, not only at the bottom', () => {
    const html = historyView();
    expect(html.indexOf('Shortlist: Pitch')).toBeGreaterThan(-1);
    expect(html.indexOf('Shortlist: Pitch')).toBeLessThan(html.indexOf('data-version="3"'));
  });

  it('renders the Shortlist slot', () => {
    expect(historyView({ shortlist: createElement('p', null, 'SLOT') })).toContain('SLOT');
  });
});

// ---------------------------------------------------------------------------------------------------
// REQ-028 AC-3: re-run
// ---------------------------------------------------------------------------------------------------

describe('re-run (REQ-028 AC-3)', () => {
  it('posts AUDIT_API.rerun, then reloads so the history lists the new version', async () => {
    const withNew = { ...summary, versions: [...summary.versions, version(4, { status: 'running' })] };
    const { impl, calls } = fakeFetch(
      { status: 202, body: { auditId: AUDIT_ID, version: 4 } },
      { status: 200, body: { ...getReply(4 - 1), summary: withNew } }
    );
    const outcome = await rerunAndReload(AUDIT_ID, impl);
    expect(calls[0]).toMatchObject({ url: `/api/audits/${AUDIT_ID}/rerun`, init: { method: 'POST' } });
    expect(calls[1].url).toBe(`/api/audits/${AUDIT_ID}`);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.started.version).toBe(4);

    const html = historyView({
      summary: outcome.value.summary!,
      message: { tone: 'pass', text: `Version ${outcome.value.started.version} started. It is listed below.` },
    });
    expect(html).toContain('data-version="4"');
    expect(html.indexOf('data-version="4"')).toBeLessThan(html.indexOf('data-version="3"'));
    expect(textOf(html)).toContain('Version 4 started.');
  });

  it('shows a plain message when another run is in progress', async () => {
    const { impl, calls } = fakeFetch({
      status: 409,
      body: { error: 'busy: slot held by checkup', code: 'ERR_RUN_IN_PROGRESS' },
    });
    const outcome = await rerunAndReload(AUDIT_ID, impl);
    expect(calls).toHaveLength(1);
    expect(outcome).toEqual({ ok: false, code: 'ERR_RUN_IN_PROGRESS', message: RUN_IN_PROGRESS_TEXT });
    expect(RUN_IN_PROGRESS_TEXT).toMatch(/^Another Check-up, benchmark or Website Audit is in progress/);
    expect(RUN_IN_PROGRESS_TEXT).not.toMatch(/\brun\b/i);

    const html = historyView({ message: { tone: 'fail', text: RUN_IN_PROGRESS_TEXT } });
    expect(html).toContain('role="alert"');
    expect(textOf(html)).toContain('Another Check-up, benchmark or Website Audit is in progress');
  });

  it('disables Audit again while it starts', () => {
    expect(historyView({ rerunning: true })).toMatch(/<button[^>]*disabled=""[^>]*>Starting…<\/button>/);
    expect(textOf(historyView())).toContain('Audit again');
  });
});

// ---------------------------------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------------------------------

describe('delete', () => {
  it('asks first, in a red confirm dialog, and says everything it removes', () => {
    // No inline question: the confirm dialog asks.
    expect(historyView()).not.toContain('role="alertdialog"');
    expect(historyView()).toContain('aria-label="Delete the Website Audit of shop.example.org"');

    const options = deleteConfirmOptions('shop.example.org');
    expect(options.danger).toBe(true);
    expect(options.title).toBe('Delete the Website Audit of shop.example.org?');
    expect(options.body).toBe(DELETE_WARNING);
    for (const part of ['every version', 'edit', 'Shortlist entry', 'Shared Link', 'Helper access']) {
      expect(DELETE_WARNING).toContain(part);
    }
    expect(options.confirmLabel).toBe('Delete the Website Audit');
    expect(options.cancelLabel).toBe('Keep it');
  });

  it('disables Delete while it deletes', () => {
    expect(historyView({ deleting: true })).toMatch(/<button[^>]*disabled=""[^>]*>Deleting…<\/button>/);
  });

  it('deletes through DELETE /api/audits/:id and explains a refusal', async () => {
    const ok = fakeFetch({ status: 200, body: { deleted: true } });
    expect(await deleteAudit(AUDIT_ID, ok.impl)).toEqual({ ok: true, value: true });
    expect(ok.calls[0]).toMatchObject({ url: `/api/audits/${AUDIT_ID}`, init: { method: 'DELETE' } });

    const running = fakeFetch({ status: 409, body: { error: 'x', code: 'ERR_AUDIT_RUNNING' } });
    expect(await deleteAudit(AUDIT_ID, running.impl)).toMatchObject({
      ok: false,
      message: expect.stringContaining('still running'),
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// T-69, T-76: results first, live history, Helper view, header actions
// ---------------------------------------------------------------------------------------------------

describe('history: results first and live', () => {
  it('finds the latest finished and the running version', () => {
    expect(latestFinishedVersion(summary)?.version).toBe(1);
    expect(runningVersion(summary)?.version).toBe(2);
    expect(latestFinishedVersion({ ...summary, versions: [] })).toBeNull();
  });

  it('puts an "Open the results" primary button for the latest finished version above the versions', () => {
    const html = historyView();
    const link = html.match(/<a [^>]*>Open the results<\/a>/)?.[0] ?? '';
    expect(link).toContain('href="/audits/abcd1234/versions/1"');
    expect(link).toContain('btn-primary');
    expect(html.indexOf('Open the results')).toBeLessThan(html.indexOf('data-version="1"'));
    expect(textOf(html)).toContain('Version 2 is running');
  });

  it('re-reads when the stream ends and opens no stream when nothing runs', () => {
    type Fake = { onmessage: ((m: { data: string }) => void) | null; onerror: (() => void) | null; close(): void };
    const close = vi.fn();
    let source: Fake | undefined;
    const openSource = (url: string) => {
      expect(url).toBe('/api/audits/abcd1234/stream');
      source = { onmessage: null, onerror: null, close };
      return source as never;
    };
    const onProgress = vi.fn();
    const onEnd = vi.fn();
    const stop = followRunningVersion(summary, { onProgress, onEnd }, openSource);
    source!.onmessage!({
      data: JSON.stringify({
        type: 'progress',
        auditId: AUDIT_ID,
        version: 2,
        stage: 'crawling',
        pagesFound: 3,
        pagesRecorded: 1,
        pagesSkipped: 0,
      }),
    });
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
    source!.onmessage!({ data: JSON.stringify({ type: 'done', auditId: AUDIT_ID, version: 2 }) });
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalled();
    stop();

    const idle = vi.fn();
    followRunningVersion({ ...summary, versions: [version(1)] }, { onEnd }, idle)();
    expect(idle).not.toHaveBeenCalled();
  });

  it('closes the stream when asked to stop', () => {
    const close = vi.fn();
    const stop = followRunningVersion(
      summary,
      { onEnd: vi.fn() },
      () => ({ onmessage: null, onerror: null, close }) as never
    );
    stop();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('history for a Helper (ADR 0037)', () => {
  it('shows the owner actions to the owner', () => {
    const text = textOf(historyView());
    for (const word of ['Audit again', 'Share', 'Helpers', 'Delete']) expect(text).toContain(word);
  });

  it('hides the owner actions until the Helper check has answered', () => {
    const text = textOf(historyView({ isHelper: null }));
    for (const word of ['Audit again', 'Share', 'Helpers', 'Delete']) expect(text).not.toContain(word);
    expect(text).toContain('Open the results');
  });

  it('hides Audit again, Delete, Helpers, Share and the Shortlist from a Helper but keeps the results', () => {
    const html = historyView({ isHelper: true, shortlist: createElement('p', null, 'SLOT') });
    const text = textOf(html);
    for (const word of ['Audit again', 'Share', 'Delete', 'SLOT', 'Shortlist']) expect(text).not.toContain(word);
    expect(html).not.toContain('/helpers"');
    expect(html).not.toContain('/share"');
    expect(html).not.toContain('alertdialog');
    expect(text).toContain('Open the results');
  });
});

describe('saved list header', () => {
  it('has the one primary Start a Website Audit when audits exist; the empty state carries it otherwise', () => {
    const withAudits = renderToStaticMarkup(
      createElement(SavedAuditsActions, { load: { status: 'loaded', audits: [summary] } })
    );
    expect(withAudits).toContain('href="/audits/new"');
    expect(withAudits).toContain('btn-primary');
    expect(textOf(withAudits)).toContain('Start a Website Audit');
    // Shortlist and settings live in the area row, not in the screen body.
    expect(withAudits).not.toContain('href="/audit-settings"');

    const empty = renderToStaticMarkup(createElement(SavedAuditsActions, { load: { status: 'loaded', audits: [] } }));
    expect(empty).toBe('');
    expect(listView({ status: 'loaded', audits: [] }).match(/btn-primary/g)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------
// Source rules
// ---------------------------------------------------------------------------------------------------

const SOURCES = [
  'SavedAuditsScreen.tsx',
  'AuditHistoryScreen.tsx',
  'ShortlistPanel.tsx',
  'ShortlistScreen.tsx',
  'saved-api.ts',
].map((name) => [name, readFileSync(new URL(`../src/screens/audit/saved/${name}`, import.meta.url), 'utf8')] as const);

describe('source rules', () => {
  it('imports @qa/types only through the browser entry and no Node built-in', () => {
    for (const [name, source] of SOURCES) {
      const specifiers = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      for (const spec of specifiers.filter((s) => s.startsWith('@qa/')))
        expect(spec, name).toBe('@qa/types/src/browser.js');
      expect(
        specifiers.some((s) => s.startsWith('node:')),
        name
      ).toBe(false);
    }
  });

  it('links to other screens by path, never by importing them', () => {
    for (const [name, source] of SOURCES) {
      expect(source, name).not.toMatch(
        /from '\.\/(PreviewShareScreen|HelpersScreen|HelperSignInScreen|share-api|helper-api)'/
      );
    }
  });

  it('uses none of the Avoid words of Website Audit and Shortlist', () => {
    for (const [name, source] of SOURCES) {
      expect(source, name).not.toMatch(
        /\b(scan|scans|scanning|project|projects|leads|pipeline|CRM|prospect list|teardown|site review)\b/i
      );
    }
  });
});
