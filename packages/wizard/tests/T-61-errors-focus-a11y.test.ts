import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { getShortcutsOn, plainError, RunnerError, saveShortcutsOn } from '../src/api';
import { trapTabIndex } from '../src/components/CommandPalette';

const src = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

/** Every wizard file T-61 owns for error text, focus and shortcuts. */
const OWNED_FILES = [
  'App.tsx',
  'api.ts',
  'screens/PlanReviewScreen.tsx',
  'components/plan/PlanDocument.tsx',
  'screens/ReportScreen.tsx',
  'screens/BenchmarkScreen.tsx',
  'components/ConfirmDialog.tsx',
  'screens/PastCheckupsScreen.tsx',
  'components/CommandPalette.tsx',
  'screens/LandingScreen.tsx',
  'components/TopBar.tsx',
];

describe('T-61: plainError sentence map', () => {
  it('shows a RunnerError sentence as it is', () => {
    expect(plainError(new RunnerError('The check-up couldn’t be started. Try again.'), 'fallback')).toBe(
      'The check-up couldn’t be started. Try again.'
    );
  });

  it('never shows a raw error message: any other error gets the fallback sentence', () => {
    expect(plainError(new TypeError('Cannot read properties of undefined'), 'Try again.')).toBe('Try again.');
    expect(plainError(new Error('Failed to fetch'), 'Try again.')).toBe('Try again.');
    expect(plainError('string', 'Try again.')).toBe('Try again.');
  });
});

describe('T-61: grep test, no raw err.message in owned files', () => {
  // The one allowed raw read is plainError itself, which shows a RunnerError sentence as it is.
  // The BenchmarkScreen poll exception is gone: T-59 moved it onto plainError.
  const ALLOWED = [{ file: 'api.ts', line: 'return err instanceof RunnerError ? err.message : fallback;' }];

  it('every err.message goes through plainError', () => {
    const offenders: string[] = [];
    for (const file of OWNED_FILES) {
      src(file)
        .split('\n')
        .forEach((line, i) => {
          if (!/\b(err|error)\.message\b/.test(line)) return;
          if (line.includes('plainError(')) return;
          if (ALLOWED.some((a) => a.file === file && line.trim() === a.line)) return;
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('the BenchmarkScreen poll no longer reads err.message raw', () => {
    const hits = src('screens/BenchmarkScreen.tsx')
      .split('\n')
      .filter((line) => line.trim() === '? err.message');
    expect(hits).toHaveLength(0);
  });
});

describe('T-61: focus after dialog close and delete', () => {
  it('ConfirmDialog gives focus back to the opener when it closes', () => {
    const file = src('components/ConfirmDialog.tsx');
    expect(file).toContain('openerRef.current = document.activeElement');
    expect(file).toContain('if (opener?.isConnected) opener.focus();');
  });

  it('PastCheckups moves focus to the next check-up after a delete, else the new check-up link', () => {
    const file = src('screens/PastCheckupsScreen.tsx');
    expect(file).toContain('data-delete-run={run.runId}');
    expect(file).toContain('data-new-checkup=""');
    expect(file).toContain('focusAfterDelete.current = next?.runId');
    expect(file).toContain("document.querySelector<HTMLElement>('[data-new-checkup]')");
  });

  it('new screens take focus on mount (Question / FocusHeading), so Stop lands on the next screen', () => {
    expect(src('components/text.tsx')).toContain('ref.current?.focus({ preventScroll: true });');
  });
});

describe('T-61: command palette is modal', () => {
  it('Tab wraps inside the palette at both ends', () => {
    // Forward from the last control goes to the first; back from the first goes to the last.
    expect(trapTabIndex(4, 3, false)).toBe(0);
    expect(trapTabIndex(4, 0, true)).toBe(3);
    expect(trapTabIndex(4, 1, false)).toBe(2);
    expect(trapTabIndex(4, 2, true)).toBe(1);
    // Focus outside the palette (-1) comes in at the first control on Tab.
    expect(trapTabIndex(4, -1, false)).toBe(0);
    expect(trapTabIndex(0, -1, false)).toBe(-1);
  });

  it('the palette keeps Tab inside its dialog', () => {
    const file = src('components/CommandPalette.tsx');
    expect(file).toContain("if (e.key !== 'Tab') return;");
    expect(file).toContain('e.preventDefault();');
    expect(file).toContain('trapTabIndex(controls.length, at, e.shiftKey)');
  });

  it('the palette returns focus to its opener on close', () => {
    const file = src('components/CommandPalette.tsx');
    expect(file).toContain('const opener = document.activeElement;');
    expect(file).toContain('if (opener instanceof HTMLElement && opener.isConnected) opener.focus();');
  });
});

describe('T-61: visible focus', () => {
  it('no focus:outline-none on the controls T-61 touched', () => {
    expect(src('screens/LandingScreen.tsx')).not.toMatch(/focus:outline-none/);
    expect(src('components/CommandPalette.tsx')).not.toMatch(/(^|\s)focus:outline-none/);
  });

  it('the region and the palette field show the global ring on keyboard focus', () => {
    expect(src('screens/LandingScreen.tsx')).toContain('focus-visible:ring-2 focus-visible:ring-stamp');
    expect(src('components/CommandPalette.tsx')).toContain('focus-visible:ring-2 focus-visible:ring-stamp');
  });
});

describe('T-61: Escape closes the mobile menu', () => {
  it('TopBar handles Escape while the menu is open and returns focus to its button', () => {
    const file = src('components/TopBar.tsx');
    expect(file).toContain('menuButtonRef.current?.focus();');
    expect(file).toContain('ref={menuButtonRef}');
    expect(file).toMatch(/if \(!menuOpen\) return;[\s\S]*?e\.key !== 'Escape'/);
  });
});

describe('T-61: single-key shortcuts can be turned off', () => {
  function stubStorage() {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  }

  it('on by default, and off after the person turns them off', () => {
    stubStorage();
    expect(getShortcutsOn()).toBe(true);
    saveShortcutsOn(false);
    expect(getShortcutsOn()).toBe(false);
    saveShortcutsOn(true);
    expect(getShortcutsOn()).toBe(true);
    vi.unstubAllGlobals();
  });

  it('the plan keys and the ? key both check the setting before acting', () => {
    expect(src('components/plan/PlanDocument.tsx')).toMatch(/if \(!getShortcutsOn\(\)\) return;/);
    expect(src('components/CommandPalette.tsx')).toContain("e.key === '?' && !isInput && !e.metaKey && !e.ctrlKey && getShortcutsOn()");
  });

  it('the palette cheatsheet has the switch', () => {
    expect(src('components/CommandPalette.tsx')).toContain('saveShortcutsOn(e.target.checked)');
  });
});
