import type { Page } from 'playwright';
import type { Finding, Breakpoint } from '@qa/types';
import { promises as fs } from 'fs';
import path from 'path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { couldNotVerifyFinding } from './could-not-verify.js';

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

/**
 * PNG file signature: 137 80 78 71 13 10 26 10 (89 50 4E 47 0D 0A 1A 0A).
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Reads PNG dimensions from the first 24 bytes of a buffer without decoding the image data.
 * Returns null if the buffer is not a valid PNG or is too short.
 */
export function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) {
    return null;
  }
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null;
  }
  if (buf.toString('ascii', 12, 16) !== 'IHDR') {
    return null;
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

/**
 * Maximum number of pixels allowed for visual diff comparison (e.g. 5000x5000 = 25 MP).
 * Each decoded RGBA image is 4 bytes per pixel (~100 MB), and comparing two images allocates
 * up to three copies (~300 MB) synchronously on the Node event loop.
 * Screens exceeding this limit are refused before decoding to avoid memory exhaustion and event loop stalls.
 */
export const MAX_VISUAL_DIFF_PIXELS = 25_000_000;

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
    if (!tokens || (!tokens.colors && !tokens.borderRadius && !tokens.fontSize)) {
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

          // 4. Font size & typography tokens (FR-6.6)
          if (toks.fontSize) {
            const fontTokenValues = Object.values(toks.fontSize).map((v) => v.trim().toLowerCase());
            if (toks.fontSize.base && (testId.includes('body') || testId.includes('text') || testId.includes('desc'))) {
              const fs = computed.fontSize;
              if (fs && fs.toLowerCase() !== toks.fontSize.base.toLowerCase()) {
                results.push({
                  testId,
                  selector: `[data-testid="${el.getAttribute('data-testid')}"]`,
                  styleProp: 'font-size',
                  actual: fs,
                  expected: toks.fontSize.base,
                });
              }
            } else if (
              (toks.fontSize.lg || toks.fontSize.xl) &&
              (testId.includes('heading') || testId.includes('title'))
            ) {
              const expectedFs = (toks.fontSize.lg || toks.fontSize.xl)!.toLowerCase();
              const fs = computed.fontSize;
              if (fs && fs.toLowerCase() !== expectedFs) {
                results.push({
                  testId,
                  selector: `[data-testid="${el.getAttribute('data-testid')}"]`,
                  styleProp: 'font-size',
                  actual: fs,
                  expected: expectedFs,
                });
              }
            } else {
              const fs = computed.fontSize;
              if (fs && fontTokenValues.length > 0 && !fontTokenValues.includes(fs.toLowerCase())) {
                results.push({
                  testId,
                  selector: `[data-testid="${el.getAttribute('data-testid')}"]`,
                  styleProp: 'font-size',
                  actual: fs,
                  expected: fontTokenValues.join(', '),
                });
              }
            }
          }
        }

        return results;
      }, tokens);

      for (const m of mismatches) {
        let isMismatch = false;
        if (m.styleProp === 'background-color') {
          const normActual = normalizeColor(m.actual);
          const normExpected = normalizeColor(m.expected);
          isMismatch = normActual !== normExpected;
        } else {
          isMismatch = m.actual.toLowerCase() !== m.expected.toLowerCase();
        }

        if (isMismatch) {
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
      // The page could not be read: say so, never read as a match.
      findings.push(couldNotVerifyFinding('design-standards', 'whether the page matches the design tokens', context));
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

    if (currentScreenshot.equals(baselineScreenshot)) {
      return { match: true, diffPercent: 0, diffPixels: 0, sizeMismatch: false };
    }

    const currentSize = pngSize(currentScreenshot);
    const baselineSize = pngSize(baselineScreenshot);
    if (
      !currentSize ||
      !baselineSize ||
      currentSize.width * currentSize.height > MAX_VISUAL_DIFF_PIXELS ||
      baselineSize.width * baselineSize.height > MAX_VISUAL_DIFF_PIXELS
    ) {
      return { match: false, diffPercent: 0, diffPixels: 0, sizeMismatch: false, tooLarge: true };
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
    if (result.tooLarge) {
      return couldNotVerifyFinding(
        'design-standards',
        'whether the page still matches its approved look (the screenshot is too large to compare)',
        {
          testCaseId: context.testCaseId,
          role: context.role,
          breakpoint: context.breakpoint,
          urlPath: context.urlPath,
        }
      );
    }

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
  /** Set to true when an image exceeds MAX_VISUAL_DIFF_PIXELS or is not a valid PNG. */
  tooLarge?: boolean;
  diffImagePath?: string;
}
