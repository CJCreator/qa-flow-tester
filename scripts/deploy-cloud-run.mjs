#!/usr/bin/env node
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';

const PROJECT = process.env.GCP_PROJECT || 'qa-flow-tester-512310';
const REGION = process.env.GCP_REGION || 'us-central1';
const RUNNER_URL = 'https://qa-check-up-809804736896.us-central1.run.app';
const RUNNER_HASH_URL = 'https://qa-check-up-cnhl7suwnq-uc.a.run.app';
const SITE_URL = 'https://qa-check-up-site-809804736896.us-central1.run.app';

function sh(cmd, options = {}) {
  console.log(`\n> ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...options });
}

function capture(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

async function main() {
  console.log('====================================================');
  console.log(` Deploying to Google Cloud Run: ${PROJECT} (${REGION})`);
  console.log('====================================================');

  // Pre-flight check
  const activeAccount = capture('gcloud config get-value account');
  if (!activeAccount) {
    console.error('❌ Not authenticated with gcloud. Run: gcloud auth login');
    process.exit(1);
  }
  console.log(`✅ Authenticated account: ${activeAccount}`);

  // Build the static site and runner
  console.log('\n--- Step 1: Building Site & Runner Packages ---');
  sh('pnpm run site-build', { env: { ...process.env, VITE_ONLINE_APP_URL: RUNNER_URL } });
  sh('pnpm --filter "@qa/runner..." run build');

  const sha = capture('git rev-parse --short HEAD') || 'manual';
  const runnerImage = `${REGION}-docker.pkg.dev/${PROJECT}/qa/runner:${sha}`;
  const siteImage = `${REGION}-docker.pkg.dev/${PROJECT}/qa/site:${sha}`;

  // Configure Docker auth for Google Artifact Registry
  console.log('\n--- Step 2: Configuring Artifact Registry Auth ---');
  sh(`gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet`);

  // Build and Push images
  console.log('\n--- Step 3: Building and Pushing Images ---');
  sh(`docker build -f packages/runner/Dockerfile -t ${runnerImage} .`);
  sh(`docker push ${runnerImage}`);

  sh(`docker build -f site/Dockerfile -t ${siteImage} .`);
  sh(`docker push ${siteImage}`);

  // Deploy qa-check-up (the runner)
  console.log('\n--- Step 4: Deploying qa-check-up (Runner) ---');
  sh(
    `gcloud run deploy qa-check-up --project "${PROJECT}" --region "${REGION}" ` +
      `--image "${runnerImage}" --port 8080 --memory 2Gi --cpu 1 ` +
      `--min-instances 0 --max-instances 1 --timeout 3600 ` +
      `--allow-unauthenticated ` +
      `--set-env-vars "RUNNER_BETA=1,RUNNER_HOST=0.0.0.0,RUNNER_DATA_DIR=/tmp/qa-data,RUNNER_OUTPUT_DIR=/tmp/qa-data/reports,RUNNER_ALLOWED_ORIGINS=${RUNNER_URL},${RUNNER_HASH_URL}" ` +
      `--set-secrets "RUNNER_ACCESS_TOKEN=qa-access-token:latest"`
  );

  // Deploy qa-check-up-site (the static site)
  console.log('\n--- Step 5: Deploying qa-check-up-site (Site) ---');
  sh(
    `gcloud run deploy qa-check-up-site --project "${PROJECT}" --region "${REGION}" ` +
      `--image "${siteImage}" --port 8080 --memory 256Mi --cpu 1 ` +
      `--min-instances 0 --max-instances 2 ` +
      `--allow-unauthenticated`
  );

  console.log('\n====================================================');
  console.log(' Deployment Completed Successfully!');
  console.log(` Static Site: ${SITE_URL}`);
  console.log(` Online App:  ${RUNNER_URL}`);
  console.log('====================================================\n');
}

main().catch((err) => {
  console.error('\n❌ Deployment failed:', err.message);
  process.exit(1);
});
