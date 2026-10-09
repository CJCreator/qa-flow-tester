import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import type { Finding } from '@qa/types';
import { KeyboardA11yChecker, detectTrap, type KeyboardA11yContext } from '../src/keyboard-a11y.js';

const ctx: KeyboardA11yContext = { testCaseId: 'TC1', role: 'guest', breakpoint: '1440px', urlPath: '/' };
const VIEWPORT = { width: 1280, height: 720 };

/** ADR 0018: no field of any finding claims the page is accessible, compliant or certified. */
function expectClaimWording(findings: Finding[]) {
  const banned = /\b(compliant|compliance|certified|secure|safe|hack-proof|accessible|passes WCAG)\b/i;
  for (const f of findings) expect(JSON.stringify(f)).not.toMatch(banned);
}
/** keyboard-a11y findings feed the Accessible aspect through checker 'ux-quality'. */
const aspectOfFinding = (f: Finding) => (f.checker === 'ux-quality' ? 'Accessible' : 'other');

describe('detectTrap (pure)', () => {
  const cycleOf = (n: number, len = 24) => Array.from({ length: len }, (_, i) => ({ idx: i % n }));
  it('detects a small cycle while more elements exist', () => {
    expect(detectTrap(cycleOf(3), 10)).toEqual({ trapped: true, cycle: [0, 1, 2] });
  });
  it('is not a trap when every focusable element is in the cycle', () => {
    expect(detectTrap(cycleOf(3), 3).trapped).toBe(false);
  });
  it('is not a trap with too few stops or a large spread', () => {
    expect(detectTrap(cycleOf(3, 10), 10).trapped).toBe(false);
    expect(detectTrap(cycleOf(12), 30).trapped).toBe(false);
  });
});

