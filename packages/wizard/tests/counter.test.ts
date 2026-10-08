import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COUNTER_EVENTS,
  counterEndpoint,
  resetCounterOnce,
  sendCounterEvent,
  sendCounterEventOnce,
} from '../src/lib/counter';

const EP = 'https://x.goatcounter.com/count';
const ALL = Object.values(COUNTER_EVENTS);

afterEach(() => {
  vi.unstubAllGlobals();
  resetCounterOnce();
});

describe('counterEndpoint', () => {
  it('rejects unset and unsafe values', () => {
    for (const bad of [
      undefined,
      '',
      '  ',
      'not a url',
      'http://x.goatcounter.com/count',
      'javascript:alert(1)',
      'https://u:p@x.com/count',
    ]) {
      expect(counterEndpoint(bad)).toBeNull();
    }
  });
  it('normalises a good endpoint and allows http only for localhost', () => {
    expect(counterEndpoint(`${EP}?a=1#b`)).toBe(EP);
    expect(counterEndpoint('http://localhost:8080/count')).toBe('http://localhost:8080/count');
  });
});

describe('sendCounterEvent', () => {
  it('sends nothing when the endpoint is unset', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const send = vi.fn();
    for (const e of ALL) expect(sendCounterEvent(e, { endpoint: null, send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('sends one named event each', () => {
    for (const e of ALL) {
      const send = vi.fn();
      expect(sendCounterEvent(e, { endpoint: EP, send, dnt: false })).toBe(true);
      expect(send).toHaveBeenCalledTimes(1);
      const url = send.mock.calls[0][0] as string;
      expect(url).toContain(`p=${e}`);
      expect(url).toContain('e=true');
    }
  });
  it('respects Do Not Track / Global Privacy Control', () => {
    const send = vi.fn();
    expect(sendCounterEvent(COUNTER_EVENTS.landingView, { endpoint: EP, send, dnt: true })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it('event URL carries nothing but the event name', () => {
    const send = vi.fn();
    sendCounterEvent(COUNTER_EVENTS.completedCheckup, { endpoint: EP, send, dnt: false });
    expect(send).toHaveBeenCalledWith(`${EP}?p=completed-checkup&e=true&t=completed-checkup`);
  });
  it('landing-view fires once per load', () => {
    const send = vi.fn();
    const o = { endpoint: EP, send, dnt: false };
    sendCounterEventOnce(COUNTER_EVENTS.landingView, o);
    sendCounterEventOnce(COUNTER_EVENTS.landingView, o);
    expect(send).toHaveBeenCalledTimes(1);
    resetCounterOnce();
    sendCounterEventOnce(COUNTER_EVENTS.landingView, o);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('no cookies or storage', () => {
  it('default sender uses keepalive, no credentials, no referrer', () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchSpy);
    expect(() => sendCounterEvent(COUNTER_EVENTS.startCheckup, { endpoint: EP, dnt: false })).not.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      keepalive: true,
      mode: 'no-cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  });
  it('counter.ts writes no storage and imports nothing Node-only', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'lib', 'counter.ts'), 'utf8');
    expect(src).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB|node:|from 'fs'|from 'path'/);
  });
});
