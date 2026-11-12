import http from 'http';
import net from 'net';
import type { AddressInfo } from 'net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setBrowserPolicy } from '../src/browser.js';
import { startEgressProxy, type EgressProxy } from '../src/egress-proxy.js';

// Unit tier: loopback servers on port 0 only. No Chromium, no outside network.

let site: http.Server;
let sitePort: number;
let siteHeaders: http.IncomingHttpHeaders | undefined;
let proxy: EgressProxy;
let proxyPort: number;
const lookups: string[] = [];
const connects: string[] = [];
const rebindAnswers: string[][] = [['8.8.8.8'], ['10.0.0.5']];

const DNS: Record<string, string[]> = {
  'site.test': ['8.8.8.8'],
  'evil.test': ['10.0.0.1'],
};

beforeAll(async () => {
  site = http.createServer((req, res) => {
    siteHeaders = req.headers;
    res.end('ok');
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', () => resolve()));
  sitePort = (site.address() as AddressInfo).port;

  proxy = await startEgressProxy({
    lookup: async (host) => {
      lookups.push(host);
      if (host === 'rebind.test') return rebindAnswers.shift() ?? ['10.0.0.5'];
      const answer = DNS[host];
      if (!answer) throw new Error('ENOTFOUND');
      return answer;
    },
    connect: (address) => {
      connects.push(address);
      if (address !== '8.8.8.8') throw new Error('connect to a non-public address');
      return net.connect(sitePort, '127.0.0.1');
    },
  });
  proxyPort = Number(new URL(proxy.url).port);
});

afterEach(() => {
  setBrowserPolicy(null);
  lookups.length = 0;
  connects.length = 0;
});

afterAll(async () => {
  await proxy?.close();
  await new Promise<void>((resolve) => site.close(() => resolve()));
});

/** Sends a CONNECT through the proxy. A 200 gives the open tunnel; anything else gives only the status. */
function sendConnect(target: string, agentless = true): Promise<{ status: number; socket?: net.Socket }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'CONNECT',
      path: target,
      ...(agentless ? { agent: false } : {}),
    });
    req.on('connect', (res, socket) => resolve({ status: res.statusCode ?? 0, socket }));
    req.on('response', (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0 });
    });
    req.on('error', reject);
    req.end();
  });
}

/** Reads from a socket until the text appears (or fails after 2 s). */
function readUntil(socket: net.Socket, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    const timer = setTimeout(() => reject(new Error(`no "${text}" in time`)), 2000);
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8');
      if (data.includes(text)) {
        clearTimeout(timer);
        resolve(data);
      }
    });
    socket.on('error', reject);
  });
}

describe('egress proxy', () => {
  it('CONNECT to a public host answers 200, and bytes after it reach the site', async () => {
    const { status, socket } = await sendConnect('site.test:443');
    expect(status).toBe(200);
    expect(socket).toBeDefined();
    socket!.write('GET / HTTP/1.1\r\nHost: site.test\r\nConnection: close\r\n\r\n');
    const reply = await readUntil(socket!, 'ok');
    expect(reply).toContain('ok');
    socket!.destroy();
  });

  it('absolute-form GET http://site.test/ answers the site, with Host set and no Proxy-Connection', async () => {
    const body = await new Promise<{ status?: number; text: string }>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: proxyPort,
          method: 'GET',
          path: 'http://site.test/x',
          agent: false,
          headers: { 'Proxy-Connection': 'keep-alive' },
        },
        (res) => {
          let text = '';
          res.on('data', (c) => (text += c));
          res.on('end', () => resolve({ status: res.statusCode, text }));
        }
      );
      req.on('error', reject);
      req.end();
    });
    expect(body.status).toBe(200);
    expect(body.text).toBe('ok');
    expect(siteHeaders?.host).toBe('site.test');
    expect(siteHeaders?.['proxy-connection']).toBeUndefined();
  });

  it('refuses private, loopback and local targets with 403 and never connects', async () => {
    for (const target of ['evil.test:443', '127.0.0.1:9222', 'localhost:80']) {
      const { status } = await sendConnect(target);
      expect(status).toBe(403);
    }
    expect(connects).toEqual([]);
  });

  it('resolves afresh per connection: a rebinding host is allowed once, then refused', async () => {
    rebindAnswers.splice(0, rebindAnswers.length, ['8.8.8.8'], ['10.0.0.5']);
    const first = await sendConnect('rebind.test:443');
    first.socket?.destroy();
    const second = await sendConnect('rebind.test:443');
    expect(first.status).toBe(200);
    expect(second.status).toBe(403);
    expect(lookups.filter((h) => h === 'rebind.test')).toHaveLength(2);
  });

  it('honours a public pin without a lookup, and refuses a private pin', async () => {
    setBrowserPolicy({ pinned: { 'pinned.test': '8.8.8.8' } });
    const ok = await sendConnect('pinned.test:443');
    ok.socket?.destroy();
    expect(ok.status).toBe(200);
    expect(lookups).not.toContain('pinned.test');

    setBrowserPolicy({ pinned: { 'pinned.test': '10.0.0.9' } });
    const refused = await sendConnect('pinned.test:443');
    expect(refused.status).toBe(403);
  });

  it('answers 400 for a missing or out-of-range port', async () => {
    expect((await sendConnect('site.test')).status).toBe(400);
    expect((await sendConnect('site.test:70000')).status).toBe(400);
  });

  it('answers 503 for a connection over maxOpen', async () => {
    const limited = await startEgressProxy({
      maxOpen: 1,
      lookup: async () => ['8.8.8.8'],
      connect: () => net.connect(sitePort, '127.0.0.1'),
    });
    const port = Number(new URL(limited.url).port);
    try {
      const sendTo = (target: string) =>
        new Promise<number>((resolve, reject) => {
          const req = http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: target, agent: false });
          req.on('connect', (res, socket) => {
            socket.destroy();
            resolve(res.statusCode ?? 0);
          });
          req.on('response', (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          });
          req.on('error', reject);
          req.end();
        });
      // Hold the first tunnel open, then a second connection is over the limit.
      const held = await new Promise<net.Socket>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: 'site.test:443', agent: false });
        req.on('connect', (_res, socket) => resolve(socket));
        req.on('error', reject);
        req.end();
      });
      expect(await sendTo('site.test:443')).toBe(503);
      held.destroy();
    } finally {
      await limited.close();
    }
  });

  it('close() ends open tunnels and the port stops accepting connections', async () => {
    const limited = await startEgressProxy({
      lookup: async () => ['8.8.8.8'],
      connect: () => net.connect(sitePort, '127.0.0.1'),
    });
    const port = Number(new URL(limited.url).port);
    const tunnel = await new Promise<net.Socket>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: 'site.test:443', agent: false });
      req.on('connect', (_res, socket) => resolve(socket));
      req.on('error', reject);
      req.end();
    });
    const ended = new Promise<void>((resolve) => tunnel.once('close', () => resolve()));
    tunnel.on('error', () => {});
    await limited.close();
    await ended;
    const refused = await new Promise<boolean>((resolve) => {
      const probe = net.connect(port, '127.0.0.1');
      probe.once('connect', () => {
        probe.destroy();
        resolve(false);
      });
      probe.once('error', () => resolve(true));
    });
    expect(refused).toBe(true);
  });
});
