// pnpm smoke: starts the QA Tool the way people do (pnpm start), on a spare port, and checks that the
// one address serves the Wizard and the API, and QA Flow Studio's old address redirects. Exits non-zero on the first problem.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.SMOKE_PORT || 3591);
const base = `http://localhost:${port}`;
const scratch = mkdtempSync(path.join(os.tmpdir(), 'qa-smoke-'));

const env = {
  ...process.env,
  RUNNER_PORT: String(port),
  RUNNER_DATA_DIR: path.join(scratch, 'data'),
  RUNNER_OUTPUT_DIR: path.join(scratch, 'report'),
};
delete env.HUB_API_URL;
const tool = spawn(process.execPath, [path.join(root, 'scripts/start.mjs'), '--no-open'], { cwd: root, env, stdio: 'inherit' });

const checks = [
  ['the Wizard at /', '/', (res, body) => res.status === 200 && body.includes('id="root"')],
  ['/studio/ redirects to Past check-ups', '/studio/', (res) => res.status === 308 && res.headers.get('location') === '/reports'],
  ['Past check-ups at /reports', '/reports', (res, body) => res.status === 200 && body.includes('id="root"')],
  ['the API at /api/runner/status', '/api/runner/status', (res, body) => res.status === 200 && 'phase' in JSON.parse(body)],
  ['"Hub not connected" at /api/v1/', '/api/v1/health', (res, body) => res.status === 503 && JSON.parse(body).hubConnected === false],
];

let failed = false;
try {
  let up = false;
  // The first start may build everything, so give it a few minutes.
  for (let i = 0; i < 600 && !up && tool.exitCode === null; i++) {
    up = await fetch(`${base}/api/runner/status`).then((r) => r.ok, () => false);
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) throw new Error('the QA Tool never answered');
  for (const [what, address, ok] of checks) {
    const res = await fetch(`${base}${address}`, { redirect: 'manual' });
    const body = await res.text();
    let passed = false;
    try {
      passed = ok(res, body);
    } catch {
      passed = false;
    }
    console.log(`${passed ? '✔' : '✖'} ${what} (${res.status})`);
    failed ||= !passed;
  }
} catch (err) {
  console.error(`✖ ${err instanceof Error ? err.message : err}`);
  failed = true;
} finally {
  tool.kill();
  rmSync(scratch, { recursive: true, force: true });
}
console.log(failed ? '\nSmoke check failed.' : '\nSmoke check passed.');
// Not process.exit(): on Windows, exiting while fetch's sockets close can abort Node.
process.exitCode = failed ? 1 : 0;
