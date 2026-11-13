# The static site (landing page and wizard) on Cloud Run. The deploy job first builds the wizard into
# ./public (pnpm site-build), then builds this image. nginx-unprivileged runs as a non-root user on port 8080.
FROM nginxinc/nginx-unprivileged:1.31-alpine@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e
COPY site/nginx.conf /etc/nginx/conf.d/default.conf
COPY public /usr/share/nginx/html

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/ > /dev/null || exit 1
