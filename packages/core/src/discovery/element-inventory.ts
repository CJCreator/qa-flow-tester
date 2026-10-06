import type { Page } from 'playwright';
import type { ElementInventoryItem } from '@qa/types';

/** Upper bound per page, so a huge page can't flood the AI prompt or the draft file. */
export const MAX_INVENTORY_ELEMENTS = 200;

/** Test-id attributes teams commonly use, in order of preference. */
export const TEST_ID_ATTRIBUTES = ['data-testid', 'data-test', 'data-cy', 'data-qa'];

const INTERACTIVE_SELECTOR = [
  'a[href]',
  // Script-driven links with no href, as single-page apps use (e.g. a cart icon).
  ...TEST_ID_ATTRIBUTES.map((attr) => `a:not([href])[${attr}]`),
  'a:not([href])[id]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="menuitem"]',
].join(', ');

/**
 * Lists the interactive elements on the current page with the name a person would use for each
 * (label, aria-label, visible text, placeholder) and a selector the runner can act on.
 */
export async function collectElementInventory(page: Page): Promise<ElementInventoryItem[]> {
  return page.evaluate(
    ({ selector, max, testIdAttributes }) => {
      const clean = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const cssIdent = /^[A-Za-z_][A-Za-z0-9_-]*$/;
      const quote = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

      const impliedRole = (el: Element): string => {
        const explicit = el.getAttribute('role');
        if (explicit) return explicit;
        const tag = el.tagName.toLowerCase();
        if (tag === 'a') return 'link';
        if (tag === 'button' || tag === 'summary') return 'button';
        if (tag === 'select') return 'combobox';
        if (tag === 'textarea') return 'textbox';
        if (tag === 'input') {
          const type = (el.getAttribute('type') || 'text').toLowerCase();
          if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
          if (type === 'checkbox') return 'checkbox';
          if (type === 'radio') return 'radio';
          if (type === 'range') return 'slider';
          if (type === 'number') return 'spinbutton';
          if (type === 'search') return 'searchbox';
          return 'textbox';
        }
        return tag;
      };

      const labelText = (el: Element): string => {
        const id = el.getAttribute('id');
        if (id) {
          const forLabel = document.querySelector(`label[for="${quote(id)}"]`);
          if (forLabel) return clean(forLabel.textContent);
        }
        const wrapping = el.closest('label');
        if (wrapping) {
          const copy = wrapping.cloneNode(true) as Element;
          copy.querySelectorAll('input, select, textarea').forEach((c) => c.remove());
          return clean(copy.textContent);
        }
        return '';
      };

      const accessibleName = (el: Element): string => {
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const text = labelledBy
            .split(/\s+/)
            .map((ref) => document.getElementById(ref)?.textContent || '')
            .join(' ');
          if (clean(text)) return clean(text);
        }
        const ariaLabel = clean(el.getAttribute('aria-label'));
        if (ariaLabel) return ariaLabel;

        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (tag === 'input' && ['submit', 'button', 'reset'].includes(type)) {
          return clean(el.getAttribute('value')) || (type === 'reset' ? 'Reset' : 'Submit');
        }
        if (tag === 'input' && type === 'image') return clean(el.getAttribute('alt'));
        if (['input', 'select', 'textarea'].includes(tag)) {
          return (
            labelText(el) ||
            clean(el.getAttribute('placeholder')) ||
            clean(el.getAttribute('title')) ||
            clean(el.getAttribute('name'))
          );
        }
        const text = clean((el as HTMLElement).innerText || el.textContent);
        if (text) return text;
        const img = el.querySelector('img[alt]');
        return clean(el.getAttribute('title')) || clean(img?.getAttribute('alt'));
      };

      const isUnique = (css: string) => {
        try {
          return document.querySelectorAll(css).length === 1;
        } catch {
          return false;
        }
      };

      const humanize = (s: string) => s.replace(/[-_]+/g, ' ').trim();

      // The header, menu or footer an element sits in: links there are usually the site's shared menus.
      const landmarkOf = (el: Element): 'header' | 'nav' | 'footer' | undefined => {
        const holder = el.closest('header, nav, footer, [role="banner"], [role="navigation"], [role="contentinfo"]');
        if (!holder) return undefined;
        const role = holder.getAttribute('role');
        const tag = holder.tagName.toLowerCase();
        if (tag === 'nav' || role === 'navigation') return 'nav';
        if (tag === 'footer' || role === 'contentinfo') return 'footer';
        return 'header';
      };

      const items: ElementInventoryItem[] = [];
      const seen = new Set<Element>();
      for (const el of Array.from(document.querySelectorAll(selector))) {
        if (items.length >= max) break;
        if (seen.has(el)) continue;
        seen.add(el);
        const tag = el.tagName.toLowerCase();
        const role = impliedRole(el);
        const testIdAttribute = testIdAttributes.find((attr) => el.hasAttribute(attr));
        const testId = testIdAttribute ? el.getAttribute(testIdAttribute) || undefined : undefined;
        const id = el.getAttribute('id') || undefined;
        const nameAttribute = el.getAttribute('name') || undefined;
        // An icon-only control still needs a name the AI and the report can use.
        const name = accessibleName(el) || humanize(testId || id || '');

        let stableSelector: string;
        if (testId) stableSelector = `[${testIdAttribute}="${quote(testId)}"]`;
        else if (id && cssIdent.test(id) && isUnique(`#${id}`)) stableSelector = `#${id}`;
        else if (nameAttribute && isUnique(`${tag}[name="${quote(nameAttribute)}"]`))
          stableSelector = `${tag}[name="${quote(nameAttribute)}"]`;
        else if (name) stableSelector = `role=${role}[name="${quote(name)}"]`;
        else continue; // Nothing a plan could reliably point at.

        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        const enabled = !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true';

        items.push({
          role,
          name,
          selector: stableSelector,
          tagName: tag,
          testId,
          id,
          nameAttribute,
          inputType: tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : undefined,
          href: tag === 'a' ? el.getAttribute('href') ?? undefined : undefined,
          insideForm: !!el.closest('form') || undefined,
          visible,
          enabled,
          landmark: landmarkOf(el),
          toggles: el.hasAttribute('aria-expanded') || el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-controls') || undefined,
          transient: !!el.closest('[data-transient="true"]') || undefined,
        });
      }
      return items;
    },
    { selector: INTERACTIVE_SELECTOR, max: MAX_INVENTORY_ELEMENTS, testIdAttributes: TEST_ID_ATTRIBUTES }
  );
}
