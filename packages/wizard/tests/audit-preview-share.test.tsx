import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AUDIT_API, SHARE_LINK_DAYS, type AuditVersion, type ShareLink } from '@qa/types/src/browser.js';
import {
  PreviewShareScreen,
  PreviewShareView,
  type PreviewShareViewProps,
} from '../src/screens/audit/saved/PreviewShareScreen';
import {
  NO_AI_KEY_MESSAGE,
  SHARED_LINK_WARNING,
  createPreview,
  createSharedLink,
  expiryText,
  linkState,
  listSharedLinks,
  previewUrl,
  revokeAfterConfirm,
  revokeSharedLink,
  sharedLinkAddress,
  withLink,
  type Fetch,
} from '../src/screens/audit/saved/share-api';

// ---------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------

const AUDIT_ID = 'abcd1234';
const LINK_ID = 'AbCdEfGhIjKlMnOpQrStUv12';
const ORIGIN = 'https://qa.example.com';
const NOW = new Date('2026-11-03T10:00:00Z');

const link: ShareLink = {
  id: LINK_ID,
  auditId: AUDIT_ID,
  version: 2,
  kind: 'pitch',
  language: 'ta',
  createdAt: '2026-11-03T09:00:00Z',
  expiresAt: '2026-12-03T09:00:00Z',
  revokedAt: null,
};

const previewLink: ShareLink = {
  ...link,
  id: 'ZyXwVuTsRqPoNmLkJiHgFe98',
  kind: 'preview',
  language: 'en',
  createdAt: '2026-10-01T09:00:00Z',
  expiresAt: '2026-10-31T09:00:00Z',
};

const revokedLink: ShareLink = { ...link, id: 'RevokedRevokedRevoked123', revokedAt: '2026-11-03T09:30:00Z' };

const versions = [
  { auditId: AUDIT_ID, version: 1, status: 'done', startedAt: '2026-10-01T08:00:00Z' },
  { auditId: AUDIT_ID, version: 2, status: 'done', startedAt: '2026-11-03T08:00:00Z' },
] as unknown as AuditVersion[];

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** A fetch stand-in: each reply in turn, and every call recorded. */
function fakeFetch(...replies: Array<{ status: number; body: unknown }>): { fetchImpl: Fetch; calls: Call[] } {
  const calls: Call[] = [];
  let next = 0;
  const fetchImpl: Fetch = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const reply = replies[Math.min(next++, replies.length - 1)]!;
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetchImpl, calls };
}

function viewProps(over: Partial<PreviewShareViewProps> = {}): PreviewShareViewProps {
  return {
    auditId: AUDIT_ID,
    versions,
    version: 2,
    previewLanguage: 'en',
    preview: { status: 'idle' },
    kind: 'pitch',
    shareLanguage: 'en',
    created: null,
    copied: 'idle',
    links: { status: 'loaded', links: [link, revokedLink, previewLink] },
    busy: false,
    message: null,
    origin: ORIGIN,
    now: NOW,
    onVersion: () => undefined,
    onPreviewLanguage: () => undefined,
    onMakePreview: () => undefined,
    onKind: () => undefined,
    onShareLanguage: () => undefined,
    onCreateLink: () => undefined,
    onCopy: () => undefined,
    onRevoke: () => undefined,
    ...over,
  };
}

function render(over: Partial<PreviewShareViewProps> = {}): string {
  return renderToStaticMarkup(createElement(PreviewShareView, viewProps(over)));
}

/** The visible text of some markup: tags removed. */
function textOf(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');
}

const BANNED_SHARE_WORDS = /public link|permalink|share url|published report/i;

// ---------------------------------------------------------------------------------------------------
// The preview
// ---------------------------------------------------------------------------------------------------

