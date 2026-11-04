import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { AuditRequest } from '@qa/types';
import {
  AuditRecordError,
  AuditStore,
  LocalAuditStoreBackend,
  MAX_SHORTLIST_NOTES_CHARS,
  MAX_SHORTLIST_OUTCOME_NOTE_CHARS,
} from '../src/audit/store/index.js';

const REQUEST: AuditRequest = {
  url: 'https://bakery.example/',
  limits: { maxPages: 10, maxDepth: 2, includePaths: [], excludePaths: [] },
  language: 'en',
};

let dir: string;
let store: AuditStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-shortlist-'));
  store = new AuditStore(new LocalAuditStoreBackend(dir), { now: () => new Date('2026-11-03T09:00:00.000Z') });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Shortlist (REQ-023)', () => {
  it('AC-1: an entry is saved with its audit and shown in its summary', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    expect(await store.getShortlist(auditId)).toBeNull();
    const entry = await store.putShortlist(auditId, { mark: 'pitch', notes: 'Family bakery, old site' });
    expect(entry).toEqual({
      auditId,
      mark: 'pitch',
      notes: 'Family bakery, old site',
      outcome: null,
      outcomeNote: '',
      updatedAt: '2026-11-03T09:00:00.000Z',
    });
    const reopened = new AuditStore(new LocalAuditStoreBackend(dir));
    expect((await reopened.getAudit(auditId))!.shortlist).toEqual(entry);
  });

  it('AC-2: only sent fields change; null clears the mark or the outcome', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    await store.putShortlist(auditId, { mark: 'pitch', notes: 'n1' });
    let entry = await store.putShortlist(auditId, { outcome: 'Meeting set', outcomeNote: 'Tuesday 4pm' });
    expect(entry).toMatchObject({ mark: 'pitch', notes: 'n1', outcome: 'Meeting set', outcomeNote: 'Tuesday 4pm' });
    entry = await store.putShortlist(auditId, { mark: null });
    expect(entry).toMatchObject({ mark: null, notes: 'n1', outcome: 'Meeting set' });
    entry = await store.putShortlist(auditId, { outcome: null });
    expect(entry).toMatchObject({ mark: null, notes: 'n1', outcome: null, outcomeNote: 'Tuesday 4pm' });
    entry = await store.putShortlist(auditId, { mark: 'skip' });
    expect(entry.mark).toBe('skip');
  });

  it('refuses a bad mark or outcome and over-long notes', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    const bad = [
      { mark: 'maybe' },
      { outcome: 'Pending' },
      { outcome: 'won' },
      { notes: 5 },
      { notes: 'x'.repeat(MAX_SHORTLIST_NOTES_CHARS + 1) },
      { outcomeNote: 'x'.repeat(MAX_SHORTLIST_OUTCOME_NOTE_CHARS + 1) },
    ];
    for (const update of bad) {
      await expect(store.putShortlist(auditId, update as never)).rejects.toThrow(AuditRecordError);
    }
    await expect(store.putShortlist(auditId, null as never)).rejects.toThrow(AuditRecordError);
    expect(await store.getShortlist(auditId)).toBeNull();
    // Exactly at the cap is accepted.
    const ok = await store.putShortlist(auditId, {
      notes: 'x'.repeat(MAX_SHORTLIST_NOTES_CHARS),
      outcomeNote: 'y'.repeat(MAX_SHORTLIST_OUTCOME_NOTE_CHARS),
    });
    expect(ok.notes).toHaveLength(MAX_SHORTLIST_NOTES_CHARS);
  });

  it('refuses an entry for an audit that does not exist', async () => {
    await expect(store.putShortlist('abcdefgh12', { mark: 'pitch' })).rejects.toMatchObject({ code: 'not-found' });
  });

  it('AC-3: lists entries filtered by mark and by outcome, with the audit address', async () => {
    const a = await store.createAudit(REQUEST);
    const b = await store.createAudit({ ...REQUEST, url: 'https://tailor.example/' });
    const c = await store.createAudit({ ...REQUEST, url: 'https://clinic.example/' });
    await store.createAudit({ ...REQUEST, url: 'https://none.example/' });
    await store.putShortlist(a.auditId, { mark: 'pitch', outcome: 'Won' });
    await store.putShortlist(b.auditId, { mark: 'pitch', outcome: 'No reply' });
    await store.putShortlist(c.auditId, { mark: 'skip' });

    const all = await store.listShortlist();
    expect(all.map((e) => e.auditId).sort()).toEqual([a.auditId, b.auditId, c.auditId].sort());
    const pitch = await store.listShortlist({ mark: 'pitch' });
    expect(pitch.map((e) => e.host).sort()).toEqual(['bakery.example', 'tailor.example']);
    const won = await store.listShortlist({ outcome: 'Won' });
    expect(won).toHaveLength(1);
    expect(won[0]).toMatchObject({ auditId: a.auditId, url: REQUEST.url, host: 'bakery.example' });
    expect((await store.listShortlist({ outcome: null })).map((e) => e.auditId)).toEqual([c.auditId]);
    expect(await store.listShortlist({ mark: 'skip', outcome: 'Won' })).toEqual([]);
    await expect(store.listShortlist({ mark: 'maybe' as never })).rejects.toThrow(AuditRecordError);
  });
});
