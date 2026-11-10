#!/usr/bin/env node
/**
 * Smoke script for Website Audit against a running runner.
 *
 * Usage:
 *   node scripts/smoke-audit.mjs <url> [--pages N]
 *   pnpm smoke:audit <url> [--pages N]
 *
 * Environment variables:
 *   RUNNER_URL: Runner base URL (default: http://localhost:3001)
 *   RUNNER_ACCESS_TOKEN: Access token if server requires authentication
 *
 * Exits non-zero on `failed` or on `done` with an `only-one-page` note.
 */

// Parse CLI arguments
const args = process.argv.slice(2);
let targetUrl = '';
let maxPages = 50;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--pages' && i + 1 < args.length) {
    maxPages = parseInt(args[++i], 10);
  } else if (arg.startsWith('--pages=')) {
    maxPages = parseInt(arg.slice('--pages='.length), 10);
  } else if (!arg.startsWith('-') && !targetUrl) {
    targetUrl = arg;
  }
}

if (!targetUrl) {
  console.error('Usage: node scripts/smoke-audit.mjs <url> [--pages N]');
  console.error('   or: pnpm smoke:audit <url> [--pages N]');
  process.exitCode = 1;
  process.exit(1);
}

const runnerUrl = (process.env.RUNNER_URL || 'http://localhost:3001').replace(/\/+$/, '');
const token = process.env.RUNNER_ACCESS_TOKEN || '';
const authHeaders = token ? { 'x-qa-access': token } : {};

console.log(`Starting Website Audit smoke test against runner at ${runnerUrl}`);
console.log(`Target: ${targetUrl} (maxPages: ${maxPages})\n`);

// 1. Start audit
let auditId = '';
let version = 1;
try {
  const startRes = await fetch(`${runnerUrl}/api/audits`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      url: targetUrl,
      maxPages,
      maxDepth: 5,
      language: 'en',
    }),
  });

  if (!startRes.ok) {
    const errorBody = await startRes.text();
    console.error(`Failed to start audit: ${startRes.status} ${startRes.statusText}`);
    try {
      const parsed = JSON.parse(errorBody);
      console.error(`Code: ${parsed.code || 'UNKNOWN'}, Error: ${parsed.error || errorBody}`);
    } catch {
      console.error(errorBody);
    }
    process.exitCode = 1;
    process.exit(1);
  }

  const startData = await startRes.json();
  auditId = startData.auditId;
  version = startData.version ?? 1;
  console.log(`Audit started successfully: auditId=${auditId}, version=${version}\n`);
} catch (err) {
  console.error(`Network error connecting to runner at ${runnerUrl}:`, err instanceof Error ? err.message : err);
  process.exitCode = 1;
  process.exit(1);
}

// 2. Stream progress events via SSE
const stageDurations = new Map();
let currentStage = 'checking-address';
let stageStartTime = Date.now();

let aiStatus = 'unknown';
let speedSource = 'unknown';
let terminalEvent = null;
let terminalError = '';
let terminalCode = '';
const skippedByReason = new Map();
let recordedPagesCount = 0;

function switchStage(newStage) {
  if (newStage && newStage !== currentStage) {
    const elapsed = Date.now() - stageStartTime;
    stageDurations.set(currentStage, (stageDurations.get(currentStage) || 0) + elapsed);
    console.log(`Stage completed: ${currentStage} in ${(elapsed / 1000).toFixed(2)}s`);
    currentStage = newStage;
    stageStartTime = Date.now();
  }
}

try {
  const streamRes = await fetch(`${runnerUrl}/api/audits/${auditId}/stream`, {
    headers: {
      ...authHeaders,
    },
  });

  if (!streamRes.ok) {
    console.error(`Failed to connect to audit event stream: ${streamRes.status} ${streamRes.statusText}`);
    process.exitCode = 1;
    process.exit(1);
  }

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const part of parts) {
      const lines = part.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr);
          if (event.type === 'status') {
            aiStatus = event.ai || aiStatus;
            speedSource = event.speed || speedSource;
          } else if (event.type === 'snapshot') {
            if (event.ai) aiStatus = event.ai;
            if (event.speed) speedSource = event.speed;
            if (event.stage) switchStage(event.stage);
            if (event.counts) {
              recordedPagesCount = event.counts.pagesRecorded ?? recordedPagesCount;
            }
          } else if (event.type === 'progress') {
            if (event.stage) switchStage(event.stage);
            if (typeof event.pagesRecorded === 'number') recordedPagesCount = event.pagesRecorded;
          } else if (event.type === 'page') {
            if (event.state === 'recorded') {
              recordedPagesCount++;
            } else if (event.state === 'skipped') {
              const reason = event.reason || 'other';
              skippedByReason.set(reason, (skippedByReason.get(reason) || 0) + 1);
            }
          } else if (event.type === 'done') {
            terminalEvent = 'done';
            switchStage('done');
          } else if (event.type === 'failed') {
            terminalEvent = 'failed';
            terminalError = event.error || 'Audit failed';
            terminalCode = event.code || 'UNKNOWN';
            switchStage('failed');
          }
        } catch {
          // ignore unparseable data chunk
        }
      }
    }

    if (terminalEvent) break;
  }
} catch (streamErr) {
  console.error('Error reading event stream:', streamErr instanceof Error ? streamErr.message : streamErr);
}

