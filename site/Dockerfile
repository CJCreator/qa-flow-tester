# The static site (landing page and wizard) on Cloud Run. The deploy job first builds the wizard into
# ./public (pnpm site-build), then builds this image. nginx-unprivileged runs as a non-root user on port 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine@sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0
COPY site/nginx.conf /etc/nginx/conf.d/default.conf
COPY public /usr/share/nginx/html

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/ > /dev/null || exit 1
