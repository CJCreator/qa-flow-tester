import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SHORTLIST_OUTCOMES, type ShortlistEntry, type ShortlistListItem } from '@qa/types/src/browser.js';
import {
  draftFromEntry,
  filterShortlist,
  filtersToQuery,
  listShortlist,
  loadShortlistEntry,
  readMarkFilter,
  readOutcomeFilter,
  saveShortlistEntry,
  shortlistUpdate,
} from '../src/screens/audit/saved/saved-api';
import {
  entryVersion,
  ShortlistPanelView,
  type ShortlistPanelViewProps,
} from '../src/screens/audit/saved/ShortlistPanel';
import { ShortlistView, type ShortlistViewProps } from '../src/screens/audit/saved/ShortlistScreen';

const AUDIT_ID = 'abcd1234';

const entry: ShortlistEntry = {
  auditId: AUDIT_ID,
  mark: 'pitch',
  notes: 'Owner: Ravi, 98400 00000',
  outcome: 'Interested',
  outcomeNote: 'Call back Monday',
  updatedAt: '2026-11-02T09:30:00Z',
};

const items: ShortlistListItem[] = [
  { ...entry, url: 'https://shop.example.org/', host: 'shop.example.org' },
  {
    ...entry,
    auditId: 'bbbb2222',
    mark: 'skip',
    outcome: null,
    notes: '',
    outcomeNote: '',
    url: 'https://b.example/',
    host: 'b.example',
  },
  { ...entry, auditId: 'cccc3333', mark: 'pitch', outcome: 'Won', url: 'https://c.example/', host: 'c.example' },
];

const noop = () => {};

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

function panel(props: Partial<ShortlistPanelViewProps> = {}): string {
  const saved = props.saved === undefined ? entry : props.saved;
  return renderToStaticMarkup(
    createElement(ShortlistPanelView, {
      saved,
      draft: draftFromEntry(saved),
      saving: false,
      message: null,
      onDraft: noop,
      onSave: noop,
      ...props,
    })
  );
}

function list(props: Partial<ShortlistViewProps> = {}): string {
  return renderToStaticMarkup(
    createElement(ShortlistView, {
      filters: { mark: 'all', outcome: 'all' },
      load: { status: 'loaded', items },
      onFilters: noop,
      onRetry: noop,
      ...props,
    })
  );
}

// ---------------------------------------------------------------------------------------------------
// REQ-023 AC-1, AC-2: the panel
// ---------------------------------------------------------------------------------------------------

