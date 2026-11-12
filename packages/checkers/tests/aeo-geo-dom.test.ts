import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { AeoChecker } from '../src/aeo.js';
import { GeoChecker } from '../src/geo.js';

describe('AEO and GEO DOM Extraction (Browser Tier)', () => {
  let browser: Browser;
  const aeoChecker = new AeoChecker();
  const geoChecker = new GeoChecker();

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  async function withPage<T>(html: string, fn: (page: Page) => Promise<T>): Promise<T> {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.setContent(html);
      return await fn(page);
    } finally {
      await context.close();
    }
  }

  describe('AEO DOM Heading & DIV Answer Extraction', () => {
    it('extracts answer from a P tag following a question heading', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <h2>How do I reset my password?</h2>
            <p>To reset your password, navigate to settings and click the reset button to receive an email.</p>
          </body>
        </html>
      `;
      await withPage(html, async (page) => {
        const details = await (aeoChecker as any).collectDetails(page);
        expect(details.questionHeadings).toHaveLength(1);
        const qh = details.questionHeadings[0];
        expect(qh.text).toBe('How do I reset my password?');
        expect(qh.hasAnswerParagraph).toBe(true);
        expect(qh.answerIsStructured).toBe(false);
        expect(qh.nextParagraphWordCount).toBeGreaterThan(10);
      });
    });

    it('counts DIV as answer when under 600 characters and containing no heading', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <h2>How do I update my profile details?</h2>
            <div class="answer-box">
              Open your user profile, update your preferred username and email address, and click save.
            </div>
          </body>
        </html>
      `;
      await withPage(html, async (page) => {
        const details = await (aeoChecker as any).collectDetails(page);
        expect(details.questionHeadings).toHaveLength(1);
        const qh = details.questionHeadings[0];
        expect(qh.text).toBe('How do I update my profile details?');
        expect(qh.hasAnswerParagraph).toBe(true);
        expect(qh.answerIsStructured).toBe(false);
        expect(qh.nextParagraphWordCount).toBe(14);
      });
    });

    it('treats DIV containing an inner heading as a layout wrapper (no answer)', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <h2>Why should you choose our platform?</h2>
            <div class="layout-wrapper">
              <h3>Feature Overview</h3>
              <p>We provide enterprise-grade reliability and automated tests.</p>
            </div>
          </body>
        </html>
      `;
      await withPage(html, async (page) => {
        const details = await (aeoChecker as any).collectDetails(page);
        expect(details.questionHeadings).toHaveLength(1);
        const qh = details.questionHeadings[0];
        expect(qh.text).toBe('Why should you choose our platform?');
        expect(qh.hasAnswerParagraph).toBe(false);
        expect(qh.nextParagraphWordCount).toBe(0);
      });
    });

    it('treats DIV >= 600 characters as a layout wrapper (no answer)', async () => {
      const longText = 'word '.repeat(130); // ~650 chars
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <h2>What is the comprehensive refund policy?</h2>
            <div class="long-container">${longText}</div>
          </body>
        </html>
      `;
      await withPage(html, async (page) => {
        const details = await (aeoChecker as any).collectDetails(page);
        expect(details.questionHeadings).toHaveLength(1);
        const qh = details.questionHeadings[0];
        expect(qh.text).toBe('What is the comprehensive refund policy?');
        expect(qh.hasAnswerParagraph).toBe(false);
        expect(qh.nextParagraphWordCount).toBe(0);
      });
    });

    it('starts from parent next element sibling when heading has no next sibling', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <header>
              <h2>How do I contact customer support?</h2>
            </header>
            <p>You can reach our dedicated customer support team anytime by sending an email or opening a ticket.</p>
          </body>
        </html>
      `;
      await withPage(html, async (page) => {
        const details = await (aeoChecker as any).collectDetails(page);
        expect(details.questionHeadings).toHaveLength(1);
        const qh = details.questionHeadings[0];
        expect(qh.text).toBe('How do I contact customer support?');
        expect(qh.hasAnswerParagraph).toBe(true);
        expect(qh.answerIsStructured).toBe(false);
        expect(qh.nextParagraphWordCount).toBe(17);
      });
    });

    it('starts from parent next sibling and accepts a DIV block answer', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <div class="title-wrap">
              <h2>Where can I download the client?</h2>
            </div>
            <div class="content-wrap">
              You can download the desktop client directly from the releases page on GitHub for Windows, Mac, or Linux.
            </div>
          </body>
        </html>
      `;
      await withPage(html, async (page) => {
        const details = await (aeoChecker as any).collectDetails(page);
        expect(details.questionHeadings).toHaveLength(1);
        const qh = details.questionHeadings[0];
        expect(qh.text).toBe('Where can I download the client?');
        expect(qh.hasAnswerParagraph).toBe(true);
        expect(qh.answerIsStructured).toBe(false);
        expect(qh.nextParagraphWordCount).toBe(18);
      });
    });

    it('marks structured lists and tables as answerIsStructured: true', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <h2>What payment methods are accepted?</h2>
            <ul>
              <li>Credit and debit cards (Visa, Mastercard, Amex)</li>
              <li>Bank wire transfers and SEPA payments</li>
              <li>Cryptocurrency payments via BitPay</li>
            </ul>
          </body>
        </html>
      `;
      await withPage(html, async (page) => {
        const details = await (aeoChecker as any).collectDetails(page);
        expect(details.questionHeadings).toHaveLength(1);
        const qh = details.questionHeadings[0];
        expect(qh.hasAnswerParagraph).toBe(true);
        expect(qh.answerIsStructured).toBe(true);
      });
    });
  });

  describe('AEO DOM details > summary Questions', () => {
    it('reads details > summary question followed by element sibling paragraph', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <details>
              <summary>How do I configure webhook alerts?</summary>
              <p>Go to the integrations tab in project settings, click add webhook, and enter your destination URL.</p>
            </details>
          </body>
        </html>
      `;
      await withPage(html, async (page) => {
        const details = await (aeoChecker as any).collectDetails(page);
        expect(details.questionHeadings).toHaveLength(1);
        const qh = details.questionHeadings[0];
        expect(qh.text).toBe('How do I configure webhook alerts?');
        expect(qh.hasAnswerParagraph).toBe(true);
        expect(qh.answerIsStructured).toBe(false);
        expect(qh.nextParagraphWordCount).toBe(16);
      });
    });

    it('reads details > summary question followed by element sibling list as structured', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <details>
              <summary>What steps are required to install?</summary>
              <ol>
                <li>Run pnpm install</li>
                <li>Run pnpm build</li>
              </ol>
            </details>
          </body>
        </html>
      `;
      await withPage(html, async (page) => {
        const details = await (aeoChecker as any).collectDetails(page);
        expect(details.questionHeadings).toHaveLength(1);
        const qh = details.questionHeadings[0];
        expect(qh.text).toBe('What steps are required to install?');
        expect(qh.hasAnswerParagraph).toBe(true);
        expect(qh.answerIsStructured).toBe(true);
      });
    });

    it('reads details > summary question when answer is direct text of details without element sibling', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <details>
              <summary>Why is two-factor authentication required?</summary>
              Two-factor authentication protects your account from unauthorized access by requiring a verification code upon login.
            </details>
          </body>
        </html>
      `;
      await withPage(html, async (page) => {
        const details = await (aeoChecker as any).collectDetails(page);
        expect(details.questionHeadings).toHaveLength(1);
        const qh = details.questionHeadings[0];
        expect(qh.text).toBe('Why is two-factor authentication required?');
        expect(qh.hasAnswerParagraph).toBe(true);
        expect(qh.answerIsStructured).toBe(false);
        expect(qh.nextParagraphWordCount).toBe(15);
      });
    });

    it('ignores details > summary when text is not a question', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <details>
              <summary>Account Preferences</summary>
              <p>Manage email notification settings and theme selection here.</p>
            </details>
          </body>
        </html>
      `;
      await withPage(html, async (page) => {
        const details = await (aeoChecker as any).collectDetails(page);
        expect(details.questionHeadings).toHaveLength(0);
      });
    });

    it('respects the cap of 5 question headings across headings and summaries', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <h2>How to step 1?</h2><p>Content for step one explanation here with enough words.</p>
            <h2>How to step 2?</h2><p>Content for step two explanation here with enough words.</p>
            <h2>How to step 3?</h2><p>Content for step three explanation here with enough words.</p>
            <details><summary>How to step 4?</summary><p>Content for step four explanation here with words.</p></details>
            <details><summary>How to step 5?</summary><p>Content for step five explanation here with words.</p></details>
            <details><summary>How to step 6?</summary><p>Content for step six explanation here with words.</p></details>
            <h2>How to step 7?</h2><p>Content for step seven explanation here with enough words.</p>
          </body>
        </html>
      `;
      await withPage(html, async (page) => {
        const details = await (aeoChecker as any).collectDetails(page);
        expect(details.questionHeadings).toHaveLength(5);
        expect(details.questionHeadings.map((q: any) => q.text)).toEqual([
          'How to step 1?',
          'How to step 2?',
          'How to step 3?',
          'How to step 4?',
          'How to step 5?',
        ]);
      });
    });
  });

  describe('GEO Author Class Word Matching', () => {
    it('detects class="author"', async () => {
      const html = '<main><div class="author">By Jane Doe</div></main>';
      await withPage(html, async (page) => {
        const details = await (geoChecker as any).collectDetails(page);
        expect(details.hasAuthorByline).toBe(true);
      });
    });

    it('detects class="byline"', async () => {
      const html = '<main><span class="byline">By Jane Doe</span></main>';
      await withPage(html, async (page) => {
        const details = await (geoChecker as any).collectDetails(page);
        expect(details.hasAuthorByline).toBe(true);
      });
    });

    it('detects prefixes like author- and author_', async () => {
      const html1 = '<main><span class="author-name">Jane Doe</span></main>';
      await withPage(html1, async (page) => {
        const details = await (geoChecker as any).collectDetails(page);
        expect(details.hasAuthorByline).toBe(true);
      });

      const html2 = '<main><span class="author_bio">Jane Doe</span></main>';
      await withPage(html2, async (page) => {
        const details = await (geoChecker as any).collectDetails(page);
        expect(details.hasAuthorByline).toBe(true);
      });
    });

    it('detects suffixes like -author and _author', async () => {
      const html1 = '<main><div class="article-author">Jane Doe</div></main>';
      await withPage(html1, async (page) => {
        const details = await (geoChecker as any).collectDetails(page);
        expect(details.hasAuthorByline).toBe(true);
      });

      const html2 = '<main><div class="post_author">Jane Doe</div></main>';
      await withPage(html2, async (page) => {
        const details = await (geoChecker as any).collectDetails(page);
        expect(details.hasAuthorByline).toBe(true);
      });
    });

    it('does NOT match authority or authorization', async () => {
      const html1 = '<main><div class="authority">Domain authority explanation</div></main>';
      await withPage(html1, async (page) => {
        const details = await (geoChecker as any).collectDetails(page);
        expect(details.hasAuthorByline).toBe(false);
      });

      const html2 = '<main><form class="authorization-form"><input type="text"/></form></main>';
      await withPage(html2, async (page) => {
        const details = await (geoChecker as any).collectDetails(page);
        expect(details.hasAuthorByline).toBe(false);
      });

      const html3 = '<main><p class="unauthorized-alert">Access denied</p></main>';
      await withPage(html3, async (page) => {
        const details = await (geoChecker as any).collectDetails(page);
        expect(details.hasAuthorByline).toBe(false);
      });
    });

    it('still detects rel="author", itemprop="author", and meta[name="author"]', async () => {
      const htmlRel = '<main><a href="/author/jane" rel="author">Jane</a></main>';
      await withPage(htmlRel, async (page) => {
        const details = await (geoChecker as any).collectDetails(page);
        expect(details.hasAuthorByline).toBe(true);
      });

      const htmlProp = '<main><span itemprop="author">Jane</span></main>';
      await withPage(htmlProp, async (page) => {
        const details = await (geoChecker as any).collectDetails(page);
        expect(details.hasAuthorByline).toBe(true);
      });

      const htmlMeta = '<html><head><meta name="author" content="Jane"></head><body><main>Content</main></body></html>';
      await withPage(htmlMeta, async (page) => {
        const details = await (geoChecker as any).collectDetails(page);
        expect(details.hasAuthorByline).toBe(true);
      });
    });
  });
});
