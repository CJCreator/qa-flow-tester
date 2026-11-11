import { describe, it, expect } from 'vitest';
import { DesignStandardsChecker, MAX_VISUAL_DIFF_PIXELS, pngSize } from '../src/design-standards.js';
import { PNG } from 'pngjs';

describe('visual diff size cap and format check', () => {
  const checker = new DesignStandardsChecker();

  /** Solid-color PNG with an optional filled rectangle painted on top. */
  function makePng(
    width: number,
    height: number,
    bg: [number, number, number],
    rect?: { x: number; y: number; w: number; h: number; color: [number, number, number] }
  ): Buffer {
    const png = new PNG({ width, height });
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inRect = rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
        const [r, g, b] = inRect ? rect!.color : bg;
        const i = (y * width + x) * 4;
        png.data[i] = r;
        png.data[i + 1] = g;
        png.data[i + 2] = b;
        png.data[i + 3] = 255;
      }
    }
    return PNG.sync.write(png);
  }

  /** Constructs a raw 25-byte PNG header buffer with given dimensions and trailing byte. */
  function makePngHeader(width: number, height: number, trailingByte = 0): Buffer {
    const buf = Buffer.alloc(25);
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
    // IHDR chunk length: 13
    buf.writeUInt32BE(13, 8);
    // Chunk type: "IHDR"
    buf.write('IHDR', 12, 'ascii');
    // Dimensions
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
    buf[24] = trailingByte;
    return buf;
  }

  it('exports MAX_VISUAL_DIFF_PIXELS set to 25 million', () => {
    expect(MAX_VISUAL_DIFF_PIXELS).toBe(25_000_000);
  });

  it('pngSize extracts width and height from PNG header', () => {
    const header = makePngHeader(1440, 40_000);
    expect(pngSize(header)).toEqual({ width: 1440, height: 40_000 });
  });

  it('pngSize returns null for short or invalid buffers', () => {
    expect(pngSize(Buffer.alloc(10))).toBeNull();
    expect(pngSize(Buffer.from('not a png header at all!'))).toBeNull();
    const badIhdr = makePngHeader(100, 100);
    badIhdr.write('XXXX', 12, 'ascii');
    expect(pngSize(badIhdr)).toBeNull();
  });

  it('refuses oversized image (1440 x 40,000) before decoding without throwing', async () => {
    // 1440 * 40,000 = 57.6M pixels > MAX_VISUAL_DIFF_PIXELS (25M)
    const headerA = makePngHeader(1440, 40_000, 1);
    const headerB = makePngHeader(1440, 40_000, 2);

    // If checkVisualDiff tried to decode these incomplete headers, PNG.sync.read would throw.
    const result = await checker.checkVisualDiff(headerA, headerB);
    expect(result).toEqual({
      match: false,
      diffPercent: 0,
      diffPixels: 0,
      sizeMismatch: false,
      tooLarge: true,
    });
  });

  it('compares real small PNGs as before: match, mismatch, size mismatch', async () => {
    // Match
    const a = makePng(50, 50, [255, 255, 255]);
    const b = makePng(50, 50, [255, 255, 255]);
    const matchRes = await checker.checkVisualDiff(a, b);
    expect(matchRes.match).toBe(true);
    expect(matchRes.diffPercent).toBe(0);
    expect(matchRes.tooLarge).toBeUndefined();

    // Mismatch
    const baseline = makePng(100, 100, [255, 255, 255]);
    const current = makePng(100, 100, [255, 255, 255], {
      x: 0,
      y: 0,
      w: 20,
      h: 10,
      color: [220, 38, 38],
    });
    const mismatchRes = await checker.checkVisualDiff(current, baseline, { maxDiffPercent: 0.01 });
    expect(mismatchRes.match).toBe(false);
    expect(mismatchRes.diffPixels).toBe(200);
    expect(mismatchRes.diffPercent).toBeCloseTo(0.02);
    expect(mismatchRes.sizeMismatch).toBe(false);
    expect(mismatchRes.tooLarge).toBeUndefined();

    // Size mismatch
    const sizeMismatchRes = await checker.checkVisualDiff(makePng(100, 120, [0, 0, 0]), makePng(100, 100, [0, 0, 0]));
    expect(sizeMismatchRes.match).toBe(false);
    expect(sizeMismatchRes.sizeMismatch).toBe(true);
    expect(sizeMismatchRes.diffPercent).toBe(1);
    expect(sizeMismatchRes.tooLarge).toBeUndefined();
  });

  it('returns tooLarge: true for buffers that are not valid PNGs without throwing', async () => {
    const invalidBuf = Buffer.from('not a png header');
    const validPng = makePng(10, 10, [0, 0, 0]);

    const result1 = await checker.checkVisualDiff(invalidBuf, validPng);
    expect(result1).toEqual({
      match: false,
      diffPercent: 0,
      diffPixels: 0,
      sizeMismatch: false,
      tooLarge: true,
    });

    const result2 = await checker.checkVisualDiff(validPng, invalidBuf);
    expect(result2).toEqual({
      match: false,
      diffPercent: 0,
      diffPixels: 0,
      sizeMismatch: false,
      tooLarge: true,
    });

    const result3 = await checker.checkVisualDiff(Buffer.alloc(0), validPng);
    expect(result3).toEqual({
      match: false,
      diffPercent: 0,
      diffPixels: 0,
      sizeMismatch: false,
      tooLarge: true,
    });
  });

  it('visualDiffFinding returns could-not-verify finding when result.tooLarge is true', () => {
    const finding = checker.visualDiffFinding(
      { match: false, diffPercent: 0, diffPixels: 0, sizeMismatch: false, tooLarge: true },
      {
        testCaseId: 'TC-LONG-PAGE',
        role: 'shopper',
        breakpoint: '1440px',
        urlPath: '/infinite-feed',
        baselinePath: 'baselines/feed.png',
      }
    );

    expect(finding.id.startsWith('F-UNVERIFIED-design-standards')).toBe(true);
    expect(finding.title.startsWith('Could not verify')).toBe(true);
    expect(finding.title).toContain('the screenshot is too large to compare');
    expect(finding.checker).toBe('design-standards');
    expect(finding.severity).toBe('Suggestion');
    expect(finding.needsConfirmation).toBe(true);
  });
});
