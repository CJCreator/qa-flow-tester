import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { TestCase, ProductProfile } from '@qa/types';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import { readBaselineMode, sidecarPath, writeVisualBaseline } from '../src/visual-capture.js';
import { server } from '../../../fixtures/test-app/server.js';

describe('visual baseline compat', () => {
  const PORT = 3087;
  const baseUrl = `http://localhost:${PORT}`;
  const root = path.join(process.cwd(), '.tmp-visual-compat');
  const baselineDir = path.join(root, 'baselines');
  const png = path.join(baselineDir, 'TC-VISUAL-COMPAT-1440px.png');

  const testCase: TestCase = {
    id: 'TC-VISUAL-COMPAT',
    flowId: 'login-page',
    name: 'Login page renders',
    role: 'anonymous',
    startPage: '/login',
    steps: [{ action: 'wait', name: 'Wait for page load' }],
    expectations: { url: { pattern: '/login*' } },
  };
  const profile: ProductProfile = {
    name: 'Fixture App',
    productId: 'fixture-app',
    roles: [],
    visualBaselineDir: baselineDir,
  };
  const run = (updateBaselines: boolean, out = 'run') =>
    new FlowTestOrchestrator().run({
      targetUrl: baseUrl,
      productId: 'fixture-test',
      specTestCases: [testCase],
      profile,
      outputDir: path.join(root, out),
      enableA11y: false,
      recordVideo: false,
      updateBaselines,
    });
  const visual = (r: Awaited<ReturnType<typeof run>>) => r.findings.filter((f) => f.id.startsWith('F-VISUAL-'));

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(PORT, () => resolve()));
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it('visual baseline compat: readBaselineMode is unmasked for a missing, corrupt, wrong-version or mismatched sidecar', async () => {
    const dir = path.join(root, 'unit');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'a-1440px.png');
    const bytes = Buffer.from('not really a png');
    expect(await readBaselineMode(file, bytes)).toEqual({ masked: false });

    await writeVisualBaseline(file, bytes, { extraSelectors: ['.live'] });
    expect(await readBaselineMode(file, bytes)).toEqual({ masked: true, extraSelectors: ['.live'] });

    await fs.writeFile(sidecarPath(file), '{not json');
    expect(await readBaselineMode(file, bytes)).toEqual({ masked: false });

    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    await fs.writeFile(
      sidecarPath(file),
      JSON.stringify({ version: 999, masked: true, sha256: sha, extraSelectors: [] })
    );
    expect(await readBaselineMode(file, bytes)).toEqual({ masked: false });

    await writeVisualBaseline(file, bytes);
    expect(await readBaselineMode(file, Buffer.from('overwritten'))).toEqual({ masked: false });
  });

  it('visual baseline compat: update writes a sidecar with matching sha256; unchanged page gives no finding', async () => {
    await run(true);
    const bytes = await fs.readFile(png);
    const side = JSON.parse(await fs.readFile(sidecarPath(png), 'utf8'));
    expect(side.masked).toBe(true);
    expect(side.sha256).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
    expect(visual(await run(false))).toHaveLength(0);
  }, 60000);

  it('visual baseline compat: a PNG with no sidecar compares unmasked and unchanged page gives no finding', async () => {
    await fs.rm(sidecarPath(png), { force: true });
    expect(await readBaselineMode(png, await fs.readFile(png))).toEqual({ masked: false });
    expect(visual(await run(false))).toHaveLength(0);
  }, 60000);

  it('visual baseline compat: a sidecar whose sha256 no longer matches (PNG overwritten) falls back to unmasked', async () => {
    await run(true);
    const { PNG } = await import('pngjs');
    const img = PNG.sync.read(await fs.readFile(png));
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 400; x++) {
        const i = (y * img.width + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 0;
        img.data[i + 2] = 255;
      }
    }
    await fs.writeFile(png, PNG.sync.write(img));
    expect(await readBaselineMode(png, await fs.readFile(png))).toEqual({ masked: false });
  }, 60000);

  it('visual baseline compat: a regression finding has baseline, current and difference images inside the report folder as relative paths; a match writes none', async () => {
    const out = 'evidence-run';
    // Baseline from the previous test is painted over, so this run regresses.
    const regression = visual(await run(false, out));
    expect(regression).toHaveLength(1);
    const ev = regression[0].evidence;
    for (const p of [ev.baselineScreenshotPath, ev.currentScreenshotPath, ev.screenshotPath]) {
      expect(p).toBeDefined();
      expect(path.isAbsolute(p!)).toBe(false);
      expect(p!.startsWith('..')).toBe(false);
      await expect(fs.stat(path.join(root, out, p!))).resolves.toBeTruthy();
    }
    expect(ev.baselineScreenshotPath).toMatch(/visual-baseline\.png$/);
    expect(ev.currentScreenshotPath).toMatch(/visual-current\.png$/);

    // Re-record, then a matching run writes no comparison images.
    await run(true);
    const matchOut = 'match-run';
    expect(visual(await run(false, matchOut))).toHaveLength(0);
    const found: string[] = [];
    const walk = async (d: string): Promise<void> => {
      for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) await walk(full);
        else if (/visual-(baseline|current)\.png$/.test(e.name)) found.push(full);
      }
    };
    await walk(path.join(root, matchOut));
    expect(found).toEqual([]);
  }, 90000);
});
