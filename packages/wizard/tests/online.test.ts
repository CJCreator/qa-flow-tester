import { describe, it, expect } from 'vitest';
import { DEFAULT_WAKE_LIMIT_MS, startAddress, wakeAddress, wakeLimitMs } from '../src/lib/online';

describe('where "Run a free check-up" leads', () => {
  it('stays on this site when no online copy is published', () => {
    expect(startAddress(null, 'https://app.example.com')).toBe('/check');
  });
  it('stays on this site when this page is the online copy', () => {
    expect(startAddress('https://qa.onrender.com', 'https://qa.onrender.com')).toBe('/check');
  });
  it('goes to the online copy from a static host', () => {
    expect(startAddress('https://qa.onrender.com', 'https://site.vercel.app')).toBe('https://qa.onrender.com/check');
    expect(startAddress('https://qa.onrender.com/', 'https://site.vercel.app')).toBe('https://qa.onrender.com/check');
  });
  it('falls back to this site when the published address cannot be read', () => {
    expect(startAddress('not a url', 'https://site.vercel.app')).toBe('/check');
  });
});

describe('waking the online copy', () => {
  it('pings its health address from a static host', () => {
    expect(wakeAddress('https://qa.onrender.com', 'https://site.vercel.app')).toBe('https://qa.onrender.com/healthz');
  });
  it('has nothing to wake on its own origin, or with no online copy', () => {
    expect(wakeAddress('https://qa.onrender.com', 'https://qa.onrender.com')).toBeNull();
    expect(wakeAddress(null, 'https://site.vercel.app')).toBeNull();
    expect(wakeAddress('nope', 'https://site.vercel.app')).toBeNull();
  });
});

describe('how long to wait for the online copy to wake', () => {
  it('wake limit defaults to 90 s', () => {
    expect(DEFAULT_WAKE_LIMIT_MS).toBe(90_000);
    expect(wakeLimitMs(undefined)).toBe(90_000);
  });
  it('reads seconds from config', () => {
    expect(wakeLimitMs('45')).toBe(45_000);
    expect(wakeLimitMs(' 120 ')).toBe(120_000);
  });
  it('falls back to 90 s for empty, zero, negative, NaN, text', () => {
    for (const raw of ['', '  ', '0', '-5', 'NaN', 'soon', 'Infinity']) {
      expect(wakeLimitMs(raw)).toBe(90_000);
    }
  });
  it('clamps to 5 s..600 s', () => {
    expect(wakeLimitMs('1')).toBe(5_000);
    expect(wakeLimitMs('9999')).toBe(600_000);
  });
});
