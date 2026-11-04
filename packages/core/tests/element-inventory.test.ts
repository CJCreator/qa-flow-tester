import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { collectElementInventory } from '../src/discovery/element-inventory.js';

const PAGE = `<!doctype html><html lang="en"><body>
  <label for="full-name">Full name</label><input id="full-name">
  <input placeholder="Search books">
  <input name="promo_code">
  <label>Country <select name="country"><option>France</option><option>Spain</option></select></label>
  <button data-testid="save-btn">Save invoice</button>
  <button aria-label="Close dialog">×</button>
  <a href="/help">Get help</a>
  <button style="display:none">Hidden action</button>
  <button disabled>Disabled action</button>
  <button><svg width="10" height="10"></svg></button>
  <input type="hidden" name="csrf" value="x">
</body></html>`;

describe('Element inventory', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  it('names each element the way a person would, with a selector the runner can use', async () => {
    const page = await browser.newPage();
    await page.setContent(PAGE);
    const items = await collectElementInventory(page);
    const byName = (name: string) => items.find((i) => i.name === name);

    expect(byName('Full name')).toMatchObject({ role: 'textbox', selector: '#full-name' });
    expect(byName('Search books')).toMatchObject({ role: 'textbox', selector: 'role=textbox[name="Search books"]' });
    expect(byName('promo_code')).toMatchObject({ role: 'textbox', selector: 'input[name="promo_code"]' });
    expect(byName('Country')).toMatchObject({ role: 'combobox', selector: 'select[name="country"]' });
    expect(byName('Save invoice')).toMatchObject({
      role: 'button',
      selector: '[data-testid="save-btn"]',
      testId: 'save-btn',
    });
    expect(byName('Close dialog')).toMatchObject({ role: 'button' });
    expect(byName('Get help')).toMatchObject({ role: 'link' });
    expect(byName('Hidden action')).toMatchObject({ visible: false });
    expect(byName('Disabled action')).toMatchObject({ enabled: false });

    // No hidden inputs, and nothing without a name or id to point at.
    expect(items.some((i) => i.nameAttribute === 'csrf')).toBe(false);
    expect(items.some((i) => i.name === '')).toBe(false);

    // Every visible element's selector finds exactly that element. (Role selectors skip hidden
    // elements, which is right: a plan must not target something a person can't see.)
    for (const item of items.filter((i) => i.visible)) {
      expect(await page.locator(item.selector).count(), item.selector).toBe(1);
    }
    await page.close();
  });
});
