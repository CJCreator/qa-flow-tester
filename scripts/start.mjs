// pnpm start: builds whatever is missing, checks for the browser Release check-up drives, starts it
// and opens it in your browser. After a git pull, run pnpm bootstrap first: this script only
// builds what is missing, not what is out of date.
//
//   pnpm start              start and open http://localhost:3001/
//   pnpm start --no-open    start without opening a browser
//
// RUNNER_PORT, RUNNER_HOST, HUB_API_URL and the other RUNNER_* settings work as for the runner itself.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

// 1. Build whatever is missing: the libraries it runs on, then the Wizard it serves.
const libraries = ['types/dist/index.js', 'checkers/dist/index.js', 'core/dist/index.js', 'runner/dist/cli.js'];
if (!libraries.every((file) => built(`packages/${file}`))) {
  console.log('[QA Tool] Building the QA Tool (first start only)…');
  pnpm(['--filter', '@qa/runner...', 'run', 'build']);
}
if (!built('packages/wizard/dist/index.html')) {
  console.log('[QA Tool] Building the Wizard…');
  pnpm(['--filter', '@qa/wizard', 'run', 'build']);
}

// 2. The browser the QA Tool drives.
const { chromium } = createRequire(path.join(root, 'packages/core/package.json'))('playwright');
if (!existsSync(chromium.executablePath())) {
  fail('The browser the QA Tool drives isn’t installed. Run pnpm bootstrap, which installs it.');
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
