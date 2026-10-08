# The QA Tool: the runner, which drives real browsers, and the Wizard it serves, on one port. It builds on Playwright's image, whose version must match the `playwright` package in
# the lockfile.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
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
ARG VITE_SIGNUP_URL=
ENV VITE_COUNTER_URL=$VITE_COUNTER_URL \
    VITE_CONTACT_EMAIL=$VITE_CONTACT_EMAIL \
    VITE_SIGNUP_URL=$VITE_SIGNUP_URL
RUN pnpm --filter "@qa/runner..." run build && pnpm --filter @qa/wizard run build

ENV NODE_ENV=production \
    RUNNER_HOST=0.0.0.0 \
    RUNNER_PORT=3001 \
    RUNNER_DATA_DIR=/data \
    RUNNER_OUTPUT_DIR=/data/reports
EXPOSE 3001
CMD ["node", "packages/runner/dist/cli.js"]
