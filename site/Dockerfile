# The static site (landing page and wizard) on Cloud Run. The deploy job first builds the wizard into
# ./public (pnpm site-build), then builds this image. nginx-unprivileged runs as a non-root user on port 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY site/nginx.conf /etc/nginx/conf.d/default.conf
COPY public /usr/share/nginx/html
