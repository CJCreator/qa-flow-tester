#!/usr/bin/env bash
# CI only. Installs Chromium and the system libraries it needs on an Ubuntu runner.
# A stalled apt download once held a job for 12 to 20 minutes, so each download gets a 30 s
# timeout and up to three retries, and the whole install is retried if it still fails.
set -uo pipefail

printf 'Acquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nAcquire::Retries "3";\n' |
  sudo tee /etc/apt/apt.conf.d/99ci-timeouts > /dev/null

for attempt in 1 2 3; do
  if pnpm --filter @qa/core exec playwright install --with-deps chromium; then
    exit 0
  fi
  echo "Browser install attempt $attempt failed; retrying in 20 s"
  sleep 20
done
exit 1
