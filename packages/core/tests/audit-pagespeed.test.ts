/**
 * BE-404 (REQ-012, REQ-043, ADR 0035): PageSpeed Insights client for Sample Pages. Recorded PSI JSON fixtures and a
 * fake network (lookup + connect) behind makeOutboundFetch; no real request is made.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { PageSpeed, SpeedValue } from '@qa/types';
import {
  measurePageSpeed,
  measureSampleSpeeds,
  mapPsiResponse,
  PSI_ENDPOINT,
  type PageSpeedDeps,
} from '../src/audit/ai/pagespeed.js';
import type { NetDeps, PinnedRequest, RawResponse } from '../src/safe-net.js';
import { setBrowserPolicy } from '../src/browser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(path.join(here, 'fixtures', 'pagespeed', name), 'utf8');

const FAKE_KEY = 'AIzaFAKE-not-a-real-key-0123456789';
const PSI_HOST = 'www.googleapis.com';
const NOW = new Date('2026-11-03T00:00:00.000Z');

type Answer = RawResponse | Error | ((req: PinnedRequest) => RawResponse | Error);

function fakeNet(answers: Answer[], dns: Record<string, string[]> = { [PSI_HOST]: ['142.250.183.10'] }) {
  const connects: PinnedRequest[] = [];
  const lookups: string[] = [];
  const net: NetDeps = {
    async lookup(host) {
      lookups.push(host);
      const found = dns[host];
      if (!found) throw new Error('getaddrinfo ENOTFOUND');
      return found;
    },
    async connect(req) {
      connects.push(req);
      const next = answers.shift();
      if (!next) throw new Error('no more answers');
      const a = typeof next === 'function' ? next(req) : next;
      if (a instanceof Error) throw a;
      return a;
    },
  };
  return { net, connects, lookups };
}

const json = (name: string, status = 200): RawResponse => ({
  status,
  headers: { 'content-type': 'application/json; charset=UTF-8' },
  body: fixture(name),
});

function deps(net: NetDeps, extra: Partial<PageSpeedDeps> = {}): PageSpeedDeps & { lines: string[] } {
  const lines: string[] = [];
  return { net, now: () => NOW, log: (l) => lines.push(l), lines, ...extra };
}

const withKey = { resolveServiceKey: async () => ({ apiKey: FAKE_KEY }) };
const byMetric = (values: SpeedValue[]) => Object.fromEntries(values.map((v) => [v.metric, [v.value, v.unit]]));

function expectNotMeasured(speed: PageSpeed, reason: string, fieldReason = reason) {
  expect(speed.lab).toEqual({ status: 'not-measured', source: 'pagespeed-insights', method: 'lab', reason });
  expect(speed.field).toEqual({
    status: 'not-measured',
    source: 'pagespeed-insights',
    method: 'field',
    reason: fieldReason,
  });
  expect('values' in speed.lab).toBe(false);
  expect('values' in speed.field).toBe(false);
}

afterEach(() => setBrowserPolicy(null));

describe('measurePageSpeed: request', () => {
  it('REQ-043 AC-1: calls only the PSI v5 endpoint on googleapis.com, mobile, performance; page URL only as a parameter', async () => {
    const f = fakeNet([json('page-field.json')]);
    await measurePageSpeed('https://shop.example.in/?q=1&x=2', deps(f.net));
    expect(f.lookups).toEqual([PSI_HOST]);
    expect(f.connects).toHaveLength(1);
    const u = f.connects[0].url;
    expect(`${u.origin}${u.pathname}`).toBe(PSI_ENDPOINT);
    expect(u.searchParams.get('url')).toBe('https://shop.example.in/?q=1&x=2');
    expect(u.searchParams.get('strategy')).toBe('mobile');
    expect(u.searchParams.get('category')).toBe('performance');
    expect(f.connects[0].address).toBe('142.250.183.10');
  });

  it('without a key the request is keyless (free tier); with a key it goes in a header, never the address', async () => {
    const keyless = fakeNet([json('page-field.json')]);
    await measurePageSpeed('https://shop.example.in/', deps(keyless.net));
    expect(keyless.connects[0].url.searchParams.has('key')).toBe(false);
    expect(Object.keys(keyless.connects[0].headers).map((h) => h.toLowerCase())).not.toContain('x-goog-api-key');

    const keyed = fakeNet([json('page-field.json')]);
    await measurePageSpeed('https://shop.example.in/', deps(keyed.net, withKey));
    expect(keyed.connects[0].headers['x-goog-api-key']).toBe(FAKE_KEY);
    expect(keyed.connects[0].url.toString()).not.toContain(FAKE_KEY);
  });

  it('a resolver that returns null or throws gives a keyless request', async () => {
    for (const resolveServiceKey of [async () => null, async () => Promise.reject(new Error(`bad ${FAKE_KEY}`))]) {
      const f = fakeNet([json('page-field.json')]);
      const d = deps(f.net, { resolveServiceKey });
      const speed = await measurePageSpeed('https://shop.example.in/', d);
      expect(speed.lab.status).toBe('measured');
      expect(f.connects[0].headers['x-goog-api-key']).toBeUndefined();
      expect(d.lines.join('\n')).not.toContain(FAKE_KEY);
    }
  });

  it('never connects when googleapis.com resolves to a private address, even on a local run', async () => {
    const f = fakeNet([json('page-field.json')], { [PSI_HOST]: ['127.0.0.1'] });
    const speed = await measurePageSpeed('https://shop.example.in/', deps(f.net, withKey));
    expect(f.connects).toHaveLength(0);
    expectNotMeasured(speed, 'failed');
  });

  it('a page address that is not http(s) is not sent', async () => {
    const f = fakeNet([json('page-field.json')]);
    expectNotMeasured(await measurePageSpeed('file:///etc/passwd', deps(f.net)), 'failed');
    expectNotMeasured(await measurePageSpeed('not a url', deps(f.net)), 'failed');
    expect(f.lookups).toHaveLength(0);
  });
});

describe('measurePageSpeed: mapping (REQ-012 AC-1)', () => {
  it('maps lab values from lighthouseResult and page-scope field values from loadingExperience, naming source and method', async () => {
    const f = fakeNet([json('page-field.json')]);
    const speed = await measurePageSpeed('https://shop.example.in/', deps(f.net));
    expect(speed.lab).toMatchObject({
      status: 'measured',
      source: 'pagespeed-insights',
      method: 'lab',
      strategy: 'mobile',
      measuredAt: '2026-11-02T09:15:04.120Z',
    });
    if (speed.lab.status !== 'measured') throw new Error('lab not measured');
    expect(byMetric(speed.lab.values)).toEqual({
      'performance-score': [47, 'score'],
      lcp: [5433, 'ms'],
      cls: [0.104, 'none'],
      fcp: [2911, 'ms'],
      ttfb: [413, 'ms'],
      tbt: [389, 'ms'],
      'speed-index': [6012, 'ms'],
    });
    expect(speed.field).toMatchObject({
      status: 'measured',
      source: 'pagespeed-insights',
      method: 'field',
      strategy: 'mobile',
      scope: 'page',
      measuredAt: '2026-11-02T09:15:04.120Z',
    });
    if (speed.field.status !== 'measured') throw new Error('field not measured');
    // PSI gives the CLS percentile times 100.
    expect(byMetric(speed.field.values)).toEqual({
      lcp: [3120, 'ms'],
      inp: [231, 'ms'],
      cls: [0.12, 'none'],
      fcp: [2104, 'ms'],
      ttfb: [1310, 'ms'],
    });
  });

  it('uses origin data with scope origin when the page has too few visitors (origin_fallback)', async () => {
    const f = fakeNet([json('origin-fallback.json')]);
    const speed = await measurePageSpeed('https://shop.example.in/contact', deps(f.net));
    expect(speed.field).toMatchObject({ status: 'measured', method: 'field', scope: 'origin' });
    if (speed.field.status !== 'measured') throw new Error('field not measured');
    expect(byMetric(speed.field.values)).toEqual({ lcp: [2800, 'ms'], inp: [180, 'ms'], cls: [0.05, 'none'] });
    expect(speed.lab.status).toBe('measured');
  });

  it('field without page or origin data is not-measured no-field-data; lab is still measured', async () => {
    const f = fakeNet([json('no-field-data.json')]);
    const speed = await measurePageSpeed('https://small-clinic.example.in/', deps(f.net));
    expect(speed.lab.status).toBe('measured');
    expect(speed.field).toEqual({
      status: 'not-measured',
      source: 'pagespeed-insights',
      method: 'field',
      reason: 'no-field-data',
    });
  });

  it('uses the clock when the answer has no timestamp; a Lighthouse runtime error gives lab failed', () => {
    const body = JSON.parse(fixture('page-field.json'));
    delete body.analysisUTCTimestamp;
    delete body.lighthouseResult.fetchTime;
    body.lighthouseResult.runtimeError = { code: 'NO_FCP', message: 'The page did not paint any content.' };
    const speed = mapPsiResponse(body, () => NOW);
    expect(speed.lab).toEqual({
      status: 'not-measured',
      source: 'pagespeed-insights',
      method: 'lab',
      reason: 'failed',
    });
    expect(speed.field).toMatchObject({ status: 'measured', measuredAt: NOW.toISOString() });
  });
});

describe('measurePageSpeed: failures carry no values (REQ-012 AC-2)', () => {
  it('HTTP 429 is quota', async () => {
    const f = fakeNet([json('quota-429.json', 429)]);
    expectNotMeasured(await measurePageSpeed('https://shop.example.in/', deps(f.net)), 'quota');
  });

  it('a 403 daily limit error is quota', async () => {
    const f = fakeNet([json('quota-403-daily.json', 403)]);
    expectNotMeasured(await measurePageSpeed('https://shop.example.in/', deps(f.net)), 'quota');
  });

  it('a Lighthouse 500 error and a bad key 400 are failed', async () => {
    const f = fakeNet([json('lighthouse-error-500.json', 500), json('bad-key-400.json', 400)]);
    expectNotMeasured(await measurePageSpeed('https://shop.example.in/', deps(f.net)), 'failed');
    expectNotMeasured(await measurePageSpeed('https://shop.example.in/', deps(f.net, withKey)), 'failed');
  });

  it('a connection timeout is timeout', async () => {
    const f = fakeNet([new Error('timeout')]);
    expectNotMeasured(await measurePageSpeed('https://shop.example.in/', deps(f.net)), 'timeout');
  });

  it('a DNS failure or refused connection is no-network', async () => {
    const dnsDown = fakeNet([], {});
    expectNotMeasured(await measurePageSpeed('https://shop.example.in/', deps(dnsDown.net)), 'no-network');
    const refused = fakeNet([new Error('connect ECONNREFUSED')]);
    expectNotMeasured(await measurePageSpeed('https://shop.example.in/', deps(refused.net)), 'no-network');
  });

  it('a body that is not JSON, a redirect or an over-size answer is failed', async () => {
    const f = fakeNet([
      { status: 200, headers: {}, body: '<html>captcha</html>' },
      { status: 302, headers: { location: 'https://evil.example/' }, body: '' },
      { status: 200, headers: {}, body: '', tooLarge: true },
    ]);
    for (let i = 0; i < 3; i++) {
      expectNotMeasured(await measurePageSpeed('https://shop.example.in/', deps(f.net)), 'failed');
    }
    expect(f.connects).toHaveLength(3);
  });
});

describe('measureSampleSpeeds', () => {
  it('asks one page at a time, in order, resolving the key once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let keyCalls = 0;
    const slow = (name: string) => (): RawResponse => json(name);
    const f = fakeNet([slow('page-field.json'), slow('no-field-data.json')]);
    const net: NetDeps = {
      lookup: f.net.lookup,
      async connect(req) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        try {
          return await f.net.connect(req);
        } finally {
          inFlight--;
        }
      },
    };
    const out = await measureSampleSpeeds(['https://a.example.in/', 'https://b.example.in/'], {
      ...deps(net),
      resolveServiceKey: async () => {
        keyCalls++;
        return { apiKey: FAKE_KEY };
      },
    });
    expect(maxInFlight).toBe(1);
    expect(keyCalls).toBe(1);
    expect(out.map((o) => o.url)).toEqual(['https://a.example.in/', 'https://b.example.in/']);
    expect(f.connects.map((c) => c.url.searchParams.get('url'))).toEqual([
      'https://a.example.in/',
      'https://b.example.in/',
    ]);
    expect(out[0].speed.field).toMatchObject({ status: 'measured', scope: 'page' });
    expect(out[1].speed.field).toMatchObject({ status: 'not-measured', reason: 'no-field-data' });
  });

  it('after a quota answer no further request is made; the remaining pages are not-measured quota', async () => {
    const f = fakeNet([json('page-field.json'), json('quota-429.json', 429), json('page-field.json')]);
    const out = await measureSampleSpeeds(
      ['https://a.example.in/', 'https://b.example.in/', 'https://c.example.in/', 'https://d.example.in/'],
      deps(f.net)
    );
    expect(f.connects).toHaveLength(2);
    expect(out[0].speed.lab.status).toBe('measured');
    for (const o of out.slice(1)) expectNotMeasured(o.speed, 'quota');
  });

  it('a failed page does not stop the rest', async () => {
    const f = fakeNet([new Error('timeout'), json('page-field.json')]);
    const out = await measureSampleSpeeds(['https://a.example.in/', 'https://b.example.in/'], deps(f.net));
    expectNotMeasured(out[0].speed, 'timeout');
    expect(out[1].speed.lab.status).toBe('measured');
  });

  it('no pages: no key lookup and no request', async () => {
    let keyCalls = 0;
    const f = fakeNet([]);
    const out = await measureSampleSpeeds([], { ...deps(f.net), resolveServiceKey: async () => (keyCalls++, null) });
    expect(out).toEqual([]);
    expect(keyCalls).toBe(0);
    expect(f.lookups).toHaveLength(0);
  });
});

describe('the key never leaks', () => {
  it('is absent from every returned value and log line, on success and on every failure', async () => {
    const echo = (req: PinnedRequest): Error => new Error(`socket hang up ${req.url} ${JSON.stringify(req.headers)}`);
    const f = fakeNet([
      json('page-field.json'),
      json('quota-429.json', 429),
      json('lighthouse-error-500.json', 500),
      json('bad-key-400.json', 400),
      echo,
      new Error('timeout'),
      { status: 200, headers: {}, body: 'not json' },
    ]);
    const d = deps(f.net, withKey);
    const results: PageSpeed[] = [];
    for (let i = 0; i < 7; i++) results.push(await measurePageSpeed(`https://shop.example.in/p${i}`, d));
    results.push(...(await measureSampleSpeeds(['https://shop.example.in/x'], d)).map((s) => s.speed));
    expect(f.connects.every((c) => c.headers['x-goog-api-key'] === FAKE_KEY)).toBe(true);
    expect(JSON.stringify(results)).not.toContain(FAKE_KEY);
    expect(d.lines.length).toBeGreaterThan(0);
    expect(d.lines.join('\n')).not.toContain(FAKE_KEY);
  });

  it('measurePageSpeed does not throw, even when the network throws an error naming the key', async () => {
    const f = fakeNet([new Error(`boom ${FAKE_KEY}`)]);
    const d = deps(f.net, withKey);
    await expect(measurePageSpeed('https://shop.example.in/', d)).resolves.toBeDefined();
    expect(d.lines.join('\n')).not.toContain(FAKE_KEY);
  });
});
