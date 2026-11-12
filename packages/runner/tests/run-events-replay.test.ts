import { describe, it, expect } from 'vitest';
import { DefaultRunEvents, MAX_RUN_EVENTS, isResumable } from '../src/session/run-events.js';

describe('run event replay by id (LAT-10)', () => {
  it('gives each published event an increasing id, and since() returns the later ones in order', () => {
    const events = new DefaultRunEvents();
    const a = { type: 'A' };
    const b = { type: 'B' };
    const c = { type: 'C' };
    expect(events.publish(a)).toBe(1);
    expect(events.publish(b)).toBe(2);
    expect(events.publish(c)).toBe(3);
    expect(events.lastId).toBe(3);
    expect(events.idOf(b)).toBe(2);

    expect(events.since(0).map((e) => e.id)).toEqual([1, 2, 3]);
    expect(events.since(1)).toEqual([
      { id: 2, event: b },
      { id: 3, event: c },
    ]);
    expect(events.since(3)).toEqual([]);
  });

  it('keeps counting across clear(), so ids never repeat in one process', () => {
    const events = new DefaultRunEvents();
    events.publish({ type: 'OLD' });
    events.publish({ type: 'OLD' });
    events.clear();
    expect(events.log.length).toBe(0);
    expect(events.since(0)).toEqual([]);

    const fresh = { type: 'NEW' };
    expect(events.publish(fresh)).toBe(3);
    expect(events.since(2)).toEqual([{ id: 3, event: fresh }]);
  });

  it('after a cap overflow, replays what remains in order when the id is too old', () => {
    const events = new DefaultRunEvents();
    const total = MAX_RUN_EVENTS + 50;
    for (let i = 1; i <= total; i++) events.publish({ type: 'STEP', n: i });

    const oldest = total - MAX_RUN_EVENTS + 1; // id of the oldest retained event
    const all = events.since(0);
    expect(all.length).toBe(MAX_RUN_EVENTS);
    expect(all[0]).toEqual({ id: oldest, event: { type: 'STEP', n: oldest } });
    expect(all.at(-1)).toEqual({ id: total, event: { type: 'STEP', n: total } });

    // An id from before the cap: only the remaining events come back, still ascending.
    const stale = events.since(10);
    expect(stale.map((e) => e.id)).toEqual(all.map((e) => e.id));
    for (let i = 1; i < stale.length; i++) expect(stale[i].id).toBeGreaterThan(stale[i - 1].id);
  });

  it('resuming from the middle yields exactly the tail, ascending, with no duplicates', () => {
    const events = new DefaultRunEvents();
    for (let i = 1; i <= 20; i++) events.publish({ type: 'STEP', n: i });
    const tail = events.since(12).map((e) => e.id);
    expect(tail).toEqual([13, 14, 15, 16, 17, 18, 19, 20]);
    expect(new Set(tail).size).toBe(tail.length);
  });

  it('firstId is the oldest retained id: null before any event, the cap edge after overflow, null after clear()', () => {
    const events = new DefaultRunEvents();
    expect(events.firstId).toBeNull();
    events.publish({ type: 'A' });
    expect(events.firstId).toBe(1);
    for (let i = 0; i < MAX_RUN_EVENTS; i++) events.publish({ type: 'STEP', n: i });
    expect(events.firstId).toBe(2);
    events.clear();
    expect(events.firstId).toBeNull();
  });

  it('isResumable: only an id this process issued, with no gap before the oldest retained event', () => {
    const events = new DefaultRunEvents();
    expect(isResumable(events, 0)).toBe(true); // nothing published yet: nothing to miss
    for (let i = 1; i <= MAX_RUN_EVENTS + 50; i++) events.publish({ type: 'STEP', n: i });
    const firstId = events.firstId as number;
    const head = events.lastId;

    expect(isResumable(events, null)).toBe(false);
    expect(isResumable(events, head)).toBe(true);
    expect(isResumable(events, head + 1)).toBe(false); // a restarted runner's larger id
    expect(isResumable(events, firstId - 2)).toBe(false); // truncated: ids firstId-1 fell off the cap
    expect(isResumable(events, firstId - 1)).toBe(true); // nothing missing
    expect(isResumable(events, firstId)).toBe(true);
  });

  it('isResumable: an empty log resumes from any id this process issued', () => {
    const events = new DefaultRunEvents();
    events.publish({ type: 'A' });
    events.publish({ type: 'B' });
    events.clear();
    expect(isResumable(events, 2)).toBe(true);
    expect(isResumable(events, 3)).toBe(false);
  });

  it('idOf() is undefined for an object that was never published', () => {
    const events = new DefaultRunEvents();
    expect(events.idOf({ type: 'X' })).toBeUndefined();
  });
});
