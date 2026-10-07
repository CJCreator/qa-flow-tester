import { RunnerServer } from './server.js';
import { defaultUiApps } from './ui-static.js';

// Render says which port to listen on with PORT. It is only trusted there, so a PORT set in someone's shell can't move a local runner.
const port = parseInt((process.env.RENDER && process.env.PORT) || process.env.RUNNER_PORT || '3001', 10);
const host = process.env.RUNNER_HOST || 'localhost';
const outputDir = process.env.RUNNER_OUTPUT_DIR || undefined;
const dataDir = process.env.RUNNER_DATA_DIR || undefined;
const localhostAlias = process.env.RUNNER_LOCALHOST_ALIAS || undefined;
// On Render the service's own public address is allowed without setting it by hand.
const originList = [process.env.RUNNER_ALLOWED_ORIGINS, process.env.RENDER_EXTERNAL_URL].filter(Boolean).join(',');
const allowedOrigins = originList
  ? originList
      .split(',')
      .map((o) => {
        const clean = o.replace(/\u001b\[[0-9;]*[a-zA-Z]|\u001b\].*?\u0007/g, '').trim();
        try {
          return new URL(clean).origin;
        } catch {
          return clean;
        }
      })
      .filter(Boolean)
  : undefined;
const accessToken = process.env.RUNNER_ACCESS_TOKEN || undefined;
const beta = process.env.RUNNER_BETA === '1';

if (beta && !accessToken) {
  console.warn(
    '[Release check-up] RUNNER_BETA is set without RUNNER_ACCESS_TOKEN: anyone who can reach this server can use it.'
  );
}

if (allowedOrigins && !accessToken) {
  console.warn(
    '[Release check-up] RUNNER_ALLOWED_ORIGINS is set without RUNNER_ACCESS_TOKEN: anyone who can reach this server can use it, including the saved AI key and sign-ins.'
  );
}

const server = new RunnerServer({
  port,
  host,
  outputDir,
  dataDir,
  localhostAlias,
  allowedOrigins,
  accessToken,
  beta,
  ui: defaultUiApps(),
});

server
  .start()
  .then((url) => {
    // Bound to every address (as in Docker), it's still opened as localhost.
    const address = url.replace('://0.0.0.0', '://localhost');
    console.log(`[Release check-up] Open ${address}/ in your browser`);
  })
  .catch((err) => {
    console.error('[Release check-up] Failed to start:', err);
    process.exit(1);
  });
