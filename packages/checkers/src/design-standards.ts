import type { Page } from 'playwright';
import type { Finding, Breakpoint } from '@qa/types';
import { promises as fs } from 'fs';
import path from 'path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface DesignTokens {
  colors?: Record<string, string>; // e.g. { "primary": "#2563eb", "danger": "#ef4444" }
  borderRadius?: Record<string, string>; // e.g. { "sm": "4px", "md": "8px", "lg": "12px" }
  fontSize?: Record<string, string>; // e.g. { "base": "16px", "lg": "18px" }
}

export function hexToRgb(hex: string): string | null {
  const cleanHex = hex.trim().replace(/^#/, '');
  if (cleanHex.length === 3) {
    const r = parseInt(cleanHex[0] + cleanHex[0], 16);
    const g = parseInt(cleanHex[1] + cleanHex[1], 16);
    const b = parseInt(cleanHex[2] + cleanHex[2], 16);
    return `rgb(${r}, ${g}, ${b})`;
  }
  if (cleanHex.length === 6) {
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return `rgb(${r}, ${g}, ${b})`;
  }
  return null;
}

export function normalizeColor(val: string): string {
  const trimmed = val.trim().toLowerCase();
  if (trimmed.startsWith('#')) {
    const rgb = hexToRgb(trimmed);
    return rgb || trimmed;
  }
  // Standardize spaces in rgb/rgba: rgb(37, 99, 235) vs rgb(37,99,235)
  return trimmed.replace(/\s*,\s*/g, ', ');
}

export class DesignStandardsChecker {
  /**
   * Tier 1: Deterministic Computed CSS Design Token Check
   */
  async check(
    page: Page,
    tokens: DesignTokens,
    context: {
      testCaseId?: string;
      role: string;
      breakpoint: Breakpoint;
      urlPath: string;
    }
  ): Promise<Finding[]> {
    const findings: Finding[] = [];
    if (!tokens || (!tokens.colors && !tokens.borderRadius)) {
      return findings;
    }

    let counter = 1;

    try {
      const mismatches = await page.evaluate((toks) => {
        const results: Array<{
          testId: string;
          selector: string;
          styleProp: string;
          actual: string;
          expected: string;
        }> = [];

        const elements = Array.from(document.querySelectorAll('[data-testid]'));

        for (const el of elements) {
          const testId = (el.getAttribute('data-testid') || '').toLowerCase();
          const computed = window.getComputedStyle(el);

          // 1. Primary button color
          if (toks.colors?.primary && (testId.includes('primary') || testId.includes('submit'))) {
            const bg = computed.backgroundColor;
            if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
              results.push({
                testId,
                selector: `[data-testid="${el.getAttribute('data-testid')}"]`,
                styleProp: 'background-color',
                actual: bg,
                expected: toks.colors.primary,
              });
            }
          }

          // 2. Danger button color
          if (toks.colors?.danger && (testId.includes('danger') || testId.includes('delete'))) {
            const bg = computed.backgroundColor;
            if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
              results.push({
                testId,
                selector: `[data-testid="${el.getAttribute('data-testid')}"]`,
                styleProp: 'background-color',
                actual: bg,
                expected: toks.colors.danger,
              });
            }
          }

          // 3. Border radius
          if (
            toks.borderRadius?.md &&
            (testId.includes('card') || testId.includes('btn') || testId.includes('button'))
          ) {
            const br = computed.borderRadius;
            if (br && br !== '0px') {
              results.push({
                testId,
                selector: `[data-testid="${el.getAttribute('data-testid')}"]`,
                styleProp: 'border-radius',
                actual: br,
                expected: toks.borderRadius.md,
              });
            }
          }
        }

        return results;
      }, tokens);

      for (const m of mismatches) {
        const normActual = normalizeColor(m.actual);
        const normExpected = normalizeColor(m.expected);

        if (normActual !== normExpected) {
          findings.push({
            id: `F-DESIGN-${context.testCaseId || 'TOK'}-${counter++}`,
            testCaseId: context.testCaseId,
            severity: 'Minor',
            checker: 'design-standards',
            title: `Design Token Mismatch: ${m.styleProp} on ${m.testId}`,
            where: {
              urlPath: context.urlPath,
              role: context.role,
              breakpoint: context.breakpoint,
              dataTestId: m.testId,
              cssSelector: m.selector,
            },
            expectedVsActual: {
              expected: `${m.styleProp}: ${m.expected}`,
              actual: `${m.styleProp}: ${m.actual}`,
            },
            stepsToReproduce: [
              `Navigate to ${context.urlPath} at ${context.breakpoint}`,
              `Inspect computed style of element: ${m.selector}`,
            ],
            evidence: {},
            resolution: `Update CSS or Tailwind class for ${m.selector} to match design token ${m.expected}.`,
          });
        }
      }
    } catch {
      // Ignore evaluation errors
    }

    return findings;
  }

  /**
   * Tier 2: Perceptual Visual Diff Checker.
   * Decodes both PNGs and compares them with pixelmatch (YIQ perceptual distance,
   * anti-aliased pixels ignored). A size mismatch is a full mismatch because
   * layout shifted. When `diffOutputPath` is given, a highlighted diff image is written.
   */
  async checkVisualDiff(
    currentScreenshot: Buffer,
    baselineScreenshot: Buffer,
    options: { threshold?: number; maxDiffPercent?: number; diffOutputPath?: string } = {}
  ): Promise<VisualDiffResult> {
    const maxDiff = options.maxDiffPercent ?? 0.01; // 1% of pixels

    if (currentScreenshot.length === 0 || baselineScreenshot.length === 0) {
      return { match: false, diffPercent: 1.0, diffPixels: 0, sizeMismatch: false };
    }
    if (currentScreenshot.equals(baselineScreenshot)) {
      return { match: true, diffPercent: 0, diffPixels: 0, sizeMismatch: false };
    }

    const current = PNG.sync.read(currentScreenshot);
    const baseline = PNG.sync.read(baselineScreenshot);
    if (current.width !== baseline.width || current.height !== baseline.height) {
      return { match: false, diffPercent: 1.0, diffPixels: 0, sizeMismatch: true };
    }

    const { width, height } = current;
    const diff = new PNG({ width, height });
    const diffPixels = pixelmatch(current.data, baseline.data, diff.data, width, height, {
      threshold: options.threshold ?? 0.1,
      includeAA: false,
    });
    const diffPercent = diffPixels / (width * height);

    let diffImagePath: string | undefined;
    if (options.diffOutputPath && diffPixels > 0) {
      await fs.mkdir(path.dirname(options.diffOutputPath), { recursive: true });
      await fs.writeFile(options.diffOutputPath, PNG.sync.write(diff));
      diffImagePath = options.diffOutputPath;
    }

    return { match: diffPercent <= maxDiff, diffPercent, diffPixels, sizeMismatch: false, diffImagePath };
  }

  visualDiffFinding(
    result: VisualDiffResult,
    context: {
      testCaseId: string;
      role: string;
      breakpoint: Breakpoint;
      urlPath: string;
      baselinePath: string;
      baselineImagePath?: string;
      currentImagePath?: string;
    }
  ): Finding {
    const id = `F-VISUAL-${context.testCaseId}-${context.breakpoint}`;
    const actual = result.sizeMismatch
      ? 'Screenshot dimensions differ from baseline (layout shift)'
      : `${(result.diffPercent * 100).toFixed(2)}% of pixels differ (${result.diffPixels} px)`;
    return {
      id,
      testCaseId: context.testCaseId,
      severity: 'Minor',
      checker: 'design-standards',
      title: `Visual regression against baseline at ${context.breakpoint}`,
      where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
      expectedVsActual: { expected: `Matches approved baseline ${context.baselinePath}`, actual },
      stepsToReproduce: [
        `Run test case ${context.testCaseId} as ${context.role} at ${context.breakpoint}`,
        `Compare the final screen against ${context.baselinePath}`,
      ],
      evidence: {
        screenshotPath: result.diffImagePath,
        ...(context.baselineImagePath ? { baselineScreenshotPath: context.baselineImagePath } : {}),
        ...(context.currentImagePath ? { currentScreenshotPath: context.currentImagePath } : {}),
      },
      resolution:
        'If the change is intended, approve the new look under Visual Baselines in the app; otherwise fix the regressed styles.',
    };
  }
}

export interface VisualDiffResult {
  match: boolean;
  /** Fraction of pixels (0–1) that differ perceptually. */
  diffPercent: number;
  diffPixels: number;
  sizeMismatch: boolean;
  diffImagePath?: string;
}
