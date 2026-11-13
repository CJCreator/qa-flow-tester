# The QA Tool: the runner, which drives real browsers, and the Wizard it serves, on one port. It builds on Playwright's image, whose version must match the `playwright` package in
# the lockfile.
FROM mcr.microsoft.com/playwright:v1.65.0-noble@sha256:9beb546099e11f52d62e505537914870e01a67e0e6b00ae41da4775324e73dbe
# Replace the base image's bundled Node (v26) with Node 22, the version pinned in .nvmrc. Playwright stays from the base.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends xz-utils; \
    rm -rf /var/lib/apt/lists/*; \
    curl -fsSLO https://nodejs.org/dist/v22.23.5/node-v22.23.5-linux-x64.tar.xz; \
    echo "cdeb8670a0c81f51b4dc4ac61919f9b1ad917b304bf8221eb939570663d240f8  node-v22.23.5-linux-x64.tar.xz" | sha256sum -c -; \
    tar -xJf node-v22.23.5-linux-x64.tar.xz -C /usr/local --strip-components 1; \
    rm node-v22.23.5-linux-x64.tar.xz; \
    node --version
RUN corepack enable && corepack prepare pnpm@11.10.0 --activate
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY packages/checkers/package.json packages/checkers/
COPY packages/core/package.json packages/core/
COPY packages/runner/package.json packages/runner/
COPY packages/wizard/package.json packages/wizard/
RUN pnpm install --frozen-lockfile --filter "@qa/runner..." --filter "@qa/wizard..."

COPY packages/types packages/types
COPY packages/checkers packages/checkers
COPY packages/core packages/core
COPY packages/runner packages/runner
COPY packages/wizard packages/wizard
# The Wizard builds the workflow file people copy from its start screen into its page, so the file must be here.
COPY templates templates
# Optional public landing values, read by Vite at build time. Empty means off.
ARG VITE_COUNTER_URL=
ARG VITE_CONTACT_EMAIL=
ARG QA_TOOL_SHA=
ENV VITE_COUNTER_URL=$VITE_COUNTER_URL \
    VITE_CONTACT_EMAIL=$VITE_CONTACT_EMAIL \
    QA_TOOL_SHA=$QA_TOOL_SHA
# Single stage on purpose (decided 2026-11): the Playwright base image is the bulk of the size, the runner serves the
# wizard from packages/wizard/dist and needs the pnpm-linked node_modules, and build-secret-scan scans /app as it is.
# devDependencies stay in the image. A two-stage build needs a local Docker build and start test first.
RUN pnpm --filter "@qa/runner..." run build && pnpm --filter @qa/wizard run build

ENV NODE_ENV=production \
    RUNNER_HOST=0.0.0.0 \
    RUNNER_PORT=3001 \
    RUNNER_DATA_DIR=/data \
    RUNNER_OUTPUT_DIR=/data/reports
# Non-root runtime. Only the writable dirs the app uses are owned by qa: the data volume and the baselines folder.
# --no-sandbox stays on Chromium (decided): the container's non-root user is the boundary, not Chromium's sandbox.
RUN groupadd --system qa \
 && useradd --system --gid qa --home-dir /app --shell /usr/sbin/nologin qa \
 && mkdir -p /data/reports /app/.qa-baselines \
 && chown -R qa:qa /data /app/.qa-baselines
USER qa
EXPOSE 3001
# Same port rule as cli.ts: PORT is honored only on Cloud Run (K_SERVICE), else RUNNER_PORT. /healthz is public and shows no data.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+((process.env.K_SERVICE&&process.env.PORT)||process.env.RUNNER_PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "packages/runner/dist/cli.js"]