// Record final active stage duration
const finalElapsed = Date.now() - stageStartTime;
stageDurations.set(currentStage, (stageDurations.get(currentStage) || 0) + finalElapsed);

// 3. Fetch final audit result and documents
let auditRecord = null;
try {
  const getRes = await fetch(`${runnerUrl}/api/audits/${auditId}?version=${version}`, {
    headers: { ...authHeaders },
  });
  if (getRes.ok) {
    auditRecord = await getRes.json();
  }
} catch {
  // best-effort
}

console.log('\n========================================');
console.log('         Website Audit Summary');
console.log('========================================');

// Print stages and elapsed times
console.log('\n--- Stages & Elapsed Time ---');
for (const [stage, ms] of stageDurations.entries()) {
  console.log(`  ${stage}: ${(ms / 1000).toFixed(2)}s`);
}

// Print pages recorded and skipped
const finalVersion = auditRecord?.version;
const finalResult = auditRecord?.result;
const totalRecorded = finalVersion?.pagesRecorded ?? finalResult?.pages?.length ?? recordedPagesCount;

console.log('\n--- Pages ---');
console.log(`  Pages recorded: ${totalRecorded}`);

const finalSkipped = finalResult?.coverage?.skipped;
if (Array.isArray(finalSkipped) && finalSkipped.length > 0) {
  console.log('  Pages skipped by reason:');
  const reasons = new Map();
  for (const s of finalSkipped) {
    const why = s.why || 'unknown';
    reasons.set(why, (reasons.get(why) || 0) + 1);
  }
  for (const [reason, count] of reasons.entries()) {
    console.log(`    - ${reason}: ${count}`);
  }
} else if (skippedByReason.size > 0) {
  console.log('  Pages skipped by reason:');
  for (const [reason, count] of skippedByReason.entries()) {
    console.log(`    - ${reason}: ${count}`);
  }
} else {
  console.log('  Pages skipped: 0');
}

// Print AI status and Speed source
console.log('\n--- Status & Telemetry ---');
console.log(`  AI status:    ${aiStatus}`);
console.log(`  Speed source: ${speedSource}`);

// Print documents written
console.log('\n--- Documents Written ---');
const docs = finalVersion?.documents;
if (Array.isArray(docs) && docs.length > 0) {
  for (const doc of docs) {
    const statusNote = doc.status === 'ready' ? 'written (ready)' : `not written (${doc.reason || doc.status})`;
    console.log(`  - ${doc.kind}: ${statusNote}`);
  }
} else {
  console.log('  (no documents metadata found)');
}

// Notes
const notes = finalResult?.notes ?? [];
if (notes.length > 0) {
  console.log('\n--- Audit Notes ---');
  for (const note of notes) {
    console.log(`  - ${note}`);
  }
}

// 4. Determine exit status
console.log('\n========================================');
if (terminalEvent === 'failed') {
  console.error(`Audit FAILED with code [${terminalCode}]: ${terminalError}`);
  process.exitCode = 1;
} else if (terminalEvent === 'done') {
  const hasOnlyOnePageNote = notes.some((n) => n === 'only-one-page' || /only 1 page was read/i.test(n));

  if (hasOnlyOnePageNote) {
    console.error('Audit completed with warning note: only-one-page');
    console.error('Only 1 page was read during the audit.');
    process.exitCode = 1;
  } else {
    console.log('Smoke audit PASSED.');
    process.exitCode = 0;
  }
} else {
  console.error('Audit ended prematurely without a terminal done/failed event.');
  process.exitCode = 1;
}
