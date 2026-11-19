# Container & Cloud Deployment Guide

Reference guide for deploying and running QA Flow Tester with Docker, Docker Compose, Kubernetes, and Google Cloud Run.

---

## 1. Quick Start: Docker Compose

The simplest way to run QA Flow Tester locally or on a private virtual machine is using `docker-compose.yml`.

### Prerequisites

- Docker Engine 24+ and Docker Compose v2+ installed.

### Setup & Run

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
2. Edit `.env` and set `RUNNER_ACCESS_TOKEN` to a secure secret.
3. Start the stack in the background:
   ```bash
   docker compose up -d
   ```
4. Open the app (the runner serves the wizard too):
   - **Runner and wizard**: [http://localhost:3001/?access=your-token](http://localhost:3001/?access=your-token)

### Architecture in Docker Compose

- **`runner`**: Builds `packages/runner/Dockerfile` on Playwright (`v1.65.0-noble`). Runs as dedicated non-root user `qa` (`USER qa`). Persistent storage mounted at `qa-data:/data`. Health probe checks `http://localhost:3001/healthz`. The runner drops all Linux capabilities and is limited to 2 GB of memory; this limit can be raised in `docker-compose.yml` for large sites. Chromium runs with `--no-sandbox` inside the container, so the container settings above are the protection.
- There is no separate site container: the hosted site is on Vercel ([ADR 0050](adr/0050-hosted-pilot-vercel-front-door.md)), and locally the runner serves the wizard.

To shut down:

```bash
docker compose down
```

---

## 2. Standalone Runner Container

If you only need the runner service (e.g. for CI test runners or headless API execution):

```bash
docker build -f packages/runner/Dockerfile -t qa-check-up .

docker run -d \
  --name qa-runner \
  -p 3001:3001 \
  -e RUNNER_ACCESS_TOKEN="your-secure-access-token" \
  -v qa-data:/data \
  qa-check-up
```

Verify the container is healthy:

```bash
docker ps --filter "name=qa-runner"
curl -I http://localhost:3001/healthz
```

---

## 3. Production Google Cloud Run Deployment

The production deployment architecture runs keylessly on Google Cloud Run in `us-central1` under project `qa-flow-tester-512310`:

```
Internet --> Vercel (qa-flow-tester.vercel.app: the site, forwards /api and /s)
         --> Cloud Run (qa-check-up, 0..1 instances, scales to zero)
                 |-- Cloud Storage (gs://qa-flow-tester-512310-audits)
                 |-- Secret Manager (qa-access-token, qa-session-secret)
                 |-- Cloud Scheduler (qa-check-up-tick)
```

### Automated Deployments

- Pushes to `main` trigger `.github/workflows/deploy.yml` via Workload Identity Federation.
- Tests (lint, format, typecheck, unit suite) gate deployment.

### Manual / Local Deployments with `gcloud`

Run the deployment script from an authenticated machine (`gcloud auth login`):

```bash
# Preview the deployment steps without executing:
node scripts/deploy-cloud-run.mjs --dry-run

# Deploy the runner (set VERCEL_SITE_URL to the Vercel site's origin first):
pnpm run deploy:cloud
```

---

## 4. Kubernetes / Pod Deployment

When deploying to Kubernetes:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: qa-runner
spec:
  replicas: 1
  strategy:
    type: Recreate
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        # The uid and gid of the image's `qa` user. Read them from your image:
        #   docker run --rm --entrypoint id <your image>
        runAsUser: <uid of qa>
        fsGroup: <gid of qa>
      containers:
        - name: runner
          # deploy.yml pushes one tag per commit and no `latest`. Use the commit you deployed.
          image: us-central1-docker.pkg.dev/qa-flow-tester-512310/qa/runner:<commit sha>
          ports:
            - containerPort: 3001
          env:
            - name: RUNNER_HOST
              value: '0.0.0.0'
            - name: RUNNER_ACCESS_TOKEN
              valueFrom:
                secretKeyRef:
                  name: qa-secrets
                  key: access-token
          volumeMounts:
            - name: data
              mountPath: /data
          livenessProbe:
            httpGet:
              path: /healthz
              port: 3001
            initialDelaySeconds: 20
            periodSeconds: 30
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: qa-data-pvc
```