describe('Improved homepage preview', () => {
  it('Make preview posts AUDIT_API.createPreview with the chosen version and language', async () => {
    const fake = fakeFetch({
      status: 200,
      body: { preview: { version: 2, language: 'ta', createdAt: '2026-11-03T10:00:00Z' } },
    });
    const outcome = await createPreview(AUDIT_ID, 2, 'ta', fake.fetchImpl);
    expect(outcome).toEqual({ ok: true, value: { version: 2, language: 'ta', createdAt: '2026-11-03T10:00:00Z' } });
    expect(fake.calls).toEqual([
      {
        url: `/api/audits/${AUDIT_ID}/preview`,
        method: AUDIT_API.createPreview.method,
        body: { version: 2, language: 'ta' },
      },
    ]);
  });

  it('shows ERR_NO_AI_KEY as "an AI key is needed" with a link to the AI key settings', async () => {
    const fake = fakeFetch({ status: 409, body: { error: 'No key: provider config missing', code: 'ERR_NO_AI_KEY' } });
    const outcome = await createPreview(AUDIT_ID, 2, 'en', fake.fetchImpl);
    expect(outcome).toEqual({ ok: false, message: NO_AI_KEY_MESSAGE, code: 'ERR_NO_AI_KEY' });
    if (outcome.ok) return;
    expect(outcome.message).not.toMatch(/409|provider config/);

    const html = render({ preview: { status: 'failed', message: outcome.message, noAiKey: true } });
    expect(html).toContain('role="alert"');
    expect(textOf(html)).toMatch(/An AI key is needed/);
    expect(html).toMatch(/<a [^>]*href="\/settings"[^>]*>Add an AI key in Settings<\/a>/);
  });

  it('shows other refusals as a plain error without the Settings link', () => {
    const html = render({
      preview: {
        status: 'failed',
        message: 'The improved homepage preview could not be made. Try again.',
        noAiKey: false,
      },
    });
    expect(textOf(html)).toContain('could not be made');
    expect(html).not.toContain('href="/settings"');
  });

  it('Open preview opens GET /api/audits/:id/preview?version=n in a new tab', () => {
    expect(previewUrl(AUDIT_ID, 3)).toBe(`/api/audits/${AUDIT_ID}/preview?version=3`);
    expect(AUDIT_API.getPreview).toMatchObject({ method: 'GET', path: '/api/audits/:id/preview' });
    // A preview made in an earlier visit can still be opened, so the link is always there, with a hint.
    const idle = render({ version: 1 });
    expect(idle).toMatch(/<a [^>]*>Open preview<\/a>/);
    expect(idle).not.toMatch(/<button[^>]*>Open preview<\/button>/);
    expect(textOf(idle)).toContain('If there isn’t one yet, make it first');
    const html = render({ version: 1, preview: { status: 'made', createdAt: '2026-11-03T10:00:00Z' } });
    const anchor = html.match(/<a [^>]*>Open preview<\/a>/)?.[0] ?? '';
    expect(anchor).toContain(`href="/api/audits/${AUDIT_ID}/preview?version=1"`);
    expect(anchor).toContain('target="_blank"');
    expect(anchor).toContain('rel="noopener noreferrer"');
    expect(anchor).toMatch(/aria-label="Open preview of version 1 \(opens in a new tab\)"/);
  });

  it('says when the preview is ready, and shows a spinner while it is made', () => {
    expect(textOf(render({ preview: { status: 'made', createdAt: '2026-11-03T10:00:00Z' } }))).toMatch(
      /The preview is ready/
    );
    expect(textOf(render({ preview: { status: 'making' } }))).toMatch(/Making the preview/);
  });
});

// ---------------------------------------------------------------------------------------------------
// Shared Links
// ---------------------------------------------------------------------------------------------------

