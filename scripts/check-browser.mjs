// Fails when the Chromium Playwright launches is not the build the installed Playwright expects (for example
// `chromium_headless_shell-1243` expected, `-1194` found). Run by `pnpm bootstrap` after `playwright install chromium`.
// Usage: node scripts/check-browser.mjs
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Revision Playwright expects for a browser (by its browsers.json name), or null. */
export function expectedRevision(browsersJson, name) {
  const entry = browsersJson.browsers?.find((b) => b.name === name);
  return entry ? String(entry.revision) : null;
}

/** True when the executable path sits inside the expected build folder, e.g. `chromium_headless_shell-1243`. */
export function isInBuildFolder(executablePath, folder) {
  return executablePath.split(/[\\/]/).includes(folder);
}

export function main() {
  // Same resolution as the tests: the Playwright that @qa/core depends on.
  const fromCore = createRequire(path.join(root, 'packages/core/package.json'));
  const fromPlaywright = createRequire(fromCore.resolve('playwright/package.json'));
  const coreDir = path.dirname(fromPlaywright.resolve('playwright-core/package.json'));
  const browsers = JSON.parse(readFileSync(path.join(coreDir, 'browsers.json'), 'utf8'));
  const { chromium } = fromCore('playwright');

  // Headless runs (the default in tests) launch the headless shell build.
  const revision = expectedRevision(browsers, 'chromium-headless-shell');
  if (!revision) {
    console.error('browsers.json has no chromium-headless-shell entry; cannot tell which browser build is expected.');
    return 1;
  }
  const folder = `chromium_headless_shell-${revision}`;
  const executable = chromium.executablePath();

  if (!executable || !existsSync(executable) || !isInBuildFolder(executable, folder)) {
    console.error(
      `Browser build mismatch: Playwright expects ${folder}, launch path is ${executable || '(none)'}. ` +
        'Run `pnpm --filter @qa/core exec playwright install chromium` (and check PLAYWRIGHT_BROWSERS_PATH).',
    );
    return 1;
  }
  console.log(`Chromium headless shell ${folder} is installed and matches the Playwright build.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
