/**
 * ADR 0042: the Website Audit gets past a dev tunnel's warning page and never records a warning page or a
 * bot check as the site. Unit tier: no browser, no network; the route is a fake.
 */
import { describe, it, expect } from 'vitest';
import {
  AuditCrawlBlockedError,
  TUNNEL_SKIP_HEADERS,
  addTunnelSkipHeaders,
  classifyInterstitial,
  isAuditedSite,
  siteHosts,
} from '../src/audit/crawl/interstitial.js';

/** The page text a saved audit of a devtunnels address recorded as its one page (2026-11-05). */
const DEVTUNNELS_WARNING = [
  'You are about to connect to a developer tunnel at: 5scrrfdj-3000.inc1.devtunnels.ms',
  'This tunnel is hosted by a developer. Only continue if you trust the source.',
  'Continue',
  'Report unsafe page',
].join('\n');

describe('classifyInterstitial', () => {
  it('names the devtunnels warning page', () => {
    expect(classifyInterstitial({ title: 'Dev Tunnels', text: DEVTUNNELS_WARNING })).toBe('tunnel-warning');
  });

  it('names the ngrok browser warning', () => {
    const text = 'You are about to visit: abcd-1-2-3.ngrok-free.app\nVisit Site\nERR_NGROK_6024';
    expect(classifyInterstitial({ title: '', text })).toBe('tunnel-warning');
    expect(classifyInterstitial({ title: '', text: 'You are about to visit: abcd.ngrok-free.app' })).toBe(
      'tunnel-warning'
    );
  });

  it('names a bot check by its title or its text', () => {
    expect(classifyInterstitial({ title: 'Just a moment...', text: '' })).toBe('bot-check');
    expect(classifyInterstitial({ title: 'Attention Required! | Cloudflare', text: '' })).toBe('bot-check');
    expect(classifyInterstitial({ title: 'Shop', text: 'Checking your browser before accessing shop.example' })).toBe(
      'bot-check'
    );
    expect(classifyInterstitial({ title: '', text: 'Enable JavaScript and cookies to continue' })).toBe('bot-check');
  });

  it('leaves a real page alone, even one that talks about tunnels or ngrok', () => {
    expect(
      classifyInterstitial({ title: 'MG Health Tech · Hospital-grade care, at home', text: 'Book a nurse visit' })
    ).toBeNull();
    expect(
      classifyInterstitial({ title: 'Blog', text: 'How we use ngrok and dev tunnels to demo our app to clients.' })
    ).toBeNull();
    expect(classifyInterstitial({ title: '', text: '' })).toBeNull();
  });
});

describe('siteHosts and isAuditedSite', () => {
  it('treat the start host and its www twin as the site, nothing else', () => {
    const hosts = siteHosts(new URL('https://Example.com/start'));
    expect([...hosts].sort()).toEqual(['example.com', 'www.example.com']);
    expect(isAuditedSite('https://www.example.com/a', hosts)).toBe(true);
    expect(isAuditedSite('https://cdn.example.net/app.js', hosts)).toBe(false);
    expect(isAuditedSite('not a url', hosts)).toBe(false);
  });
});

interface FakeCall {
  url: string;
  fallback?: { headers?: Record<string, string> };
}

/** A context whose one route handler is called by hand with fake requests. */
async function routeWith(start: string) {
  let handler: ((route: unknown) => Promise<void> | void) | undefined;
  const context = {
    route: async (_pattern: string, h: (route: unknown) => Promise<void> | void) => {
      handler = h;
    },
  };
  await addTunnelSkipHeaders(context as never, new URL(start));
  return async (url: string, headers: Record<string, string> = { accept: 'text/html' }): Promise<FakeCall> => {
    const call: FakeCall = { url };
    await handler!({
      request: () => ({ url: () => url, headers: () => headers }),
      fallback: async (options?: { headers?: Record<string, string> }) => {
        call.fallback = options ?? {};
      },
    });
    return call;
  };
}

describe('addTunnelSkipHeaders', () => {
  it('adds the skip headers to requests for the audited site, keeping the request headers', async () => {
    const send = await routeWith('https://5scrrfdj-3000.inc1.devtunnels.ms/');
    const call = await send('https://5scrrfdj-3000.inc1.devtunnels.ms/about', { accept: 'text/html' });
    expect(call.fallback?.headers).toEqual({ accept: 'text/html', ...TUNNEL_SKIP_HEADERS });
  });

  it('hands other sites on unchanged: they never see the headers', async () => {
    const send = await routeWith('https://5scrrfdj-3000.inc1.devtunnels.ms/');
    const call = await send('https://fonts.googleapis.com/css2?family=Inter');
    expect(call.fallback).toEqual({});
  });
});

describe('AuditCrawlBlockedError', () => {
  it('carries a plain sentence for each kind, with no address or page text', () => {
    const tunnel = new AuditCrawlBlockedError('tunnel-warning');
    const bot = new AuditCrawlBlockedError('bot-check');
    expect(tunnel.kind).toBe('tunnel-warning');
    expect(tunnel.message).toMatch(/tunnel's warning page/);
    expect(bot.message).toMatch(/blocks automated visitors/);
    expect(tunnel.message).not.toMatch(/devtunnels\.ms|http/);
  });
});
