/**
 * T-395 follow-up: on a hosted copy a public target that names a port (https://example.com:8443) is let
 * through the egress proxy once the start has checked it; every other port stays refused.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import net from 'net';
import path from 'path';
import { getBrowserPolicy } from '@qa/core';
import { RunnerServer } from '../src/server.js';

const PORT = 3583;
const scratch = path.join(process.cwd(), '.tmp-egress-port');
const connects: Array<{ address: string }> = [];

function post(body: unknown): Promise<number> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: 'localhost',
        port: PORT,
        path: '/api/runner/preflight',
        method: 'POST',
        headers: {
          host: `localhost:${PORT}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function sendConnect(proxyUrl: string, target: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: Number(new URL(proxyUrl).port),
      method: 'CONNECT',
      path: target,
      agent: false,
    });
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
}

describe('egress proxy and a target on an explicit port (beta)', () => {
  let server: RunnerServer;
  let sink: net.Server;

  beforeAll(async () => {
    sink = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) => sink.listen(0, '127.0.0.1', () => resolve()));
    const sinkPort = (sink.address() as net.AddressInfo).port;
    server = new RunnerServer({
      port: PORT,
      outputDir: path.join(scratch, 'report'),
      dataDir: path.join(scratch, 'data'),
      beta: true,
      hostChecks: { lookup: async () => ['93.184.216.34'], connect: async () => Promise.reject(new Error('no')) },
      egressConnect: (address) => {
        connects.push({ address });
        return net.connect(sinkPort, '127.0.0.1');
      },
    });
    await server.start();
  });

  afterAll(async () => {
    await server?.stop();
    await new Promise<void>((resolve) => sink.close(() => resolve()));
  });

  it('allows the target port after the start check, and still refuses port 22', async () => {
    const proxy = getBrowserPolicy()?.proxy;
    expect(proxy).toBeTruthy();
    expect(await sendConnect(proxy!, 'routed.test:8443')).toBe(403);

    await post({ targetUrl: 'https://routed.test:8443/' });

    expect(await sendConnect(proxy!, 'routed.test:8443')).toBe(200);
    expect(connects.length).toBe(1);
    expect(await sendConnect(proxy!, 'routed.test:22')).toBe(403);
    expect(connects.length).toBe(1);
  });
});
