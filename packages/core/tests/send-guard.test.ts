import { describe, it, expect } from 'vitest';
import { SendGuard } from '../src/send-guard.js';

describe('send guard', () => {
  it('send guard: counts POST/PUT/PATCH/DELETE to the site host after a click', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const g = new SendGuard('shop.test');
      g.clickStarted(2);
      g.noteRequest({ method, url: 'https://shop.test/api/x', resourceType: 'fetch' });
      expect(g.hasSentAny()).toBe(true);
    }
  });

  it('send guard: ignores GET, third-party host, ping resource type, and sends before any click', () => {
    const g = new SendGuard('shop.test');
    g.noteRequest({ method: 'POST', url: 'https://shop.test/early', resourceType: 'fetch' });
    expect(g.hasSentAny()).toBe(false);
    g.clickStarted(0);
    g.noteRequest({ method: 'GET', url: 'https://shop.test/a' });
    g.noteRequest({ method: 'POST', url: 'https://analytics.example/collect' });
    g.noteRequest({ method: 'POST', url: 'https://shop.test/beacon', resourceType: 'ping' });
    g.noteRequest({ method: 'POST', url: 'not a url' });
    expect(g.hasSentAny()).toBe(false);
  });

  it('send guard: records which click step sent', () => {
    const g = new SendGuard('shop.test');
    g.clickStarted(1);
    g.clickStarted(3);
    g.noteRequest({ method: 'POST', url: 'http://shop.test:8080/s' });
    expect(g.sentBySteps()).toEqual([3]);
  });
});