describe('Shortlist panel (REQ-023)', () => {
  it('labels every control: mark radios, notes, outcome with the six fixed values, outcome note', () => {
    const html = panel();
    expect(html).toContain('<legend class="label text-ink">Mark</legend>');
    for (const [id, label] of [
      ['shortlist-mark-pitch', 'Pitch'],
      ['shortlist-mark-skip', 'Skip'],
      ['shortlist-mark-none', 'No mark'],
      ['shortlist-notes', 'Notes'],
      ['shortlist-outcome', 'Outcome'],
      ['shortlist-outcome-note', 'Outcome note'],
    ]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toMatch(new RegExp(`for="${id}"[^>]*>${label}</label>`));
    }
    const options = [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    expect(options).toEqual(['', ...SHORTLIST_OUTCOMES]);
    expect(SHORTLIST_OUTCOMES).toHaveLength(6);
  });

  it('shows the saved values in the fields and in words', () => {
    const html = panel();
    expect(html).toMatch(/id="shortlist-mark-pitch"[^>]*checked=""/);
    expect(html).toMatch(/<option value="Interested" selected="">/);
    expect(html).toContain('>Owner: Ravi, 98400 00000</textarea>');
    expect(html).toContain('>Call back Monday</textarea>');
    expect(textOf(html)).toMatch(/Saved: Pitch, Interested\. Last changed 2 Nov 2026/);
    expect(textOf(panel({ saved: null }))).toContain('Nothing saved yet.');
  });

  it('enables save only when a field changed', () => {
    expect(panel()).toMatch(/<button[^>]*disabled=""[^>]*>Save the Shortlist entry<\/button>/);
    const changed = panel({ draft: { ...draftFromEntry(entry), mark: 'skip' } });
    expect(changed).not.toMatch(/<button[^>]*disabled=""[^>]*>Save the Shortlist entry<\/button>/);
  });

  it('sends only the changed fields, null to clear a mark or outcome', () => {
    expect(shortlistUpdate(entry, draftFromEntry(entry))).toEqual({});
    expect(
      shortlistUpdate(entry, { ...draftFromEntry(entry), mark: null, outcome: 'Won', outcomeNote: 'Signed' })
    ).toEqual({
      mark: null,
      outcome: 'Won',
      outcomeNote: 'Signed',
    });
    expect(shortlistUpdate(null, { mark: 'skip', notes: 'n', outcome: null, outcomeNote: '' })).toEqual({
      mark: 'skip',
      notes: 'n',
    });
  });

  it('saves through PUT /api/audits/:id/shortlist and returns the saved entry', async () => {
    const saved = { ...entry, mark: 'skip' as const, outcome: 'Opted out' as const };
    const { impl, calls } = fakeFetch({ status: 200, body: { entry: saved } });
    const outcome = await saveShortlistEntry(AUDIT_ID, { mark: 'skip', outcome: 'Opted out' }, impl);
    expect(calls[0].url).toBe(`/api/audits/${AUDIT_ID}/shortlist`);
    expect(calls[0].init?.method).toBe('PUT');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ mark: 'skip', outcome: 'Opted out' });
    expect(outcome).toEqual({ ok: true, value: saved });

    const html = panel({ saved, message: { tone: 'pass', text: 'Shortlist entry saved.' } });
    expect(textOf(html)).toContain('Saved: Skip, Opted out.');
    expect(html).toContain('role="status"');
  });

  it('shows a refusal as a plain message', async () => {
    const { impl } = fakeFetch({
      status: 400,
      body: { error: 'The outcome is not one of the fixed values.', code: 'ERR_INVALID_REQUEST' },
    });
    const outcome = await saveShortlistEntry(AUDIT_ID, { notes: 'x' }, impl);
    expect(outcome).toEqual({
      ok: false,
      code: 'ERR_INVALID_REQUEST',
      message: 'The outcome is not one of the fixed values.',
    });
    expect(panel({ message: { tone: 'fail', text: 'No.' } })).toContain('role="alert"');
  });

  it('loads the entry through GET /api/audits/:id/shortlist', async () => {
    const { impl, calls } = fakeFetch({ status: 200, body: { entry } });
    expect(await loadShortlistEntry(AUDIT_ID, impl)).toEqual({ ok: true, value: entry });
    expect(calls[0]).toMatchObject({ url: `/api/audits/${AUDIT_ID}/shortlist`, init: { method: 'GET' } });
  });
});

// ---------------------------------------------------------------------------------------------------
// REQ-023 AC-3: the screen and its filters
// ---------------------------------------------------------------------------------------------------