describe('KeyboardA11yChecker (browser)', () => {
  let browser: Browser;
  const checker = new KeyboardA11yChecker();
  beforeAll(async () => {
    browser = await chromium.launch();
  }, 60_000);
  afterAll(async () => {
    await browser.close();
  });
  async function open(html: string): Promise<Page> {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.setContent(html);
    return page;
  }

  describe('keyboard traversal', () => {
    it('flags a div role=button with no tabindex', async () => {
      const page = await open('<div role="button" data-testid="fake">Save</div><button>Real</button>');
      const f = await checker.checkKeyboardTraversal(page, ctx);
      await page.close();
      expect(f).toHaveLength(1);
      expect(f[0].where.cssSelector).toBe('[data-testid="fake"]');
      expect(f[0].severity).toBe('Minor');
      expect(f[0].needsConfirmation).toBeUndefined();
      expect(f[0].expectedVsActual.actual).toContain('WCAG 2.1.1 Keyboard');
      expect(f[0].expectedVsActual.actual).toContain('automatic check only');
      expect(aspectOfFinding(f[0])).toBe('Accessible');
      expectClaimWording(f);
    });

    it('a page of real buttons and links gives no finding', async () => {
      const page = await open(
        '<button>A</button><a href="/x">B</a><div role="button" tabindex="0">C</div>' +
          '<div role="tablist"><span role="tab" tabindex="-1">T</span></div><button disabled>D</button>'
      );
      const f = await checker.checkKeyboardTraversal(page, ctx);
      await page.close();
      expect(f).toEqual([]);
    });

    it('onclick-only div is needsConfirmation', async () => {
      const page = await open('<div onclick="void 0" id="clicky">Click me</div>');
      const f = await checker.checkKeyboardTraversal(page, ctx);
      await page.close();
      expect(f).toHaveLength(1);
      expect(f[0].needsConfirmation).toBe(true);
      expect(f[0].where.cssSelector).toBe('#clicky');
      expectClaimWording(f);
    });
  });

  describe('safety', () => {
    it('walk presses only Tab and Escape, never Enter or Space', async () => {
      const page = await open(
        '<button>0</button><button>1</button><button>2</button><button>3</button><button>4</button>' +
          '<button>5</button><button>6</button><button>7</button><button>8</button><button>9</button>' +
          '<script>const c=[1,2,3].map(i=>document.querySelectorAll("button")[i]);' +
          'document.addEventListener("keydown",e=>{if(e.key==="Tab"){e.preventDefault();' +
          'const i=c.indexOf(document.activeElement);c[(i+1)%3].focus();}});</script>'
      );
      const pressed: string[] = [];
      const original = page.keyboard.press.bind(page.keyboard);
      page.keyboard.press = async (key: string, options?: { delay?: number }) => {
        pressed.push(key);
        return original(key, options);
      };
      const clicks: string[] = [];
      await page.exposeFunction('__noteClick', (s: string) => clicks.push(s));
      await page.evaluate(() =>
        document.addEventListener('click', () =>
          (window as never as { __noteClick: (s: string) => void }).__noteClick('click')
        )
      );
      await checker.checkKeyboard(page, ctx);
      await page.close();
      expect(pressed.length).toBeGreaterThan(0);
      expect(pressed.every((k) => k === 'Tab' || k === 'Escape')).toBe(true);
      expect(pressed.filter((k) => k === 'Escape').length).toBeLessThanOrEqual(1);
      expect(clicks).toEqual([]);
    });
  });

  describe('focus obscured', () => {
    it('flags a link fully under a fixed header', async () => {
      const page = await open(
        '<header style="position:fixed;top:0;left:0;width:100%;height:60px;background:#eee;z-index:10">Header</header>' +
          '<a href="#x" id="hidden-link" style="position:absolute;top:10px;left:10px;display:block;width:80px;height:20px">Link</a>' +
          '<div style="height:3000px"></div>'
      );
      const walk = await checker.walkTabOrder(page);
      const f = await checker.checkFocusObscured(page, ctx, walk.stops);
      await page.close();
      expect(f).toHaveLength(1);
      expect(f[0].where.cssSelector).toBe('#hidden-link');
      expect(f[0].expectedVsActual.actual).toContain('WCAG 2.4.11 Focus Not Obscured (Minimum)');
      expectClaimWording(f);
    });

    it('a link beside a sticky header is not flagged', async () => {
      const page = await open(
        '<header style="position:sticky;top:0;width:100px;height:60px;background:#eee">Header</header>' +
          '<a href="#x" style="position:absolute;top:10px;left:300px;display:block;width:80px;height:20px">Link</a>' +
          // Partly covered link: only some sample points are under the header, so it is not flagged.
          '<a href="#y" style="position:absolute;top:50px;left:10px;display:block;width:80px;height:40px">Half</a>'
      );
      const f = await checker.checkFocusObscured(page, ctx);
      await page.close();
      expect(f).toEqual([]);
    });
  });

  describe('focus trap', () => {
    const buttons = (n: number) => Array.from({ length: n }, (_, i) => `<button>${i}</button>`).join('');
    const cycleScript = (guard: string) =>
      `<script>const c=[1,2,3].map(i=>document.querySelectorAll("button")[i]);let released=false;` +
      `document.addEventListener("keydown",e=>{` +
      `if(e.key==="Escape"&&${guard}){released=true;document.activeElement.blur();return;}` +
      `if(e.key==="Tab"&&!released){e.preventDefault();const i=c.indexOf(document.activeElement);c[(i+1)%3].focus();}});</script>`;

    it('flags a focus cycle with no way out', async () => {
      const page = await open(buttons(8) + cycleScript('false'));
      const f = await checker.checkFocusTrap(page, ctx);
      await page.close();
      expect(f).toHaveLength(1);
      expect(f[0].title).toBe('Keyboard focus gets stuck in part of the page');
      expect(f[0].severity).toBe('Major');
      expect(f[0].expectedVsActual.actual).toContain('WCAG 2.1.2 No Keyboard Trap');
      expect(f[0].expectedVsActual.actual).toContain('automatic check only');
      expect(aspectOfFinding(f[0])).toBe('Accessible');
      expectClaimWording(f);
    });

    it('an open dialog trapping focus is not flagged', async () => {
      const page = await open(
        '<button>0</button><div role="dialog" aria-modal="true"><button>1</button><button>2</button><button>3</button></div>' +
          buttons(6) +
          cycleScript('false')
      );
      const f = await checker.checkFocusTrap(page, ctx);
      await page.close();
      expect(f).toEqual([]);
    });

    it('a trap that Escape releases is not flagged', async () => {
      const page = await open(buttons(8) + cycleScript('true'));
      const f = await checker.checkFocusTrap(page, ctx);
      await page.close();
      expect(f).toEqual([]);
    });

    it('a normal page that Tab walks through is not flagged', async () => {
      const page = await open(buttons(5));
      const f = await checker.checkFocusTrap(page, ctx);
      await page.close();
      expect(f).toEqual([]);
    });
  });

  describe('reflow at 320 px', () => {
    const withRestore = { ...ctx, restoreViewport: VIEWPORT };

    it('flags fixed-width 600px content at 320px', async () => {
      const page = await open('<div id="wide" style="width:600px;height:50px;background:#ccc">wide</div>');
      const f = await checker.checkReflow(page, withRestore);
      await page.close();
      expect(f).toHaveLength(1);
      expect(f[0].where.cssSelector).toBe('#wide');
      expect(f[0].expectedVsActual.actual).toContain('WCAG 1.4.10 Reflow');
      expectClaimWording(f);
    });

    it('responsive page gives no finding', async () => {
      const page = await open('<p style="max-width:100%">Short responsive text that wraps.</p>');
      const f = await checker.checkReflow(page, withRestore);
      await page.close();
      expect(f).toEqual([]);
    });

    it('wide data table in overflow-x:auto wrapper is not flagged', async () => {
      const page = await open(
        '<div style="overflow-x:auto"><table style="width:800px"><tr><td>a</td><td>b</td></tr></table></div>' +
          '<div style="overflow-x:auto"><div style="width:900px;height:20px">inner</div></div>'
      );
      const f = await checker.checkReflow(page, withRestore);
      await page.close();
      expect(f).toEqual([]);
    });

    it('viewport is restored afterwards', async () => {
      const page = await open('<div style="width:600px">wide</div>');
      await checker.checkReflow(page, withRestore);
      expect(page.viewportSize()).toEqual(VIEWPORT);
      await page.close();
    });
  });
});
