import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));
const src = (file: string) => readFileSync(join(SRC_DIR, file), 'utf8');

/** Every .ts and .tsx file under packages/wizard/src, as paths relative to src (forward slashes). */
function wizardFiles(dir = ''): string[] {
  return readdirSync(join(SRC_DIR, dir)).flatMap((name) => {
    const rel = dir ? `${dir}/${name}` : name;
    if (statSync(join(SRC_DIR, rel)).isDirectory()) return wizardFiles(rel);
    return /\.tsx?$/.test(name) ? [rel] : [];
  });
}

/** Glossary terms (CONTEXT.md "_Avoid_" lists) that must not show in UI text. Matched as whole words. */
const AVOID = [
  'scan',
  'scans',
  'scanning',
  'sandbox',
  'staging',
  'test host',
  'competitor',
  'pentest',
  'attack',
  'test case',
  'quota',
  'token budget',
  'draft',
  'prompt',
  'triage',
  'sign-off',
  'guardrail',
  'risky button',
  'danger action',
  'canary',
  'smoke test',
  'pixel diff',
  'login page',
  'auth wall',
  'persona',
  'template',
  'bug ticket',
  'crawl log',
  'request log',
];

/**
 * Lines that are allowed to contain an avoid term. Each entry is a file and a fragment of the line.
 * plan-sources.ts: "Added after the scan" is asserted by plan-sources-view.test.ts (an existing test, not edited here).
 */
const ALLOWED: Array<{ file: string; fragment: string }> = [
  { file: 'lib/plan-sources.ts', fragment: 'the scan' },
  // Asserted by existing tests (plan-sources-view.test.ts, signin-form.test.ts), not edited here.
  { file: 'lib/plan-sources.ts', fragment: 'Planned while scanning' },
  { file: 'lib/form.ts', fragment: 'to scan with sign-in' },
  // Search aliases, never shown.
  { file: 'components/CommandPalette.tsx', fragment: 'keywords: [' },
];

/**
 * Code, not text: route and phase identifiers ('scan', 'scanning'), the triage handlers, the staging-host
 * pattern the form uses to spot a pre-release address, and form field names. They stay as they are in code.
 */
const CODE_ONLY =
  /'(scan|scanning)'|PATHS\.scan|\bscan: '|\bsetScan\b|\bscan\?\.|progress=\{scan\}|ScanProgress|\bconst triage\b|onTriage=\{triage\}|\/triage`|\(staging\||template\.replace|name="competitor-/;

/** The UI-text lines of a file: code-only lines (imports, class names, comments, identifiers) are skipped. */
function uiLines(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => !/^\s*(import |\/\/|\*|\/\*)/.test(line))
    .filter((line) => !/className=|data-testid|aria-describedby|htmlFor|id=|\bfrom '/.test(line));
}

describe('T-62: copy follows the glossary', () => {
  it('no avoid-list term in wizard UI text, except the allow list', () => {
    const pattern = new RegExp(
      `\\b(${AVOID.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
      'i'
    );
    const hits: string[] = [];
    for (const file of wizardFiles()) {
      for (const line of uiLines(src(file))) {
        if (!pattern.test(line)) continue;
        if (CODE_ONLY.test(line)) continue;
        if (ALLOWED.some((a) => a.file === file && line.includes(a.fragment))) continue;
        hits.push(`${file}: ${line.trim()}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the Visual Baselines search does not call a Plan Item a test', () => {
    expect(src('screens/VisualBaselinesScreen.tsx')).not.toContain('Search test');
  });
});

describe('T-62: phone gutter and landmarks', () => {
  it('Landing header uses the 16 px gutter (px-4) on phones', () => {
    expect(src('screens/LandingScreen.tsx')).toMatch(/max-w-6xl[^"]*\bpx-4 py-1 sm:gap-x-4 sm:px-6/);
  });

  it('Landing has one main landmark (LandingRoot), not a second one', () => {
    expect(src('screens/LandingScreen.tsx')).not.toMatch(/<main[\s>]/);
  });
});

describe('T-62: disabled controls say why', () => {
  it('KeyField shows the reason when Save is off', () => {
    const text = src('components/KeyField.tsx');
    expect(text).toContain('Paste your key first.');
    expect(text).toContain('The key has to work before it can be saved.');
  });

  it('Benchmark shows the reason when Compare is off', () => {
    expect(src('screens/BenchmarkScreen.tsx')).toContain('Enter both addresses to compare them.');
  });

  it('New check-up shows the reason when Start is off', () => {
    expect(src('screens/NewCheckupScreen.tsx')).toMatch(/const startOffReason/);
  });
});

describe('T-62: number fields', () => {
  it('Max pages keeps the typed text, so the field can be cleared', () => {
    const text = src('screens/NewCheckupScreen.tsx');
    expect(text).toMatch(/onChange=\{\(e\) => setMaxPagesText\(e\.target\.value\)\}/);
  });

  it('Enter on Max pages commits the typed value, not the last saved one', () => {
    const text = src('screens/NewCheckupScreen.tsx');
    expect(text).toMatch(/const commitMaxPages = \(\) => \{\s*const n = clampMaxPages\(maxPagesText\);/);
    expect(text).toMatch(/if \(e\.key !== 'Enter'\) return;\s*e\.preventDefault\(\);\s*commitMaxPages\(\);/);
  });

  it('the crawl numbers can be cleared and are clamped on leaving the box', () => {
    const text = src('screens/NewCheckupScreen.tsx');
    expect(text).toMatch(/if \(e\.target\.value\.trim\(\)\) \{/);
    expect(text).toMatch(/onBlur=\{\(\) => \{\s*const val = clampTo\(crawlText\.pages, 1, 5, 2\);/);
  });
});

describe('T-62: stale address check', () => {
  it('Start needs a check of the address as it is now', () => {
    const text = src('screens/NewCheckupScreen.tsx');
    expect(text).toMatch(/const checkIsCurrent = addressNow\.ok && check\.state === 'ok' && check\.url === addressNow\.url;/);
    expect(text).toMatch(/const start = \(\) => \{\s*if \(check\.state !== 'ok' \|\| !kind \|\| !canStart\) return;/);
  });
});

describe('T-62: edits and errors', () => {
  it('a failed wording change keeps the typed text (the form closes only on success)', () => {
    expect(src('components/plan/PlanDocument.tsx')).toMatch(/\.then\(\(saved\) => saved && setEditing\(false\)\)/);
    expect(src('screens/PlanReviewScreen.tsx')).toMatch(/setExpectation: \(itemId, text\) => edit\(/);
  });

  it('Benchmark poll errors go through plainError, not a raw message', () => {
    const text = src('screens/BenchmarkScreen.tsx');
    expect(text).toContain("plainError(err, 'Lost track of the comparison.");
    expect(text).not.toContain('err.message');
  });
});
