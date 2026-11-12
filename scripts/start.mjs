// pnpm start: builds whatever is missing or older than its source, checks for the browser Release
// check-up drives, starts it and opens it in your browser. It does not install packages: after a
// git pull that changes dependencies, run pnpm bootstrap first.
//
//   pnpm start              start and open http://localhost:3001/
//   pnpm start --no-open    start without opening a browser
//
// RUNNER_PORT, RUNNER_HOST and the other RUNNER_* settings work as for the runner itself.
// Values in .env load through the start script's node flag (--env-file-if-exists), so a value set only there is read.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nodeMajorWarning } from './check-playwright-version.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.RUNNER_PORT || 3001);
const address = `http://localhost:${port}/`;
const openBrowser = !process.argv.includes('--no-open') && !process.env.CI;

function fail(message) {
  console.error(`\n[QA Tool] ${message}\n`);
  process.exit(1);
}

function pnpm(args) {
  const result = spawnSync('pnpm', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0)
    fail(`"pnpm ${args.join(' ')}" failed. Run pnpm bootstrap to reinstall and rebuild everything.`);
}

const built = (file) => existsSync(path.join(root, file));

/** When a file was last written, in ms; 0 when it is missing. */
function modifiedAt(file) {
  try {
    return statSync(path.join(root, file)).mtimeMs;
  } catch {
    return 0;
  }
}

/** The newest modification time of any file under these paths, skipping node_modules and dist. */
function newestSource(paths) {
  let newest = 0;
  const visit = (full) => {
    let stat;
    try {
      stat = statSync(full);
    } catch {
      return;
    }
    if (!stat.isDirectory()) {
      newest = Math.max(newest, stat.mtimeMs);
      return;
    }
    for (const name of readdirSync(full)) {
      if (name !== 'node_modules' && name !== 'dist') visit(path.join(full, name));
    }
  };
  for (const p of paths) visit(path.join(root, p));
  return newest;
}

/** A build is out of date when its output is missing or any of its source files is newer (after a git pull, say). */
const outOfDate = (output, sources) => {
  const builtAt = modifiedAt(output);
  return builtAt === 0 || newestSource(sources) > builtAt;
};

async function isQaTool() {
  try {
    const res = await fetch(`${address}api/runner/status`, { signal: AbortSignal.timeout(1500) });
    return res.ok && 'phase' in (await res.json());
  } catch {
    return false;
  }
}

function portInUse() {
  return new Promise((resolve) => {
    const socket = net.connect(port, 'localhost');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function open(url) {
  if (!openBrowser) return;
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
}

if (!built('node_modules')) fail('Nothing is installed yet. Run pnpm bootstrap first.');

// A Node major other than .nvmrc's (CI's) is a warning only.
if (existsSync(path.join(root, '.nvmrc'))) {
  const nodeWarning = nodeMajorWarning(process.versions.node, readFileSync(path.join(root, '.nvmrc'), 'utf8'));
  if (nodeWarning) console.warn(`\n[QA Tool] ${nodeWarning}\n`);
}

// 1. Build whatever is missing or out of date: the libraries it runs on, then the Wizard it serves.
// tsc rewrites every output file on each build, so one file per package marks when it was last built.
const packageSources = (name) => [
  `packages/${name}/src`,
  `packages/${name}/package.json`,
  `packages/${name}/tsconfig.json`,
];
const libraries = [
  ['types', 'index.js'],
  ['checkers', 'index.js'],
  ['core', 'index.js'],
  ['runner', 'cli.js'],
];
if (
  libraries.some(([name, entry]) =>
    outOfDate(`packages/${name}/dist/${entry}`, [...packageSources(name), 'tsconfig.base.json'])
  )
) {
  console.log('[QA Tool] Building the QA Tool…');
  pnpm(['--filter', '@qa/runner...', 'run', 'build']);
}
// The Wizard imports single modules from @qa/types/src, so a change there rebuilds it too.
const wizardSources = [
  ...packageSources('wizard'),
  'packages/wizard/index.html',
  'packages/wizard/public',
  'packages/wizard/vite.config.ts',
  'packages/wizard/tailwind.config.js',
  'packages/wizard/postcss.config.js',
  'packages/types/src',
];
if (outOfDate('packages/wizard/dist/index.html', wizardSources)) {
  console.log('[QA Tool] Building the Wizard…');
  pnpm(['--filter', '@qa/wizard', 'run', 'build']);
}

// 2. The browser the QA Tool drives.
if (process.env.SKIP_BROWSER_CHECK !== '1') {
  const { chromium } = createRequire(path.join(root, 'packages/core/package.json'))('playwright');
  if (!existsSync(chromium.executablePath())) {
    fail('The browser the QA Tool drives isn’t installed. Run pnpm bootstrap, which installs it.');
  }
}

// 3. Start, unless it is already running.
if (!(await portInUse())) {
  await import(pathToFileURL(path.join(root, 'packages/runner/dist/cli.js')).href);
  for (let i = 0; i < 100 && !(await isQaTool()); i++) await new Promise((r) => setTimeout(r, 200));
  open(address);
} else if (await isQaTool()) {
  console.log(`[QA Tool] Already running at ${address}`);
  open(address);
} else {
  fail(`Port ${port} is used by another program. Set RUNNER_PORT to another port, then run pnpm start again.`);
}