describe('Shared Link calls', () => {
  it('creates a Shared Link to the Pitch Glimpse or the preview, in a language', async () => {
    const fake = fakeFetch({ status: 200, body: { link } });
    expect(await createSharedLink(AUDIT_ID, { version: 2, kind: 'pitch', language: 'ta' }, fake.fetchImpl)).toEqual({
      ok: true,
      value: link,
    });
    expect(fake.calls[0]).toEqual({
      url: `/api/audits/${AUDIT_ID}/share`,
      method: 'POST',
      body: { version: 2, kind: 'pitch', language: 'ta' },
    });

    const preview = fakeFetch({ status: 200, body: { link: previewLink } });
    await createSharedLink(AUDIT_ID, { version: 1, kind: 'preview', language: 'en' }, preview.fetchImpl);
    expect(preview.calls[0]!.body).toEqual({ version: 1, kind: 'preview', language: 'en' });
  });

  it('lists the Shared Links, dropping malformed ones', async () => {
    const fake = fakeFetch({ status: 200, body: { links: [link, { id: 'x' }, revokedLink] } });
    expect(await listSharedLinks(AUDIT_ID, fake.fetchImpl)).toEqual({ ok: true, value: [link, revokedLink] });
    expect(fake.calls[0]).toMatchObject({ url: `/api/audits/${AUDIT_ID}/share`, method: 'GET' });
  });

  it('revokes with DELETE /api/audits/:id/share/:linkId', async () => {
    const fake = fakeFetch({ status: 200, body: { link: revokedLink } });
    expect(await revokeSharedLink(AUDIT_ID, LINK_ID, fake.fetchImpl)).toEqual({ ok: true, value: revokedLink });
    expect(fake.calls[0]).toMatchObject({ url: `/api/audits/${AUDIT_ID}/share/${LINK_ID}`, method: 'DELETE' });
  });

  it('revokes only after confirmation', async () => {
    const cancelled = fakeFetch({ status: 200, body: { link: revokedLink } });
    const ask = vi.fn(async () => false);
    expect(await revokeAfterConfirm(ask, AUDIT_ID, LINK_ID, cancelled.fetchImpl)).toBeNull();
    expect(ask).toHaveBeenCalledOnce();
    expect(cancelled.calls).toEqual([]);

    const confirmed = fakeFetch({ status: 200, body: { link: revokedLink } });
    const outcome = await revokeAfterConfirm(async () => true, AUDIT_ID, LINK_ID, confirmed.fetchImpl);
    expect(outcome).toEqual({ ok: true, value: revokedLink });
    expect(confirmed.calls).toHaveLength(1);
  });

  it('turns refusals and network failures into plain sentences', async () => {
    const gone = fakeFetch({ status: 410, body: { error: 'gone at db row 4', code: 'ERR_LINK_GONE' } });
    const outcome = await revokeSharedLink(AUDIT_ID, LINK_ID, gone.fetchImpl);
    expect(outcome).toMatchObject({ ok: false, code: 'ERR_LINK_GONE' });
    if (!outcome.ok) expect(outcome.message).not.toMatch(/410|db row/);

    const down: Fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const failed = await listSharedLinks(AUDIT_ID, down);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.message).toMatch(/not answering/);
  });
});

describe('Shared Link helpers', () => {
  it('builds the full address from the tool address and the id', () => {
    expect(sharedLinkAddress(ORIGIN, link)).toBe(`${ORIGIN}/s/${LINK_ID}`);
    expect(sharedLinkAddress(`${ORIGIN}/`, link)).toBe(`${ORIGIN}/s/${LINK_ID}`);
  });

  it('tells open, expired and revoked links apart', () => {
    expect(linkState(link, NOW)).toBe('open');
    expect(linkState(previewLink, NOW)).toBe('expired');
    expect(linkState(revokedLink, NOW)).toBe('revoked');
  });

  it('puts a revoked link back in place of the open one, newest first', () => {
    const revoked = { ...link, revokedAt: '2026-11-03T11:00:00Z' };
    expect(withLink([previewLink, link], revoked)).toEqual([revoked, previewLink]);
  });
});

