import { describe, it, expect } from 'vitest';
import { redactedMessage, RunnerServer } from '../src/server.js';
import path from 'path';
import os from 'os';
import { promises as fs, mkdtempSync } from 'fs';
import http from 'http';

describe('error redaction', () => {
  it('redacts passwords, tokens, usernames from roles', () => {
    const err = new Error('Sign in failed for user alice with password SecretPassword999!');
    const msg = redactedMessage(err, {
      roles: [{ username: 'alice', password: 'SecretPassword999!' }],
    });
    expect(msg).not.toContain('SecretPassword999!');
    expect(msg).toContain('***');
  });

  it('redacts custom header values', () => {
    const err = new Error('HTTP 403 request failed with header X-Bypass: bypass-token-secret-xyz');
    const msg = redactedMessage(err, {
      customHeaders: { 'X-Bypass': 'bypass-token-secret-xyz' },
    });
    expect(msg).not.toContain('bypass-token-secret-xyz');
    expect(msg).toContain('***');
  });

  it('redacts tunnel auth credentials', () => {
    const err = new Error('Proxy returned 407 Proxy Authentication Required with creds admin:tunnel-secret-pass-789');
    const msg = redactedMessage(err, {
      tunnelAuth: 'tunnel-secret-pass-789',
    });
    expect(msg).not.toContain('tunnel-secret-pass-789');
    expect(msg).toContain('***');
  });

  it('redacts session cookies', () => {
    const err = new Error('Invalid session cookie: session_id=cookie-secret-token-555');
    const msg = redactedMessage(err, {
      cookies: [{ name: 'session_id', value: 'cookie-secret-token-555' }],
    });
    expect(msg).not.toContain('cookie-secret-token-555');
    expect(msg).toContain('***');
  });

  it('strips URL query parameters and query secrets from error messages', () => {
    const err = new Error('Failed to reach http://example.com/api?secret_token=topsecret123&env=prod during probe');
    const msg = redactedMessage(err, {
      targetUrl: 'http://example.com/api?secret_token=topsecret123&env=prod',
    });
    expect(msg).not.toContain('secret_token=topsecret123');
    expect(msg).not.toContain('topsecret123');
    expect(msg).not.toContain('?');
    expect(msg).toContain('http://example.com/api');
  });

  it('handles non-Error objects safely', () => {
    const raw = 'Direct string error leaking super-secret-value-abc';
    const msg = redactedMessage(raw, {
      customHeaders: { 'X-Secret': 'super-secret-value-abc' },
    });
    expect(msg).not.toContain('super-secret-value-abc');
    expect(msg).toContain('***');
  });

  it('redacts query secrets in server RUN_FAILED events when discovery fails to connect', async () => {
    const RUNNER_PORT = 3681;
    // A new folder per run, outside the repository: inside OneDrive the sync client picks up every file a run
    // writes and holds files open so the clean-up fails.
    const scratch = mkdtempSync(path.join(os.tmpdir(), 'qa-test-error-redaction-'));
    const outputDir = path.join(scratch, 'report');
    const dataDir = `${outputDir}-data`;

    const runner = new RunnerServer({
      port: RUNNER_PORT,
      outputDir,
      dataDir,
    });
    await runner.start();

    try {
      const sensitiveToken = 'leaked-secret-query-token-999';
      // Connect to unreachable loopback port
      const targetUrl = `http://127.0.0.1:54321/probe?api_key=${sensitiveToken}`;

      // Open SSE stream to capture RUN_FAILED
      let sseReceived = '';
      const sseReq = http.get(`http://localhost:${RUNNER_PORT}/api/runner/events`, (res) => {
        res.on('data', (chunk) => {
          sseReceived += chunk.toString();
        });
      });

      // Trigger run
      const res = await fetch(`http://localhost:${RUNNER_PORT}/api/runner/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl,
          owner: true,
          mode: 'product',
          useAI: false,
        }),
      });
      expect(res.status).toBe(202);

      // Wait for run to fail. Starting Chromium and failing to connect took over 10 s on a busy laptop, so
      // the wait runs to within the test's own 60 s rather than a fixed 10 s (REQ-046).
      for (let i = 0; i < 200; i++) {
        const statusRes = await (await fetch(`http://localhost:${RUNNER_PORT}/api/runner/status`)).json();
        if (statusRes.phase === 'failed') break;
        await new Promise((r) => setTimeout(r, 250));
      }

      sseReq.destroy();

      // Check SSE output: must never leak sensitiveToken or query params
      expect(sseReceived).not.toContain(sensitiveToken);
      expect(sseReceived).not.toContain(`api_key=`);

      // Check runner status endpoint
      const finalStatus = await (await fetch(`http://localhost:${RUNNER_PORT}/api/runner/status`)).json();
      expect(finalStatus.phase).toBe('failed');
      if (finalStatus.lastError) {
        expect(finalStatus.lastError).not.toContain(sensitiveToken);
        expect(finalStatus.lastError).not.toContain(`api_key=`);
      }
    } finally {
      await runner.stop();
      await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
    }
  }, 60000);
});
