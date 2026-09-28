import { describe, it, expect } from 'vitest';
import { BrowserManager } from '../src/browser.js';

describe('BrowserManager', () => {
  it('starts a new browser when the old one has gone away, so one crash does not end the run', async () => {
    const manager = new BrowserManager();
    try {
      const first = await manager.launch();
      await first.close(); // what a crash looks like from here: the browser is no longer connected

      const { context, page } = await manager.openPage();
      await page.setContent('<h1>Still testing</h1>');
      expect(await page.textContent('h1')).toBe('Still testing');
      expect(context.browser()).not.toBe(first);
      await context.close();
    } finally {
      await manager.close();
    }
  }, 60000);
});
