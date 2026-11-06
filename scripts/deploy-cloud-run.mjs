#!/usr/bin/env node
import { execSync } from 'child_process';

const PROJECT = process.env.GCP_PROJECT || 'qa-flow-tester-512310';
const REGION = process.env.GCP_REGION || 'us-central1';
const RUNNER_URL = 'https://qa-check-up-809804736896.us-central1.run.app';
const RUNNER_HASH_URL = 'https://qa-check-up-cnhl7suwnq-uc.a.run.app';
const SITE_URL = 'https://qa-check-up-site-809804736896.us-central1.run.app';
const AUDIT_STORE_BUCKET = process.env.AUDIT_STORE_BUCKET || 'qa-flow-tester-512310-audits';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const serviceArg = args.find((a) => a.startsWith('--service='));
const targetService = serviceArg ? serviceArg.split('=')[1] : 'all';

function sh(cmd, options = {}) {
  console.log(`\n> ${cmd}`);
  if (isDryRun) {
    console.log('  [dry-run: skipped execution]');
    return Buffer.from('');
  }
  return execSync(cmd, { stdio: 'inherit', ...options });
}

function capture(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

async function verifyEndpoint(url, expectedPattern, maxAttempts = 6) {
  console.log(`\nVerifying endpoint: ${url}`);
  if (isDryRun) {
    console.log('  [dry-run: skipped network verification]');
    return true;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const text = await res.text();
      const status = res.status;
      if (typeof expectedPattern === 'function' ? expectedPattern(status, text) : text.includes(expectedPattern)) {
        console.log(`  Attempt ${attempt}: Success (status ${status})`);
        return true;
      }
      console.log(`  Attempt ${attempt}: Response received (status ${status}), waiting...`);
    } catch (err) {
      console.log(`  Attempt ${attempt}: ${err.message}, retrying in 5s...`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

async function main() {
  console.log('====================================================');
  console.log(` Deploying to Google Cloud Run: ${PROJECT} (${REGION})`);
  if (isDryRun) console.log(' MODE: DRY-RUN (No commands will be executed)');
  console.log('====================================================');

  // Pre-flight auth check
  const activeAccount = capture('gcloud config get-value account');
  if (!activeAccount) {
    console.error('❌ Not authenticated with gcloud. Run: gcloud auth login');
    process.exit(1);
  }
  console.log(`✅ Authenticated account: ${activeAccount}`);

  const sha = capture('git rev-parse --short HEAD') || 'manual';
  const runnerImage = `${REGION}-docker.pkg.dev/${PROJECT}/qa/runner:${sha}`;
  const siteImage = `${REGION}-docker.pkg.dev/${PROJECT}/qa/site:${sha}`;

  const deployRunner = targetService === 'all' || targetService === 'runner';
  const deploySite = targetService === 'all' || targetService === 'site';

  // Step 1: Build local packages
  console.log('\n--- Step 1: Building Workspace Packages ---');
  if (deploySite) {
    sh('pnpm run site-build', { env: { ...process.env, VITE_ONLINE_APP_URL: RUNNER_URL } });
  }
  if (deployRunner) {
    sh('pnpm --filter "@qa/runner..." run build');
  }

  // Step 2: Configure Docker auth
  console.log('\n--- Step 2: Configuring Artifact Registry Auth ---');
  sh(`gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet`);

  // Step 3: Build and push container images
  console.log('\n--- Step 3: Building and Pushing Container Images ---');
  if (deployRunner) {
    sh(`docker build -f packages/runner/Dockerfile -t ${runnerImage} .`);
    sh(`docker push ${runnerImage}`);
  }
  if (deploySite) {
    sh(`docker build -f site/Dockerfile -t ${siteImage} .`);
    sh(`docker push ${siteImage}`);
  }

  // Step 4: Deploy Runner Service
  if (deployRunner) {
    console.log('\n--- Step 4: Deploying qa-check-up (Runner) ---');
    // Using '^#^' as separator: '#' allows origins containing commas and emails containing '@'
    const allowedOrigins = process.env.RUNNER_ALLOWED_ORIGINS || [RUNNER_URL, RUNNER_HASH_URL, SITE_URL].join(',');

    const envVars = [
      'RUNNER_BETA=1',
      'RUNNER_HOST=0.0.0.0',
      'RUNNER_DATA_DIR=/tmp/qa-data',
      'RUNNER_OUTPUT_DIR=/tmp/qa-data/reports',
      `RUNNER_ALLOWED_ORIGINS=${allowedOrigins}`,
      `AUDIT_STORE_BUCKET=${AUDIT_STORE_BUCKET}`,
      `FIREBASE_PROJECT_ID=${process.env.FIREBASE_PROJECT_ID || ''}`,
      `FIREBASE_WEB_API_KEY=${process.env.FIREBASE_WEB_API_KEY || ''}`,
      `FIREBASE_AUTH_DOMAIN=${process.env.FIREBASE_AUTH_DOMAIN || ''}`,
      `SCHEDULER_SERVICE_ACCOUNT=${process.env.SCHEDULER_SERVICE_ACCOUNT || ''}`,
      `AUDIT_OWNER_EMAILS=${process.env.AUDIT_OWNER_EMAILS || ''}`,
    ].join('#');

    sh(
      `gcloud run deploy qa-check-up --project "${PROJECT}" --region "${REGION}" ` +
        `--image "${runnerImage}" --port 8080 --memory 2Gi --cpu 1 ` +
        `--min-instances 1 --max-instances 1 --timeout 3600 ` +
        `--allow-unauthenticated ` +
        `--set-env-vars "^#^${envVars}" ` +
        `--set-secrets "RUNNER_ACCESS_TOKEN=qa-access-token:latest"`
    );
  }

  // Step 5: Deploy Site Service
  if (deploySite) {
    console.log('\n--- Step 5: Deploying qa-check-up-site (Site) ---');
    sh(
      `gcloud run deploy qa-check-up-site --project "${PROJECT}" --region "${REGION}" ` +
        `--image "${siteImage}" --port 8080 --memory 256Mi --cpu 1 ` +
        `--min-instances 0 --max-instances 2 ` +
        `--allow-unauthenticated`
    );
  }

  // Step 6: Post-Deployment Verification
  console.log('\n--- Step 6: Verifying Deployed Endpoints ---');
  if (deployRunner) {
    const runnerOk = await verifyEndpoint(
      `${RUNNER_URL}/`,
      (status) => status === 401 || status === 200 // 401 indicates access-token gate is actively protecting
    );
    if (!runnerOk && !isDryRun) {
      console.warn('⚠️ Runner endpoint did not respond with expected status within timeout.');
    }
  }

  if (deploySite) {
    const siteOk = await verifyEndpoint(`${SITE_URL}/version.json`, (status, text) => {
      try {
        const json = JSON.parse(text);
        return status === 200 && json.commit !== undefined;
      } catch {
        return status === 200;
      }
    });
    if (!siteOk && !isDryRun) {
      console.warn('⚠️ Site endpoint did not serve version.json within timeout.');
    }
  }

  console.log('\n====================================================');
  console.log(' Deployment Process Completed!');
  if (deploySite) console.log(` Static Site: ${SITE_URL}`);
  if (deployRunner) console.log(` Online App:  ${RUNNER_URL}`);
  console.log('====================================================\n');
}

main().catch((err) => {
  console.error('\n❌ Deployment failed:', err.message);
  process.exit(1);
});
