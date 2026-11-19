/**
 * T-431: with Google sign-in (ADC) as the only AI access, GET /api/ai/settings reports configured, so the
 * Improved version buttons turn on. The credentials file is a stub in a scratch folder; nothing is read from it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import type { AIProviderType } from '@qa/types';
import type { KeyResolver } from '@qa/core';
import { RunnerServer } from '../src/server.js';

const PORT = 3791;
const scratch = path.join(process.cwd(), '.tmp-ai-settings-adc');
const adcFile = path.join(scratch, 'adc.json');
const keys: Partial<Record<AIProviderType, string>> = {};
const keyResolver = {
  resolveKey: async (p?: AIProviderType) =>
    p && keys[p] ? { provider: p, apiKey: keys[p]!, source: 'keychain' as const } : null,
  saveByokKey: async () => 'keychain' as const,
  readSecret: async () => null,
  saveSecret: async () => true,
  forgetSecret: async () => {},
} as unknown as KeyResolver;

function getSettings() {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: PORT, path: '/api/ai/settings', method: 'GET' }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('AI settings with Google sign-in only (T-431)', () => {
  let server: RunnerServer;
  const saved = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  beforeAll(async () => {
    await fs.mkdir(scratch, { recursive: true });
    server = new RunnerServer({
      port: PORT,
      outputDir: path.join(scratch, 'report'),
      dataDir: path.join(scratch, 'data'),
      keyResolver,
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    if (saved === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = saved;
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('reports configured when ADC works and no key is saved', async () => {
    await fs.writeFile(adcFile, '{}');
    process.env.GOOGLE_APPLICATION_CREDENTIALS = adcFile;
    const res = await getSettings();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, googleSignIn: true });
  });

  it('reports not configured with neither a key nor ADC', async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(scratch, 'missing.json');
    const res = await getSettings();
    expect(res.body.configured).toBe(false);
    expect(res.body.googleSignIn).toBeUndefined();
  });
});
