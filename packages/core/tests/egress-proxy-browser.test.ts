import crypto from 'crypto';
import http from 'http';
import net from 'net';
import type { AddressInfo } from 'net';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startEgressProxy, type EgressProxy } from '../src/egress-proxy.js';

// Browser tier: launches Chromium. Same fake DNS and connect as egress-proxy.test.ts.

const DNS: Record<string, string[]> = {
  'site.test': ['8.8.8.8'],
  'evil.test': ['10.0.0.1'],
};

let site: http.Server;
let sitePort: number;
let proxy: EgressProxy;
let browser: Browser | undefined;
/** Upgraded sockets are not tracked by the http server, so close() would wait on them. */
const upgraded = new Set<net.Socket>();

beforeAll(async () => {
  site = http.createServer((_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end('ok');
  });
  // The WebSocket endpoint: a bare 101 handshake, the socket is then left open.
  site.on('upgrade', (req, socket) => {
    upgraded.add(socket as net.Socket);
    const key = String(req.headers['sec-websocket-key'] ?? '');
    const accept = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', () => resolve()));
  sitePort = (site.address() as AddressInfo).port;

  proxy = await startEgressProxy({
    lookup: async (host) => {
      const answer = DNS[host];
      if (!answer) throw new Error('ENOTFOUND');
      return answer;
    },
    connect: (address) => {
      if (address !== '8.8.8.8') throw new Error('connect to a non-public address');
      return net.connect(sitePort, '127.0.0.1');
    },
  });
  browser = await chromium.launch({ proxy: { server: proxy.url } });
});

afterAll(async () => {
  for (const socket of upgraded) socket.destroy();
  await browser?.close();
  await proxy?.close();
  await new Promise<void>((resolve) => site.close(() => resolve()));
});

/** Opens a WebSocket in the page and reports whether it opened. */
const socketOpens = (url: string) =>
  `new Promise((resolve) => {
     const ws = new WebSocket(${JSON.stringify(url)});
     ws.onopen = () => { ws.close(); resolve(true); };
     ws.onerror = () => resolve(false);
     ws.onclose = () => resolve(false);
     setTimeout(() => resolve(false), 5000);
   })`;

describe('egress proxy in Chromium', () => {
  it('the page loads through the proxy', async () => {
    const context = await browser!.newContext();
    try {
      const page = await context.newPage();
      const response = await page.goto('http://site.test/');
      expect(response?.status()).toBe(200);
      expect(await page.textContent('body')).toBe('ok');
    } finally {
      await context.close();
    }
  });

  it('fetch to a private name fails; WebSockets follow the same rule', async () => {
    const context = await browser!.newContext();
    try {
      const page = await context.newPage();
      await page.goto('http://site.test/');
      const fetchFailed = await page.evaluate(() =>
        fetch('http://evil.test/').then(
          () => false,
          () => true
        )
      );
      expect(fetchFailed).toBe(true);
      expect(await page.evaluate(socketOpens(`ws://site.test/ws`))).toBe(true);
      expect(await page.evaluate(socketOpens(`ws://evil.test/ws`))).toBe(false);
    } finally {
      await context.close();
    }
  });

  it('a Web Worker WebSocket to a private name does not open (the gap T-307 cannot close)', async () => {
    const context = await browser!.newContext();
    try {
      const page = await context.newPage();
      await page.goto('http://site.test/');
      const result = await page.evaluate(
        (workerSource: string) =>
          new Promise<{ evil: boolean; site: boolean }>((resolve) => {
            const worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })));
            worker.onmessage = (e) => {
              resolve(e.data);
              worker.terminate();
            };
          }),
        `const open = (url) => new Promise((resolve) => {
           const ws = new WebSocket(url);
           ws.onopen = () => { ws.close(); resolve(true); };
           ws.onerror = () => resolve(false);
           ws.onclose = () => resolve(false);
           setTimeout(() => resolve(false), 5000);
         });
         Promise.all([open('ws://evil.test/ws'), open('ws://site.test/ws')]).then(([evil, s]) =>
           postMessage({ evil, site: s })
         );`
      );
      expect(result.evil).toBe(false);
      expect(result.site).toBe(true);
    } finally {
      await context.close();
    }
  });

  it('a fetch to the loopback address fails: loopback goes through the proxy and is refused', async () => {
    const context = await browser!.newContext();
    try {
      const page = await context.newPage();
      await page.goto('http://site.test/');
      const failed = await page.evaluate(
        (url: string) =>
          fetch(url).then(
            () => false,
            () => true
          ),
        `http://127.0.0.1:${sitePort}/`
      );
      expect(failed).toBe(true);
    } finally {
      await context.close();
    }
  });
});
