import { describe, it, expect } from 'vitest';
import type http from 'http';
import { clientAddress, trustedProxyHops } from '../src/beta.js';

/** A request stub with the given X-Forwarded-For header and socket address. */
function req(forwarded: string | string[] | undefined, remoteAddress?: string): http.IncomingMessage {
  return {
    headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
    socket: remoteAddress === undefined ? undefined : { remoteAddress },
  } as unknown as http.IncomingMessage;
}

describe('trustedProxyHops', () => {
  it('defaults to 1; accepts whole numbers 0 to 5; anything else is 1', () => {
    expect(trustedProxyHops({})).toBe(1);
    expect(trustedProxyHops({ RUNNER_TRUSTED_PROXY_HOPS: '0' })).toBe(0);
    expect(trustedProxyHops({ RUNNER_TRUSTED_PROXY_HOPS: '2' })).toBe(2);
    expect(trustedProxyHops({ RUNNER_TRUSTED_PROXY_HOPS: '9' })).toBe(1);
    expect(trustedProxyHops({ RUNNER_TRUSTED_PROXY_HOPS: '-1' })).toBe(1);
    expect(trustedProxyHops({ RUNNER_TRUSTED_PROXY_HOPS: 'two' })).toBe(1);
  });
});

describe('clientAddress', () => {
  it('with one trusted proxy, takes the last entry: a spoofed first entry is ignored', () => {
    expect(clientAddress(req('spoofed, 203.0.113.7', '10.0.0.5'), 1)).toBe('203.0.113.7');
  });

  it('with two trusted proxies, takes the entry the outer one added', () => {
    expect(clientAddress(req('203.0.113.7, 10.0.0.1', '10.0.0.5'), 2)).toBe('203.0.113.7');
  });

  it('with zero hops, ignores the header and uses the socket address', () => {
    expect(clientAddress(req('spoofed, 203.0.113.7', '10.0.0.5'), 0)).toBe('10.0.0.5');
  });

  it('with more hops than entries, uses the socket address', () => {
    expect(clientAddress(req('203.0.113.7', '10.0.0.5'), 2)).toBe('10.0.0.5');
  });

  it('with no header, uses the socket address; with neither, "unknown"', () => {
    expect(clientAddress(req(undefined, '10.0.0.5'), 1)).toBe('10.0.0.5');
    expect(clientAddress(req(undefined), 1)).toBe('unknown');
  });
});
