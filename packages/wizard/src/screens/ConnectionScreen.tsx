import { useState } from 'react';
import { Lead, Question } from '../components/text';
import { WakeNote } from '../components/WakeNote';
import { useWakeOnline } from '../hooks/useWakeOnline';
import { useDocumentTitle } from '../lib/title';
import { actionsPageFor, ONLINE_APP_URL, workflowFor, WORKFLOW_PATH } from '../lib/workflow';

/**
 * Shown when no QA Tool answers this page. Opened from the QA Tool itself that is rare. Opened from
 * a static host (Vercel), it is the first screen, so it offers the route with nothing to
 * install: a workflow file that runs the check-up in the person's own GitHub repo.
 */
export function ConnectionScreen({ checks }: { checks: number }) {
  useDocumentTitle('Get started');
  // The free online copy sleeps when idle: it is woken as this screen opens, so it is usually ready by the click.
  const wake = useWakeOnline();
  const [url, setUrl] = useState('');
  const [repo, setRepo] = useState('');
  const [copied, setCopied] = useState(false);
  const actionsPage = actionsPageFor(repo);
  const workflow = workflowFor(url || 'https://your-preview-url.example.com');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(workflow);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked: the text is on the page to select by hand.
    }
  };

  return (
    <section className="mx-auto max-w-prose px-4 py-12 sm:px-6">
      <Question>How do you want to run the check-up?</Question>
      <Lead>
        Release check-up tests a site in a real browser and tells you whether it is ready to release. Pick where it
        runs.
      </Lead>

      {ONLINE_APP_URL && (
        <>
          <h2 className="mb-2 text-lg font-bold">Online: nothing to install</h2>
          <p className="mb-4 max-w-prose text-ink-soft">
            Open the full app, add your own AI key in Settings, and check a public site. Your key is kept in memory for
            your visit only. It is a free shared copy: it sleeps when nobody is using it, so the first page can take
            about a minute, and only one check-up runs at a time. Sites on your own computer or network can&rsquo;t be
            reached from here: use one of the options below for those.
          </p>
          <p className="mb-10">
            <a className="btn-primary inline-block" href={ONLINE_APP_URL} rel="noreferrer">
              Open the online app
            </a>
            <WakeNote state={wake} />
          </p>
        </>
      )}

      <h2 className="mb-2 text-lg font-bold">In your GitHub repo: nothing to install</h2>
      <p className="mb-4 max-w-prose text-ink-soft">
        The check-up runs on your own GitHub Actions minutes (free for public repos, 2,000 minutes a month for private
        ones on the free plan). Your site, your AI key and the report stay with you. A site that is only reachable from
        your build, such as a private preview, works too.
      </p>

      <ol className="mb-6 list-decimal space-y-4 pl-6">
        <li>
          <label htmlFor="gh-url" className="block font-bold">
            Address to check (optional)
          </label>
          <input
            id="gh-url"
            className="field mt-1 w-full"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://preview.example.com"
            inputMode="url"
            autoComplete="off"
          />
        </li>
        <li>
          Copy this file into your repo as{' '}
          <code className="rounded bg-surface px-1.5 py-0.5 font-bold">{WORKFLOW_PATH}</code>:
          <pre
            className="mt-2 max-h-72 overflow-auto rounded-md border-2 border-edge bg-surface px-4 py-3 text-sm"
            tabIndex={0}
            aria-label="Workflow file"
          >
            <code>{workflow}</code>
          </pre>
          <button type="button" className="btn-primary mt-2" onClick={copy}>
            {copied ? 'Copied' : 'Copy the file'}
          </button>
        </li>
        <li>
          In your repo, open <strong>Settings, Secrets and variables, Actions</strong> and add a secret named{' '}
          <code className="rounded bg-surface px-1.5 py-0.5 font-bold">QA_AI_API_KEY</code> with your AI key. Without a
          key the plan is written by fixed rules and no AI is used.
        </li>
        <li>
          <label htmlFor="gh-repo" className="block font-bold">
            Your repo (to get a link to it)
          </label>
          <input
            id="gh-repo"
            className="field mt-1 w-full"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="your-name/your-repo"
            autoComplete="off"
          />
          {actionsPage ? (
            <p className="mt-2">
              <a className="btn-link" href={actionsPage} target="_blank" rel="noreferrer">
                Open Actions and choose Run workflow
              </a>
            </p>
          ) : null}
        </li>
      </ol>
      <p className="mb-10 max-w-prose text-ink-soft">
        When the run ends, its summary page shows the verdict. The full report is in the run&rsquo;s{' '}
        <strong>qa-report</strong> download: open{' '}
        <code className="rounded bg-surface px-1.5 py-0.5 font-bold">report.html</code> with a double-click. It also
        runs by itself when a preview or staging deployment succeeds.
      </p>

      <h2 className="mb-2 text-lg font-bold">On your computer</h2>
      <ol className="mb-8 list-decimal space-y-4 pl-6">
        <li>Open a terminal in the Release check-up folder.</li>
        <li>
          Run this command:
          <pre className="mt-2 overflow-x-auto rounded-md border-2 border-edge bg-surface px-4 py-3 font-bold">
            <code>pnpm start</code>
          </pre>
        </li>
        <li>Leave the terminal open while you use this page.</li>
      </ol>

      <details className="mb-8">
        <summary className="btn-link cursor-pointer">Using Docker?</summary>
        <p className="mt-2">
          Run <code className="rounded bg-surface px-1.5 py-0.5 font-bold">docker compose up</code> in the same folder
          instead.
        </p>
      </details>

      <p role="status" className="flex items-center gap-3 text-ink-soft">
        <span aria-hidden="true" className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-stamp opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-stamp" />
        </span>
        {checks === 0
          ? 'Looking for Release check-up on this computer…'
          : 'Not running on this computer yet. Checking again every 3 seconds.'}
      </p>
    </section>
  );
}
