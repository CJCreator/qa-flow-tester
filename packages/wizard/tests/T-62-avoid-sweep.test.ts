import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// T-62: "check" as a verb or a Check-up synonym is on the CONTEXT.md avoid list in UI text.
// Each old phrase below was a user-visible string; none may come back in the files that carry them.
const FILES = [
  '../src/api.ts',
  '../src/lib/translate.ts',
  '../src/lib/context.ts',
  '../src/screens/PlanReviewScreen.tsx',
  '../src/components/plan/PlanDocument.tsx',
  '../src/screens/NewCheckupScreen.tsx',
  '../src/screens/SettingsScreen.tsx',
];

const OLD_PHRASES = [
  'Check that it’s still running',
  'Check the site is working',
  'Check the address, for example',
  'Check both addresses',
  'while checking that address',
  'then check again',
  'Check the plan, then try again',
  'Check it has headings',
  'Check your AI key still works',
  'Check the link: ',
  'Run Preset',
  'Quick check (faster)',
  'Checking the address…',
  'Check again',
  'Checking…',
  'check the open invoices',
  'to check the details work',
  'Checking your site is up',
  'the check stopped',
  'spec override',
  'The address couldn’t be checked',
  'The Verified Domain line couldn’t be checked',
  'site to check</Question>',
  'Only public sites can be checked',
  'nothing here to check',
  'you’ve checked.',
  'was checked a moment ago',
];

const NEW_PHRASES: Record<string, string> = {
  '../src/api.ts': 'Make sure it’s still running in its terminal',
  '../src/lib/translate.ts': 'Make sure your AI key still works in Settings',
  '../src/lib/context.ts': 'Make sure it has headings, lists or tables.',
  '../src/screens/PlanReviewScreen.tsx': 'Look over the plan, then try again.',
  '../src/components/plan/PlanDocument.tsx': 'label={`Navigation Check: ${nav.name}`}',
  '../src/screens/NewCheckupScreen.tsx': 'Look again',
  '../src/screens/SettingsScreen.tsx': 'Check-up preset',
};

describe('T-62 avoid-list sweep in wizard UI copy', () => {
  for (const file of FILES) {
    it(`${file} carries no old avoid-list copy`, () => {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      for (const phrase of OLD_PHRASES) {
        expect(source.includes(phrase), `${file}: "${phrase}"`).toBe(false);
      }
    });
  }

  for (const [file, phrase] of Object.entries(NEW_PHRASES)) {
    it(`${file} carries the replacement copy`, () => {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source.includes(phrase), file).toBe(true);
    });
  }
});
