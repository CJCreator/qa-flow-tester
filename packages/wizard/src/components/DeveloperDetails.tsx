import { useState } from 'react';
import type { Finding } from '@qa/types';
import { readRunText, runFileUrl } from '../api';
import { bugReportMarkdown, playwrightFromSteps } from '../lib/summary';

/** Copies text and says so; when the browser won't copy, the text is shown to copy by hand. */
function CopyButton({ label, getText }: { label: string; getText: () => Promise<string> }) {
  const [state, setState] = useState<'idle' | 'working' | 'copied' | { manual: string }>('idle');
  return (
    <div>
      <button
        type="button"
        className="btn-quiet min-h-[40px] px-3 text-sm"
        disabled={state === 'working'}
        onClick={async () => {
          setState('working');
          const text = await getText().catch(() => '');
          try {
            await navigator.clipboard.writeText(text);
            setState('copied');
            window.setTimeout(() => setState('idle'), 2500);
          } catch {
            setState({ manual: text });
          }
        }}
      >
        {label}
      </button>
      <span role="status" className="ml-2 text-sm text-pass">
        {state === 'copied' ? 'Copied' : ''}
      </span>
      {typeof state === 'object' && (
        <div className="mt-2">
          <p className="text-sm text-ink-soft">Your browser wouldn’t copy it. Select the text below and copy it yourself.</p>
          <textarea readOnly rows={8} className="field mt-1 font-mono text-xs" value={state.manual} aria-label={`${label}: text to copy`} />
        </div>
      )}
    </div>
  );
}

/**
 * The technical layer under a finding, collapsed until opened: what a developer needs to see the
 * problem again and fix it. Selectors, check names and commands appear only here.
 */
export function DeveloperDetails({ finding: f, runId, targetUrl }: { finding: Finding; runId: string; targetUrl: string }) {
  // Paths inside the check-up's folder can be shown; anything else (an older report's full path) can't.
  const screenshot = f.evidence.screenshotPath && !/^([a-z]:[\\/]|[\\/])/i.test(f.evidence.screenshotPath) ? f.evidence.screenshotPath : undefined;
  const element = f.where.cssSelector || f.where.dataTestId;
  const consoleLines = (f.evidence.consoleLogs || []).map((c) => c.text).filter(Boolean).slice(0, 10);
  const failedRequests = (f.evidence.networkLogs || []).filter((n) => !n.status || n.status >= 400).slice(0, 5);

  return (
    <details data-developer className="mt-3 rounded-md border border-rule bg-canvas/60">
      <summary className="min-h-[40px] cursor-pointer px-3 py-2 text-sm font-bold text-ink">Details for developers</summary>
      <div className="space-y-4 border-t border-rule p-3 text-sm">
        {screenshot && (
          <figure>
            <img
              src={runFileUrl(runId, screenshot)}
              alt={`The screen when this was found: ${f.where.urlPath} at ${f.where.breakpoint}`}
              loading="lazy"
              className="max-h-80 w-auto rounded border border-rule"
            />
            <figcaption className="mt-1 text-xs text-ink-soft">
              {f.where.urlPath} at {f.where.breakpoint}, as {f.where.role}
            </figcaption>
          </figure>
        )}

        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
          <dt className="text-ink-soft">Page</dt>
          <dd className="break-all font-mono text-xs text-ink">
            {f.where.urlPath} · {f.where.breakpoint} · {f.where.role}
          </dd>
          {element && (
            <>
              <dt className="text-ink-soft">Element</dt>
              <dd className="break-all font-mono text-xs text-ink">{element}</dd>
            </>
          )}
          <dt className="text-ink-soft">Check</dt>
          <dd className="font-mono text-xs text-ink">
            {f.checker} · {f.id} · {f.severity}
          </dd>
          <dt className="text-ink-soft">Expected</dt>
          <dd className="text-ink">{f.expectedVsActual.expected}</dd>
          <dt className="text-ink-soft">Actual</dt>
          <dd className="text-ink">{f.expectedVsActual.actual}</dd>
          {f.resolution && (
            <>
              <dt className="text-ink-soft">Suggested fix</dt>
              <dd className="text-ink">{f.resolution}</dd>
            </>
          )}
          {f.sourceLocation && (
            <>
              <dt className="text-ink-soft">In the code</dt>
              <dd className="break-all font-mono text-xs text-ink">
                {f.sourceLocation.file}
                {f.sourceLocation.line ? `:${f.sourceLocation.line}` : ''}
              </dd>
            </>
          )}
        </dl>

        {f.stepsToReproduce?.length > 0 && (
          <div>
            <p className="font-bold text-ink">Steps to reproduce</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-ink">
              {f.stepsToReproduce.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        )}

        {consoleLines.length > 0 && (
          <div>
            <p className="font-bold text-ink">Console errors</p>
            {/* Focusable, so a long log can be scrolled from the keyboard. */}
            <pre tabIndex={0} aria-label="Console errors" className="mt-1 max-h-48 overflow-auto rounded border border-rule bg-canvas p-2 font-mono text-xs text-ink">
              {consoleLines.join('\n')}
            </pre>
          </div>
        )}

        {failedRequests.length > 0 && (
          <div>
            <p className="font-bold text-ink">Failed requests</p>
            <ul className="mt-1 space-y-0.5 font-mono text-xs text-ink">
              {failedRequests.map((n, i) => (
                <li key={i} className="break-all">
                  {n.method} {n.url} → {n.status || 'no answer'}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-4">
          <CopyButton label="Copy bug report" getText={async () => bugReportMarkdown(f, targetUrl)} />
          <CopyButton
            label="Copy Playwright test"
            getText={async () => (f.reproScriptPath ? readRunText(runId, f.reproScriptPath).catch(() => playwrightFromSteps(f, targetUrl)) : playwrightFromSteps(f, targetUrl))}
          />
        </div>

        {f.verifyCommand && (
          <p className="text-ink-soft">
            Check a fix from the command line: <code className="rounded border border-rule bg-canvas px-1.5 py-0.5 font-mono text-xs text-ink">{f.verifyCommand}</code>
          </p>
        )}
      </div>
    </details>
  );
}
