// Renders packages/wizard/public/og-image.png (1200x630). Run once: pnpm --filter @qa/wizard run og-image
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'og-image.png');
mkdirSync(dirname(out), { recursive: true });

const html = `<!doctype html><html><body style="margin:0;width:1200px;height:630px;background:#111827;color:#f9fafb;
font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;display:flex;flex-direction:column;justify-content:center;padding:0 96px;box-sizing:border-box">
<div style="font-size:34px;font-weight:700;color:#9ca3af;margin-bottom:28px">Release check-up</div>
<div style="font-size:96px;font-weight:800;line-height:1.05">QA without a QA team.</div>
<div style="font-size:40px;color:#d1d5db;margin-top:32px">Know if your site is ready to ship.</div>
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
