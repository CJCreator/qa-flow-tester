import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HOME_FAQ } from '../src/lib/faq';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('privacy wording', () => {
  it('no claim that nothing leaves the machine without naming the AI', () => {
    const files = [
      '../src/lib/faq.ts',
      '../index.html',
      '../src/screens/LandingScreen.tsx',
      '../src/screens/ConnectionScreen.tsx',
    ];
    const pattern = /nothing leaves your machine|everything stays on your machine|stay with you/i;
    let matchCount = 0;
    for (const rel of files) {
      const text = read(rel);
      const lines = text.split('\n');
      for (const line of lines) {
        if (pattern.test(line)) {
          matchCount++;
          expect(line, `${rel} matching line should mention AI`).toContain('AI');
        }
      }
    }
    expect(matchCount).toBeGreaterThan(0);
  });

  it('the FAQ structured data matches the visible FAQ', () => {
    const html = read('../index.html');
    const scriptRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let faqPage: any = null;

    let match;
    while ((match = scriptRegex.exec(html)) !== null) {
      const data = JSON.parse(match[1]);
      if (data['@type'] === 'FAQPage') {
        faqPage = data;
        break;
      }
      if (Array.isArray(data['@graph'])) {
        const found = data['@graph'].find((item: any) => item['@type'] === 'FAQPage');
        if (found) {
          faqPage = found;
          break;
        }
      }
    }

    expect(faqPage, 'FAQPage block not found in index.html').not.toBeNull();
    const ldQuestions = new Map<string, string>();
    for (const entity of faqPage.mainEntity) {
      ldQuestions.set(entity.name, entity.acceptedAnswer.text);
    }

    expect(ldQuestions.size).toBe(HOME_FAQ.length);
    for (const faq of HOME_FAQ) {
      expect(ldQuestions.get(faq.q)).toBe(faq.a);
    }
  });

  it('PRIVACY.md covers Google sign-in, Website Audits and schedules', () => {
    const privacy = read('../../../PRIVACY.md');
    expect(privacy).toContain('## Signing in with Google (owners and Helpers)');
    expect(privacy).toContain('## Website Audits on the shared online copy');
    expect(privacy).toContain('## Scheduled Check-ups');
    expect(privacy).toContain('30 days');
    expect(privacy).toContain('8 hours');
  });
});
