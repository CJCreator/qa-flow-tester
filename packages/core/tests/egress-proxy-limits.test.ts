import http from 'http';
import net from 'net';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startEgressProxy, type EgressProxy } from '../src/egress-proxy.js';

// Unit tier: loopback servers on port 0 only. No Chromium, no outside network.
let site: http.Server;
let silent: net.Server;
let sitePort: number;
let silentPort: number;
let proxy: EgressProxy;
let proxyPort: number;
const silentSockets = new Set<net.Socket>();
const connects: Array<{ address: string; port: number }> = [];

beforeAll(async () => {
  site = http.createServer((_req, res) => res.end('ok'));
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()));
  sitePort = (site.address() as AddressInfo).port;
  // Accepts the connection and never answers.
  silent = net.createServer((s) => {
    silentSockets.add(s);
    s.on('error', () => {});
  });
  await new Promise<void>((r) => silent.listen(0, '127.0.0.1', () => r()));
  silentPort = (silent.address() as AddressInfo).port;

  proxy = await startEgressProxy({
    lookup: async () => ['8.8.8.8'],
    connect: (address, port) => {
      connects.push({ address, port });
      return net.connect(port === 8181 ? silentPort : sitePort, '127.0.0.1');
    },
    idleTimeoutMs: 300,
  });
  proxyPort = Number(new URL(proxy.url).port);
});

afterAll(async () => {
  await proxy?.close();
  for (const s of silentSockets) s.destroy();
  site.closeAllConnections();
  await new Promise((r) => site.close(r));
  await new Promise((r) => silent.close(r));
});

function connectStatus(target: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: target, agent: false });
    req.on('connect', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

function getStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'GET', path: url, agent: false }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('egress proxy ports', () => {
  it('refuses a CONNECT to port 22 and never connects', async () => {
    connects.length = 0;
    expect(await connectStatus('site.test:22')).toBe(403);
    expect(await connectStatus('site.test:25')).toBe(403);
    expect(connects).toEqual([]);
  });

  it('allows ports 80 and 443', async () => {
    expect(await connectStatus('site.test:443')).toBe(200);
    expect(await connectStatus('site.test:80')).toBe(200);
  });

  it('refuses a plain-http request to an unlisted port', async () => {
    expect(await getStatus('http://site.test:2222/')).toBe(403);
  });

  it('allows a port the target names explicitly once it is allowed', async () => {
    expect(await connectStatus('site.test:8443')).toBe(403);
    proxy.allowPort(8443);
    expect(await connectStatus('site.test:8443')).toBe(200);
  });
});

describe('egress proxy plain-http idle timeout', () => {
  it('answers 504 when the upstream never replies', async () => {
    proxy.allowPort(8181);
    expect(await getStatus('http://silent.test:8181/')).toBe(504);
  });
});
