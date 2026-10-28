# Stage 1: Build the runner and wizard
FROM node:22-bookworm-slim AS builder

RUN corepack enable && corepack prepare pnpm@11.10.0 --activate
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app

# Copy dependency manifests for layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY packages/checkers/package.json packages/checkers/
COPY packages/core/package.json packages/core/
COPY packages/runner/package.json packages/runner/
COPY packages/wizard/package.json packages/wizard/
COPY fixtures/test-app/package.json fixtures/test-app/

RUN pnpm install --frozen-lockfile --filter "@qa/runner..." --filter "@qa/wizard..."

COPY packages/types packages/types
COPY packages/checkers packages/checkers
COPY packages/core packages/core
COPY packages/runner packages/runner
COPY packages/wizard packages/wizard
COPY templates templates

ARG VITE_COUNTER_URL=
ARG VITE_CONTACT_EMAIL=
ARG VITE_SIGNUP_URL=
ENV VITE_COUNTER_URL=$VITE_COUNTER_URL \
    VITE_CONTACT_EMAIL=$VITE_CONTACT_EMAIL \
    VITE_SIGNUP_URL=$VITE_SIGNUP_URL

RUN pnpm --filter "@qa/runner..." run build && pnpm --filter @qa/wizard run build

# Prune devDependencies to keep only production packages for the runner
RUN pnpm --filter "@qa/runner..." --prod deploy /prod/runner

# Stage 2: Minimal production runner
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS runner

WORKDIR /app

# Remove unused browser engines to significantly reduce container footprint
RUN rm -rf /ms-playwright/firefox-* /ms-playwright/webkit-* /ms-playwright/ffmpeg-*

# Install dumb-init for clean process reaping and SIGTERM/SIGINT signal handling
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Copy production runtime dependencies and built dist files
COPY --chown=pwuser:pwuser --from=builder /prod/runner /app
COPY --chown=pwuser:pwuser --from=builder /app/templates /app/templates
COPY --chown=pwuser:pwuser --from=builder /app/packages/runner/dist /app/packages/runner/dist
COPY --chown=pwuser:pwuser --from=builder /app/packages/wizard/dist /app/packages/wizard/dist

# Ensure data directories exist and are owned by pwuser
RUN mkdir -p /data/reports /tmp/qa-data && chown -R pwuser:pwuser /data /tmp/qa-data

ENV NODE_ENV=production \
    RUNNER_HOST=0.0.0.0 \
    RUNNER_PORT=3001 \
    RUNNER_DATA_DIR=/data \
    RUNNER_OUTPUT_DIR=/data/reports \
    # Restrict V8 heap to prevent OOM in small memory containers
    NODE_OPTIONS="--max-old-space-size=384"

USER pwuser
EXPOSE 3001

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "packages/runner/dist/cli.js"]