describe('Shortlist screen filters (REQ-023 AC-3)', () => {
  it('turns filters into the query and reads select values safely', () => {
    expect(filtersToQuery({ mark: 'all', outcome: 'all' })).toEqual({});
    expect(filtersToQuery({ mark: 'pitch', outcome: 'Meeting set' })).toEqual({
      mark: 'pitch',
      outcome: 'Meeting set',
    });
    expect(readMarkFilter('skip')).toBe('skip');
    expect(readMarkFilter('other')).toBe('all');
    expect(readOutcomeFilter('Lost')).toBe('Lost');
    expect(readOutcomeFilter('lost')).toBe('all');
  });

  it('lists through GET /api/shortlist with mark and outcome', async () => {
    const { impl, calls } = fakeFetch(
      { status: 200, body: { entries: [items[2]] } },
      { status: 200, body: { entries: items } }
    );
    expect(await listShortlist({ mark: 'pitch', outcome: 'Won' }, impl)).toEqual({ ok: true, value: [items[2]] });
    expect(calls[0].url).toBe('/api/shortlist?mark=pitch&outcome=Won');
    await listShortlist({}, impl);
    expect(calls[1].url).toBe('/api/shortlist');
  });

  it('filters by mark and by outcome', () => {
    expect(filterShortlist(items, { mark: 'pitch', outcome: 'all' }).map((i) => i.auditId)).toEqual([
      AUDIT_ID,
      'cccc3333',
    ]);
    expect(filterShortlist(items, { mark: 'all', outcome: 'Won' }).map((i) => i.auditId)).toEqual(['cccc3333']);
    expect(filterShortlist(items, { mark: 'skip', outcome: 'Won' })).toEqual([]);

    const html = list({ filters: { mark: 'pitch', outcome: 'all' } });
    expect(html).toContain(`data-audit="${AUDIT_ID}"`);
    expect(html).toContain('data-audit="cccc3333"');
    expect(html).not.toContain('data-audit="bbbb2222"');
    expect(html).toMatch(/<option value="pitch" selected="">Pitch<\/option>/);
  });

  it('labels both filters and offers every mark and outcome', () => {
    const html = list();
    expect(html).toMatch(/for="shortlist-filter-mark"[^>]*>Mark<\/label>/);
    expect(html).toMatch(/for="shortlist-filter-outcome"[^>]*>Outcome<\/label>/);
    for (const outcome of SHORTLIST_OUTCOMES) expect(html).toContain(`<option value="${outcome}">${outcome}</option>`);
  });

  it('shows mark, outcome and notes in words, and links each to its Website Audit', () => {
    const html = list();
    const first = textOf(html.slice(html.indexOf(`data-audit="${AUDIT_ID}"`), html.indexOf('data-audit="bbbb2222"')));
    expect(first).toContain('Mark: Pitch · Outcome: Interested');
    expect(first).toContain('Notes: Owner: Ravi, 98400 00000');
    expect(first).toContain('Outcome note: Call back Monday');
    expect(textOf(html)).toContain('Mark: Skip · Outcome: none yet');
    expect(html).toContain(`href="/audits/${AUDIT_ID}"`);
    expect(html).toContain('aria-label="Open the Website Audit of shop.example.org"');
    // The whole row is the link; no primary button per row.
    expect(html).not.toContain('btn-primary');
  });

  it('gives the mark radios and the filters 44px rows', () => {
    expect(panel()).toMatch(/<span class="[^"]*min-h-\[44px\][^"]*"><input id="shortlist-mark-pitch"/);
    expect(list()).toMatch(/id="shortlist-filter-mark" class="[^"]*min-h-\[44px\]/);
  });

  it('says why the list is empty: nothing on it, or nothing matching', () => {
    expect(textOf(list({ load: { status: 'loaded', items: [] } }))).toContain('The Shortlist is empty.');
    expect(textOf(list({ filters: { mark: 'skip', outcome: 'Won' } }))).toContain(
      'No Website Audit on the Shortlist matches these filters.'
    );
    expect(list({ load: { status: 'failed', message: 'Down.' } })).toContain('role="alert"');
    expect(list({ load: { status: 'loading' } })).toContain('role="status"');
  });
});

describe('entryVersion', () => {
  const entry = {
    auditId: 'a1',
    mark: null,
    notes: 'x',
    outcome: null,
    outcomeNote: '',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
  it('is the same for two copies of one saved entry', () => {
    expect(entryVersion({ ...entry })).toBe(entryVersion({ ...entry }));
  });
  it('changes when the entry is saved again', () => {
    expect(entryVersion({ ...entry, updatedAt: '2026-11-02T00:00:00.000Z' })).not.toBe(entryVersion(entry));
  });
  it('is null without an entry', () => {
    expect(entryVersion(null)).toBeNull();
  });
});