describe('Shared Link screen', () => {
  it('shows the new Shared Link in full with a copy button, its expiry 30 days out and the warning', () => {
    const text = textOf(render({ created: link }));
    const html = render({ created: link });
    expect(html).toMatch(new RegExp(`<input[^>]*value="${ORIGIN}/s/${LINK_ID}"`));
    expect(html).toMatch(/<label for="shared-link-address"[^>]*>Shared Link to the Pitch Glimpse \(Tamil\)<\/label>/);
    expect(html).toMatch(/<button[^>]*>Copy Shared Link<\/button>/);
    expect(SHARE_LINK_DAYS).toBe(30);
    expect(text).toContain(expiryText('3 December 2026'));
    expect(text).toContain('30 days after it was made');
    expect(text).toContain('Anyone holding this Shared Link can open it');
    expect(text).toContain(SHARED_LINK_WARNING);
  });

  it('says whether copying worked', () => {
    expect(textOf(render({ created: link, copied: 'copied' }))).toContain('Copied.');
    expect(textOf(render({ created: link, copied: 'failed' }))).toMatch(/copy it by hand/);
  });

  it('lists each Shared Link with kind, language, created, expires and state', () => {
    const html = render();
    const rows = html.match(/<tr>.*?<\/tr>/g) ?? [];
    expect(textOf(rows[0]!)).toMatch(/Kind Version Language Created Expires State/);
    const open = textOf(rows[1]!);
    expect(open).toMatch(/Pitch Glimpse 2 Tamil 3 Nov 2026, \d\d:\d\d 3 December 2026 Open Revoke/);
    expect(textOf(rows[2]!)).toMatch(/Pitch Glimpse .* Revoked 3 Nov 2026/);
    expect(rows[2]).not.toContain('>Revoke<');
    expect(textOf(rows[3]!)).toMatch(/Improved homepage preview 2 English .* 31 October 2026 Expired/);
    expect(rows[3]).not.toContain('>Revoke<');
  });

  it('gives each Revoke button an accessible name', () => {
    const html = render();
    expect(html).toMatch(
      /<button[^>]*aria-label="Revoke Shared Link: Pitch Glimpse, version 2, Tamil, created [^"]+"[^>]*>Revoke<\/button>/
    );
  });

  it('says when there is no Shared Link yet, and when the list could not load', () => {
    expect(textOf(render({ links: { status: 'loaded', links: [] } }))).toMatch(/No Shared Link has been made/);
    expect(
      render({ links: { status: 'failed', message: 'The Shared Links could not be loaded. Try again.' } })
    ).toMatch(/role="alert"/);
  });

  it('labels every control', () => {
    const html = render({ created: link });
    for (const id of [
      'share-version',
      'preview-language',
      'share-language',
      'share-kind-pitch',
      'share-kind-preview',
      'shared-link-address',
    ]) {
      expect(html, id).toMatch(new RegExp(`<label[^>]*for="${id}"`));
    }
  });

  it('asks for confirmation in the screen before it calls revoke', () => {
    const source = readFileSync(new URL('../src/screens/audit/saved/PreviewShareScreen.tsx', import.meta.url), 'utf8');
    const body = source.slice(source.indexOf('const revoke = useCallback'));
    expect(body.indexOf('revokeAfterConfirm(')).toBeGreaterThan(-1);
    expect(body.indexOf('confirm({')).toBeGreaterThan(body.indexOf('revokeAfterConfirm('));
  });

  it('says when no version has finished', () => {
    expect(textOf(render({ versions: [] }))).toMatch(/no finished version yet/);
  });

  it('shows a spinner while loading', () => {
    const html = renderToStaticMarkup(createElement(PreviewShareScreen, { auditId: AUDIT_ID, origin: ORIGIN }));
    expect(textOf(html)).toMatch(/Preview and Shared Links/);
    expect(textOf(html)).toMatch(/Loading the Website Audit/);
  });
});

// ---------------------------------------------------------------------------------------------------
// Wording and imports
// ---------------------------------------------------------------------------------------------------

describe('Preview and Shared Link wording', () => {
  it('says Shared Link and avoids the banned words', () => {
    const screens = [
      render({ created: link, preview: { status: 'failed', message: NO_AI_KEY_MESSAGE, noAiKey: true } }),
      render({ message: { tone: 'pass', text: 'The Shared Link to the Pitch Glimpse is revoked.' } }),
      renderToStaticMarkup(createElement(PreviewShareScreen, { auditId: AUDIT_ID, origin: ORIGIN })),
    ];
    for (const html of screens) expect(textOf(html)).not.toMatch(BANNED_SHARE_WORDS);
    expect(textOf(screens[0]!)).toContain('Shared Link');
    for (const file of ['PreviewShareScreen.tsx', 'share-api.ts']) {
      const source = readFileSync(new URL(`../src/screens/audit/saved/${file}`, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(BANNED_SHARE_WORDS);
    }
  });

  it('imports @qa/types only through the browser-safe entry', () => {
    for (const file of ['PreviewShareScreen.tsx', 'share-api.ts']) {
      const source = readFileSync(new URL(`../src/screens/audit/saved/${file}`, import.meta.url), 'utf8');
      const specifiers = [...source.matchAll(/from\s+['"](@qa\/types[^'"]*)['"]/g)].map((m) => m[1]);
      expect(specifiers.length, file).toBeGreaterThan(0);
      for (const specifier of specifiers) expect(specifier, file).toBe('@qa/types/src/browser.js');
      expect(source, file).not.toMatch(/from\s+['"]node:/);
    }
  });
});
