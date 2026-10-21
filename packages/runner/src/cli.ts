import { RunnerServer, redactedMessage } from './server.js';
import { defaultUiApps } from './ui-static.js';
import { isLoopbackBindHost } from './bind-host.js';

// Hosted platforms (Render sets RENDER, Cloud Run sets K_SERVICE) specify the port to listen on with PORT.
// It is only trusted there, so a PORT set in someone's shell can't move a local runner.
const hostedPort = (process.env.RENDER || process.env.K_SERVICE) ? process.env.PORT : undefined;
const port = parseInt(hostedPort || process.env.RUNNER_PORT || '3001', 10);
const host = process.env.RUNNER_HOST || 'localhost';
const outputDir = process.env.RUNNER_OUTPUT_DIR || undefined;
const dataDir = process.env.RUNNER_DATA_DIR || undefined;
const localhostAlias = process.env.RUNNER_LOCALHOST_ALIAS || undefined;
// On hosted platforms the service's own public address is allowed without setting it by hand.
const originList = [
  process.env.RUNNER_ALLOWED_ORIGINS,
  process.env.RENDER_EXTERNAL_URL,
  process.env.RUNNER_PUBLIC_URL,
  process.env.CLOUD_RUN_URL,
].filter(Boolean).join(',');
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
// Invalid or non-positive values fall back to the default inside the orchestrator.
const stepTimeoutMs = process.env.RUNNER_STEP_TIMEOUT_MS ? Number(process.env.RUNNER_STEP_TIMEOUT_MS) : undefined;

if (!isLoopbackBindHost(host) && !accessToken) {
  console.error(
    `[Release check-up] Refusing to start on ${host} without RUNNER_ACCESS_TOKEN: anyone who can reach this server could use it, including the saved AI key and sign-ins. Set RUNNER_ACCESS_TOKEN to a long random value, or set RUNNER_HOST=localhost.`
  );
  process.exit(1);
}

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
  stepTimeoutMs,
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

// A stop from the host (Render, Docker, Ctrl+C) ends the run cleanly; after 10 s the process exits anyway.
let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Release check-up] ${signal} received, stopping`);
  setTimeout(() => process.exit(1), 10000);
  server.shutdown().then(
    () => process.exit(0),
    (err) => {
      console.error('[Release check-up] Shutdown failed:', err);
      process.exit(1);
    }
  );
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// A rejected promise is logged and the process keeps serving; the request it belonged to is answered by its own handler.
process.on('unhandledRejection', (reason) => {
  console.error('[Release check-up] Unhandled rejection:', redactedMessage(reason));
});
