import type { BrowserContext } from 'playwright';
import type { Breakpoint, ElementInventoryItem, PageInventoryItem } from '@qa/types';
import { collectElementInventory } from '../discovery/element-inventory.js';

/** Sizes where sites commonly fold their header menu behind a button: phones, and tablets (many fold below about 1,000 px). */
export const NARROW_SIZES: Breakpoint[] = ['375px', '768px'];

const MENU_WORDS = /\bmenu\b|navigation|\bnav\b|hamburger|☰|≡|toggle/i;

/** The header and menu links that make a page's menu: pages with the same ones share it. */
function menuSignature(page: PageInventoryItem): string {
  return (page.links || [])
    .filter((l) => l.landmark === 'header' || l.landmark === 'nav')
    .map((l) => l.selector)
    .sort()
    .join('\n');
}

/** The button that shows a folded menu: named like a menu, or an open/close control in the header. */
function findMenuButton(elements: ElementInventoryItem[]): ElementInventoryItem | undefined {
  const candidates = elements.filter((el) => el.visible && el.enabled && (el.role === 'button' || el.toggles));
  return (
    candidates.find((el) => MENU_WORDS.test(el.name)) ??
    candidates.find((el) => el.toggles && (el.landmark === 'header' || el.landmark === 'nav'))
  );
}

/**
 * Looks at the site's menus at narrow screen sizes, once per distinct menu. It marks, in place,
 * which menu links are hidden at each size (`hiddenAt` on the page's links) and the button that
 * shows them (`narrowMenus` on the page), for every page that shares the menu.
 */
export async function lookAtNarrowScreens(
  pages: PageInventoryItem[],
  options: {
    baseUrl: string;
    /** A browser context at this screen size, signed in as someone who reaches the page. */
    openContext: (size: Breakpoint, page: PageInventoryItem) => Promise<BrowserContext>;
    /** Waits before each page load, to go easy on sites we don't own. */
    pause?: () => Promise<void>;
  }
): Promise<void> {
  const bySignature = new Map<string, PageInventoryItem[]>();
  for (const page of pages) {
    const signature = menuSignature(page);
    if (signature) bySignature.set(signature, [...(bySignature.get(signature) ?? []), page]);
  }

  for (const sharing of bySignature.values()) {
    const representative = sharing[0];
    for (const size of NARROW_SIZES) {
      let context: BrowserContext | undefined;
      try {
        await options.pause?.();
        context = await options.openContext(size, representative);
        const tab = await context.newPage();
        await tab.goto(new URL(representative.urlPath, options.baseUrl).toString(), {
          waitUntil: 'domcontentloaded',
          timeout: 10000,
        });
        const elements = await collectElementInventory(tab);
        const visible = new Set(elements.filter((el) => el.visible).map((el) => el.selector));
        const hidden = new Set(
          (representative.links || [])
            .filter((l) => (l.landmark === 'header' || l.landmark === 'nav') && !visible.has(l.selector))
            .map((l) => l.selector)
        );
        if (hidden.size === 0) continue;
        const button = findMenuButton(elements);
        for (const page of sharing) {
          for (const link of page.links || []) {
            if (hidden.has(link.selector)) link.hiddenAt = [...new Set([...(link.hiddenAt || []), size])];
          }
          if (button) {
            page.narrowMenus = [
              ...(page.narrowMenus || []).filter((m) => m.breakpoint !== size),
              { breakpoint: size, selector: button.selector, name: button.name || 'Menu' },
            ];
          }
        }
      } catch {
        // Couldn't look at this size: the menu's links are checked as they are.
      } finally {
        await context?.close().catch(() => {});
      }
    }
  }
}
