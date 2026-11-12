import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { MarketingChecker } from '../src/marketing.js';

const ctx = (urlPath = '/', siteWide = new Set<string>()) => ({
  role: 'visitor',
  breakpoint: '1440px' as const,
  urlPath,
  siteWide,
});

describe('Marketing heuristics (browser)', () => {
  let browser: Browser;
  const checker = new MarketingChecker();

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  async function check(html: string) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    try {
      await page.setContent(html);
      return await checker.checkPage(page, ctx('/'));
    } finally {
      await page.close();
    }
  }

  describe('call to action', () => {
    it('flags a button with non-CTA text like "Free shipping info"', async () => {
      const findings = await check('<button>Free shipping info</button>');
      expect(findings.some((f) => f.id.includes('-CTA-'))).toBe(true);
    });

    it('accepts <button>Get started</button>', async () => {
      const findings = await check('<button>Get started</button>');
      expect(findings.some((f) => f.id.includes('-CTA-'))).toBe(false);
    });

    it('accepts a link with class btn and text "Try it free"', async () => {
      const findings = await check('<a href="#" class="btn">Try it free</a>');
      expect(findings.some((f) => f.id.includes('-CTA-'))).toBe(false);
    });
  });

  describe('contact route', () => {
    it('flags a page whose only link is "Help"', async () => {
      const findings = await check('<a href="/help">Help</a>');
      expect(findings.some((f) => f.id.includes('-CONTACT-'))).toBe(true);
    });

    it('accepts mailto: link', async () => {
      const findings = await check('<a href="mailto:hello@example.com">Say hello</a>');
      expect(findings.some((f) => f.id.includes('-CONTACT-'))).toBe(false);
    });

    it('accepts a "Contact us" link', async () => {
      const findings = await check('<a href="/contact">Contact us</a>');
      expect(findings.some((f) => f.id.includes('-CONTACT-'))).toBe(false);
    });
  });

  describe('trust signals', () => {
    it('flags a page with a bare blockquote in an article and text "scored 3/5"', async () => {
      const findings = await check('<article><blockquote>A quote from someone</blockquote><p>scored 3/5</p></article>');
      expect(findings.some((f) => f.id.includes('-TRUST-'))).toBe(true);
    });

    it('accepts a page with a .testimonial block', async () => {
      const findings = await check('<div class="testimonial"><p>Our customers love this.</p></div>');
      expect(findings.some((f) => f.id.includes('-TRUST-'))).toBe(false);
    });

    it('accepts a blockquote inside an element with review or testimonial class/id', async () => {
      const findingsWithReview = await check(
        '<div class="review"><blockquote>Super useful product!</blockquote></div>'
      );
      expect(findingsWithReview.some((f) => f.id.includes('-TRUST-'))).toBe(false);
    });

    it('accepts strict rating text', async () => {
      const findingsRated = await check('<p>Rated 4.9 out of 5</p>');
      expect(findingsRated.some((f) => f.id.includes('-TRUST-'))).toBe(false);

      const findingsStars = await check('<p>5/5 stars</p>');
      expect(findingsStars.some((f) => f.id.includes('-TRUST-'))).toBe(false);
    });
  });

  describe('cookie notice', () => {
    it('flags a page with a 5,000-word article mentioning cookies and accept in a plain div', async () => {
      const articleWords = 'word '.repeat(5000);
      const findings = await check(
        `<script>window.dataLayer = [];</script><div>${articleWords} We use cookies and accept terms.</div>`
      );
      expect(findings.some((f) => f.id.includes('-COOKIE-'))).toBe(true);
    });

    it('accepts a fixed-position div saying "We use cookies. Accept"', async () => {
      const findings = await check(
        '<script>window.dataLayer = [];</script><div style="position: fixed; bottom: 0; left: 0; width: 100%; height: 50px;">We use cookies. Accept</div>'
      );
      expect(findings.some((f) => f.id.includes('-COOKIE-'))).toBe(false);
    });
  });
});
