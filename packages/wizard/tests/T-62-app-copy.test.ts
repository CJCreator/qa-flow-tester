import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

/** Glossary avoid-list terms (CONTEXT.md) that App.tsx UI text must not use. "check-up" is the glossary term and is allowed. */
const AVOID =
  /\b(scans?|scanning|runs?|products?|projects?|targets?|journeys?|scenarios?|personas?|spiders?|crawl|staging|sandbox|specs?)\b|\bcheck\b(?!-)/i;

/**
 * The UI-text candidates of a file: quoted text with a space in it, and JSX text lines.
 * Code, comments and template expressions (`${...}`) are skipped.
 */
function uiText(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    // Code, not text: switch cases and phase names are identifiers (the route is still called 'scan').
    if (/^\s*(case |default:|phase:)/.test(raw)) continue;
    if (/^\s*(import |\/\/|\*|\/\*)/.test(raw) || /className=|data-testid|aria-describedby|htmlFor|id=|\bfrom '/.test(raw)) {
      continue;
    }
    const line = raw.replace(/\$\{[^}]*\}/g, '');
    out.push(...(line.match(/'[^'\n]* [^'\n]*'|"[^"\n]* [^"\n]*"|`[^`\n]* [^`\n]*`/g) ?? []));
    const jsx = line.trim();
    if (/^[A-Za-z][^<>{}=;]* [^<>{}=;]*$/.test(jsx)) out.push(jsx);
  }
  return out;
}

describe('T-62: App copy follows the glossary', () => {
  it('no avoid-list term in App.tsx UI text', () => {
    expect(uiText(app).filter((t) => AVOID.test(t))).toEqual([]);
  });
});

describe('T-62: App landmarks', () => {
  it('App.tsx has one main landmark, not one nested inside a screen', () => {
    expect(app.match(/<main[\s>]/g) ?? []).toHaveLength(1);
  });
});
