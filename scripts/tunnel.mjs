#!/usr/bin/env node
/**
 * pnpm tunnel
 *
 * Starts a Cloudflare Quick Tunnel for localhost:3001, captures the public URL,
 * then launches the QA runner with RUNNER_ALLOWED_ORIGINS pre-set to that URL
 * so cross-origin POST requests are accepted.
 *
 * Each start also makes a new random access key (RUNNER_ACCESS_TOKEN). The runner
 * refuses every request without it, because the public URL would otherwise expose
 * the saved AI key, stored sign-ins and reports to anyone who finds it. The printed
 * links carry the key; opening one stores it in a cookie.
 *
 * Both processes share stdout/stderr and are shut down together on Ctrl-C.
 *
 * Usage:
 *   pnpm tunnel              # builds runner if needed, then starts both
 *   pnpm tunnel --no-build   # skip the build step
 *   pnpm tunnel --beta       # share with outside testers: they bring their own AI key (kept in
 *                            # memory for their session only), your saved key and sign-ins are
 *                            # not copied or used, and only public sites can be checked
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const noBuild = process.argv.includes('--no-build');
const keepData = process.argv.includes('--keep-data');
const beta = process.argv.includes('--beta');
const isWin = process.platform === 'win32';
const accessKey = randomBytes(24).toString('base64url');
const port = Number(process.env.RUNNER_PORT || 3001);

const tunnelDataDir = path.join(root, '.qa-tunnel-data');
const tunnelOutputDir = path.join(root, '.qa-tunnel-report');

// ── Prepare clean tunnel workspace ──────────────────────────────────────────
// When sharing a tunnel link, guests should see a clean, fresh check-up screen
// instead of the developer's locally stored history, waiting plans, or site memory.
if (!keepData) {
  try {
    if (existsSync(tunnelDataDir)) rmSync(tunnelDataDir, { recursive: true, force: true });
    if (existsSync(tunnelOutputDir)) rmSync(tunnelOutputDir, { recursive: true, force: true });
  } catch {}
}

mkdirSync(tunnelDataDir, { recursive: true });
mkdirSync(tunnelOutputDir, { recursive: true });

// Copy AI keys and settings from main .qa-data so the tunnel user has AI ready.
// Not in beta mode: testers bring their own key, and yours is never copied.
const mainDataDir = path.join(root, '.qa-data');
for (const file of beta ? [] : ['.qa-keys.json', '.qa-settings.json', '.qa-ai-models.json']) {
  const src = path.join(mainDataDir, file);
  const dest = path.join(tunnelDataDir, file);
  if (existsSync(src) && !existsSync(dest)) {
    try {
      copyFileSync(src, dest);
    } catch {}
  }
}

function log(msg) {
  process.stdout.write(`\x1b[36m[tunnel]\x1b[0m ${msg}\n`);
}

function err(msg) {
  process.stderr.write(`\x1b[31m[tunnel]\x1b[0m ${msg}\n`);
}

function portInUse(targetPort) {
  return new Promise((resolve) => {
    const socket = net.connect(targetPort, 'localhost');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

// ── 0. Pre-flight check: ensure port is free ────────────────────────────────
if (await portInUse(port)) {
  err(`Port ${port} is already in use by another process (likely an active 'pnpm start').`);
  err('');
  err('Why this happens:');
  err('  `pnpm tunnel` needs to start its own runner with a generated access key');
  err('  and origin protections so the public tunnel cannot be abused.');
  err('');
  err('How to fix:');
  err(`  1. Stop the running process on port ${port} (press Ctrl+C in your 'pnpm start' terminal).`);
  err('  2. Re-run `pnpm tunnel`.');
  err(`  Or specify another port: (PowerShell: $env:RUNNER_PORT=3002; pnpm tunnel)`);
  process.exit(1);
}

// ── 1. Ensure runner is built ──────────────────────────────────────────────
if (!noBuild && !existsSync(path.join(root, 'packages/runner/dist/cli.js'))) {
  log('Runner not built yet — building now (run with --no-build to skip)…');
  const result = spawnSync('pnpm', ['--filter', '@qa/runner', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: isWin,
  });
  if (result.status !== 0) {
    err('Build failed. Run `pnpm bootstrap` to reinstall and rebuild everything.');
    process.exit(1);
  }
}

// ── 2. Start the Cloudflare tunnel ─────────────────────────────────────────
log(`Starting Cloudflare Quick Tunnel for http://localhost:${port}…`);

// On Windows, .cmd files require shell:true. To avoid DEP0190 (args + shell), we
// build a single command string when on Windows.
const tunnelCmd = isWin ? 'pnpm' : 'pnpm';
const tunnelArgs = ['dlx', 'untun', 'tunnel', '--port', String(port), '--', '--http-host-header', `localhost:${port}`];
const tunnelProc = spawn(tunnelCmd, tunnelArgs, {
  cwd: root,
  shell: isWin,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let runnerProc = null;
let tunnelUrl = null;
let runnerStarted = false;
let tunnelOutputBuffer = '';

function stripAnsi(str) {
  return str.replace(/\u001b\[[0-9;]*[a-zA-Z]|\u001b\].*?\u0007/g, '');
}

// ── 3. Watch tunnel output for the public URL ──────────────────────────────
function onTunnelData(chunk) {
  const text = chunk.toString();
  process.stdout.write(text);

  if (!runnerStarted) {
    tunnelOutputBuffer += text;
    const clean = stripAnsi(tunnelOutputBuffer);
    const match =
      clean.match(/Tunnel ready at\s+(https?:\/\/[^\s\x1b]+)/i) ||
      clean.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/i);
    if (match) {
      try {
        const cleanOrigin = new URL(match[1].trim()).origin;
        tunnelUrl = cleanOrigin;
        runnerStarted = true;
        startRunner(tunnelUrl);
      } catch {
        // Continue buffering if URL parsing fails on partial chunk
      }
    }
  }
}

tunnelProc.stdout.on('data', onTunnelData);
tunnelProc.stderr.on('data', onTunnelData); // untun writes the URL to stderr too

tunnelProc.on('exit', (code) => {
  if (code !== null && code !== 0) {
    err(`Tunnel exited with code ${code}.`);
  }
  if (!runnerStarted) {
    err('Tunnel closed before a public URL was seen. Is cloudflared blocked by your firewall?');
    process.exit(1);
  }
  shutdown();
});

// ── 4. Start the runner once we have the URL ──────────────────────────────
function startRunner(origin) {
  log(`Tunnel live at \x1b[32m${origin}\x1b[0m`);
  log('Starting QA runner with RUNNER_ALLOWED_ORIGINS and an access key set…');

  runnerProc = spawn('node', ['packages/runner/dist/cli.js'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      RUNNER_PORT: String(port),
      RUNNER_ALLOWED_ORIGINS: origin,
      RUNNER_ACCESS_TOKEN: accessKey,
      ...(beta
        ? { RUNNER_BETA: '1', OPENROUTER_API_KEY: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '' }
        : {}),
      RUNNER_DATA_DIR: tunnelDataDir,
      RUNNER_OUTPUT_DIR: tunnelOutputDir,
    },
  });

  runnerProc.on('exit', (code) => {
    if (code !== null && code !== 0) {
      err(`Runner exited with code ${code}.`);
    }
    shutdown();
  });

  log(`\n  Local:  \x1b[32mhttp://localhost:${port}/?access=${accessKey}\x1b[0m`);
  log(`  Public: \x1b[32m${origin}/?access=${accessKey}\x1b[0m\n`);
  if (beta) {
    log('BETA: each tester adds their own AI key in Settings (kept in memory for their session only).');
    log('Only public sites can be checked, one check-up runs at a time, and your own key is not used.');
    log('Give testers the Public link only. Everyone who has it sees the same reports.\n');
  } else {
    log('Shared tunnel link opens a fresh, clean check-up session powered by your AI key.');
    log('Your local check-up history, stored plans and saved sign-ins remain private.\n');
  }
}

// ── 5. Graceful shutdown ───────────────────────────────────────────────────
let isShuttingDown = false;
function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log('Shutting down…');
  try {
    tunnelProc?.kill();
  } catch {}
  try {
    runnerProc?.kill();
  } catch {}
  if (!keepData) {
    try {
      if (existsSync(tunnelDataDir)) rmSync(tunnelDataDir, { recursive: true, force: true });
      if (existsSync(tunnelOutputDir)) rmSync(tunnelOutputDir, { recursive: true, force: true });
    } catch {}
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', shutdown);
