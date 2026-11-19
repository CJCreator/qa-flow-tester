/**
 * The site's brand for the Improved version (ADR 0049): its logo and main colours, read from what the
 * Website Audit already stored. No new request is made to the site.
 * - The logo comes from the homepage's Page Content: an image whose address or alt text says "logo", or else
 *   the first image of the first Section (the header).
 * - The audit stores no CSS facts, so the colours come from the stored phone screenshot of the homepage: the
 *   most common strong colours of its pixels. Without a readable screenshot there are no colours.
 */
import { inflateSync } from 'node:zlib';
import type { PageContent } from '@qa/types';
import { sameSiteUrl } from '../../safe-net.js';

export interface SiteBrand {
  /** An absolute same-site image address and its alt text; null when no logo was found. */
  logo: { src: string; alt: string } | null;
  /** Up to three colours, most common first, as #rrggbb. */
  colours: string[];
}

const MAX_COLOURS = 3;

/** The logo of the homepage, as an absolute same-site address. */
export function findLogo(home: PageContent | null, siteUrl: string): SiteBrand['logo'] {
  if (!home) return null;
  const absolute = (src: string): string | null => {
    try {
      const url = new URL(src, siteUrl);
      return (url.protocol === 'http:' || url.protocol === 'https:') && sameSiteUrl(url.href, siteUrl)
        ? url.href
        : null;
    } catch {
      return null;
    }
  };
  const named = home.images.find((i) => /logo/i.test(i.src) || /logo/i.test(i.alt ?? ''));
  const firstSection = home.sections[0]?.id;
  const header = firstSection ? home.images.find((i) => i.sectionId === firstSection) : undefined;
  for (const image of [named, header]) {
    if (!image) continue;
    const src = absolute(image.src);
    if (src) return { src, alt: (image.alt ?? '').trim() || 'Logo' };
  }
  return null;
}

/** The pixels of an 8-bit, non-interlaced RGB or RGBA PNG; null for anything else. */
export function decodePng(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || sig.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Uint8Array[] = [];
  for (let p = 8; p + 8 <= bytes.length;) {
    const length = view.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const data = bytes.subarray(p + 8, p + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(p + 8);
      height = view.getUint32(p + 12);
      const depth = bytes[p + 16];
      const colourType = bytes[p + 17];
      const interlace = bytes[p + 20];
      if (depth !== 8 || interlace !== 0 || (colourType !== 2 && colourType !== 6)) return null;
      channels = colourType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    p += 12 + length;
  }
  if (!width || !height || !channels || idat.length === 0 || width * height > 40_000_000) return null;
  let raw: Uint8Array;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) return null;
      cur[x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = cur[x * channels];
      out[o + 1] = cur[x * channels + 1];
      out[o + 2] = cur[x * channels + 2];
      out[o + 3] = channels === 4 ? cur[x * channels + 3] : 255;
    }
    prev = cur;
  }
  return { width, height, rgba: out };
}

const hex = (n: number) => n.toString(16).padStart(2, '0');

/**
 * The most common strong colours of a screenshot: near-white, near-black, grey and see-through pixels are
 * left out, and similar colours are counted together (4 bits a channel).
 */
export function screenshotColours(png: Uint8Array | null): string[] {
  const image = png ? decodePng(png) : null;
  if (!image) return [];
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  const step = Math.max(1, Math.floor((image.width * image.height) / 200_000));
  for (let i = 0; i < image.width * image.height; i += step) {
    const o = i * 4;
    const [r, g, b, a] = [image.rgba[o], image.rgba[o + 1], image.rgba[o + 2], image.rgba[o + 3]];
    if (a < 200) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 40 || max < 40 || min > 225) continue; // grey, black or white
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    counts.set(key, bucket);
  }
  return [...counts.values()]
    .sort((x, y) => y.n - x.n)
    .slice(0, MAX_COLOURS)
    .map((c) => `#${hex(Math.round(c.r / c.n))}${hex(Math.round(c.g / c.n))}${hex(Math.round(c.b / c.n))}`);
}

/** The site's logo and colours, from the homepage's Page Content and its stored screenshot. */
export function siteBrand(input: {
  home: PageContent | null;
  siteUrl: string;
  screenshot: Uint8Array | null;
}): SiteBrand {
  return { logo: findLogo(input.home, input.siteUrl), colours: screenshotColours(input.screenshot) };
}
